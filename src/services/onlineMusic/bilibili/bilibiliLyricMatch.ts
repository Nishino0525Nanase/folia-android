import type { SongResult } from '../../../types';
import type { ProviderLyricMatchTarget } from '../../../types/onlineMusic';
import { canonicalLyricArtist } from '../../../utils/lyrics/artistAliases';

// Extract search hints from video titles; uploaders and video collection titles are not music credits.
const presentationTag = /^(?:(?:4k|8k|1080p|720p|60fps|hdr|hi[- ]?res|无损|超清|高清|高音质|音质|重制|中日|双语|日文|中文|字幕|中字|歌词|完整版|官方|official|music|video|mv|pv|ver\.?)[\s/·+.-]*)+$/iu;
const uncertainVersion = /翻唱|伴奏|纯音乐|串烧|合集|现场|演唱会|教程|解说|reaction|\b(?:cover|live|remix|instrumental|karaoke|nightcore)\b/iu;

export const getBilibiliLyricMatchTarget = (song: SongResult): ProviderLyricMatchTarget => {
    const raw = canonicalLyricArtist(song.name || '');
    const clean = raw.replace(/[【\[（(]([^】\]）)]+)[】\]）)]/gu, (match, tag: string) => (
        presentationTag.test(tag.trim()) ? ' ' : tag.trim() === 'ヨルシカ' ? 'ヨルシカ ' : match
    )).replace(/\s+/gu, ' ').trim();
    let title = clean;
    let artist = '';
    const quoted = /^(.*?)\s*[《「『]([^》」』]+)[》」』]\s*(.*?)$/u.exec(clean);
    if (quoted) {
        title = quoted[2].trim();
        artist = (quoted[1] || quoted[3]).replace(/^[-—–/:：\s]+|[-—–/:：\s]+$/gu, '').trim();
        // Text on both sides of a quoted title is usually a recommendation/review, not a credit.
        if (quoted[1].trim() && quoted[3].trim()) artist = '';
    } else {
        const pair = /^(.+?)\s+[-—–/]\s+(.+)$/u.exec(clean);
        const tagged = /^[【\[]([^】\]]{1,24})[】\]]\s*(.+)$/u.exec(clean);
        if (pair) {
            [artist, title] = pair[2].trim() === 'ヨルシカ'
                ? [pair[2].trim(), pair[1].trim()] : [pair[1].trim(), pair[2].trim()];
        } else if (tagged) {
            artist = tagged[1].trim(); title = tagged[2].trim();
        } else if (clean.startsWith('ヨルシカ ')) {
            artist = 'ヨルシカ'; title = clean.slice(5).trim();
        }
    }
    const hasIdentity = Boolean(artist && artist.length <= 48 && title && title.length <= 100
        && !/[：:!?！？]/u.test(artist) && !uncertainVersion.test(raw));
    return { title, artist: artist.length <= 48 ? artist : '', album: '', durationMs: song.durationMs,
        autoMatch: hasIdentity, ...(hasIdentity ? { durationToleranceMs: 30_000 } : {}) };
};
