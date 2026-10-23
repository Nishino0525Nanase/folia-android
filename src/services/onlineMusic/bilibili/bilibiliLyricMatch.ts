import type { SongResult } from '../../../types';
import type { ProviderLyricMatchTarget } from '../../../types/onlineMusic';
import { canonicalLyricArtist, isKnownLyricArtist } from '../../../utils/lyrics/artistAliases';

// Extract search hints from video titles; uploaders and video collection titles are not music credits.
const presentationTag = /^(?:(?:4k|8k|1080p|720p|60fps|hdr|hi[- ]?res|无损|超清|高清|高音质|音质|重制|中日|双语|日文|中文|字幕|中字|歌词|完整版|官方|official|music|video|mv|pv|ver\.?)[\s/·+.-]*)+$/iu;
const uncertainVersion = /翻唱|伴奏|纯音乐|串烧|合集|现场|演唱会|教程|解说|讲解|盘点|推荐|reaction|\b(?:cover|live|remix|instrumental|karaoke|nightcore)\b/iu;

export const getBilibiliLyricMatchTarget = (song: SongResult): ProviderLyricMatchTarget => {
    const raw = canonicalLyricArtist(song.name || '');
    const clean = raw.replace(/[【\[（(]([^】\]）)]+)[】\]）)]/gu, (match, tag: string) => (
        presentationTag.test(tag.trim()) ? ' ' : isKnownLyricArtist(tag.trim()) ? `${tag.trim()} ` : match
    )).replace(/(?:\s*[-—–|]\s*)?(?:official\s+(?:music\s+)?video|music\s+video|MV|PV)\s*$/iu, '')
        .replace(/\s+/gu, ' ').trim();
    let title = clean;
    let artist = '';
    const quoted = /^(.*?)\s*[《「『]([^》」』]+)[》」』]\s*(.*?)$/u.exec(clean);
    if (quoted) {
        title = quoted[2].trim();
        artist = (quoted[1] || quoted[3]).replace(/^[-—–/:：\s]+|[-—–/:：\s]+$/gu, '').trim();
        // Text on both sides of a quoted title is usually a recommendation/review, not a credit.
        if (quoted[1].trim() && quoted[3].trim()) artist = '';
    } else {
        const compactPair = /^(.+?)\s*[-—–:：]\s*(.+)$/u.exec(clean);
        const knownPair = compactPair && (isKnownLyricArtist(compactPair[1].trim()) || isKnownLyricArtist(compactPair[2].trim())) ? compactPair : null;
        const pair = knownPair || /^(.+?)\s+[-—–/]\s+(.+)$/u.exec(clean) || /^([^/]{1,48})\s*\/\s*([^/]+)$/u.exec(clean);
        const tagged = /^[【\[]([^】\]]{1,24})[】\]]\s*(.+)$/u.exec(clean);
        const spacedCredit = /\s+/gu;
        let spacedArtistCredit: [string, string] | undefined;
        for (const separator of clean.matchAll(spacedCredit)) {
            const prefix = clean.slice(0, separator.index).trim();
            const suffix = clean.slice(separator.index + separator[0].length).trim();
            if (isKnownLyricArtist(prefix)) { spacedArtistCredit = [prefix, suffix]; break; }
            if (isKnownLyricArtist(suffix)) { spacedArtistCredit = [suffix, prefix]; break; }
        }
        if (pair) {
            [artist, title] = isKnownLyricArtist(pair[2].trim()) && !isKnownLyricArtist(pair[1].trim())
                ? [pair[2].trim(), pair[1].trim()] : [pair[1].trim(), pair[2].trim()];
        } else if (tagged) {
            artist = tagged[1].trim(); title = tagged[2].trim();
        } else if (spacedArtistCredit) {
            [artist, title] = spacedArtistCredit;
        }
    }
    // Bilingual upload titles often append a translation. Prefer the kana title; for Han-only
    // pairs with known Japanese credits, use the first printed title. Keep arbitrary English titles.
    const titleParts = title.split(/\s*[/|｜]\s*/u);
    const japaneseTitles = titleParts.filter(part => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(part));
    if (titleParts.length === 2 && japaneseTitles.length === 1) title = japaneseTitles[0].trim();
    else if (titleParts.length === 2 && isKnownLyricArtist(artist) && titleParts.every(part => /^[\p{Script=Han}\s]+$/u.test(part))) title = titleParts[0].trim();
    const hasIdentity = Boolean(artist && artist.length <= 48 && title && title.length <= 100
        && !/[：:!?！？]/u.test(artist) && !uncertainVersion.test(raw));
    const titleOnly = !artist && Boolean(title && title.length <= 48 && song.durationMs > 0
        && !(quoted?.[1].trim() && quoted?.[3].trim())
        && !uncertainVersion.test(raw) && !/[：:!?！？]/u.test(title));
    return { title, artist: artist.length <= 48 ? artist : '', album: '', durationMs: song.durationMs,
        autoMatch: hasIdentity || titleOnly, ...(hasIdentity ? { durationToleranceMs: 30_000 } : {}),
        ...(titleOnly ? { requireUniqueTitleMatch: true } : {}) };
};
