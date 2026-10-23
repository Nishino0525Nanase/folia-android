import type { Line, LyricData } from '../../../types';
import { record } from './bilibiliNative';

// Subtitle timestamps already belong to this video: retain cue ends and gaps without inventing word timing.
export type BilibiliSubtitleTrack = { url: string; language: string; automatic: boolean };

export const selectBilibiliSubtitle = (value: unknown, preferredLanguage: string): BilibiliSubtitleTrack | null => {
    const tracks = record(value).subtitles;
    if (!Array.isArray(tracks)) return null;
    const candidates = tracks.slice(0, 100).flatMap(item => {
        const track = record(item);
        if (typeof track.lan !== 'string' || typeof track.subtitle_url !== 'string' || !track.subtitle_url) return [];
        const automatic = track.lan.startsWith('ai-') || Number(track.ai_type) > 0 || track.type === 1;
        const language = track.lan.replace(/^ai-/, '');
        return [{ url: track.subtitle_url, language, automatic }];
    });
    const score = (track: BilibiliSubtitleTrack) => (track.language.split('-')[0] === preferredLanguage ? 100 : 0)
        + (track.automatic ? 0 : 20);
    return candidates.sort((a, b) => score(b) - score(a))[0] ?? null;
};

export const parseBilibiliSubtitles = (value: unknown, track: BilibiliSubtitleTrack): LyricData | null => {
    const body = record(value).body;
    if (!Array.isArray(body) || body.length > 10_000) return null;
    const seen = new Set<string>();
    const lines: Line[] = [];
    for (const item of body) {
        const cue = record(item);
        if (typeof cue.from !== 'number' || typeof cue.to !== 'number' || !Number.isFinite(cue.from)
            || !Number.isFinite(cue.to) || cue.from < 0 || cue.to <= cue.from || cue.to > 172_800
            || typeof cue.content !== 'string' || cue.content.length > 4096) continue;
        const text = cue.content.replace(/\r\n?/g, '\n').trim();
        const key = `${cue.from}:${cue.to}:${text}`;
        if (!text || seen.has(key)) continue;
        seen.add(key);
        lines.push({ startTime: cue.from, endTime: cue.to, fullText: text,
            words: [{ text, startTime: cue.from, endTime: cue.to }] });
    }
    if (!lines.length) return null;
    return { lines: lines.sort((a, b) => a.startTime - b.startTime), isWordByWord: false,
        mediaSubtitle: { language: track.language, automatic: track.automatic } };
};
