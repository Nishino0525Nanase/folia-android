import type { SongResult } from '../../../types';
import type { LyricSourceAccess } from '../lyricMatchSources';
import { parseLyricsByFormat } from '../parserCore';
import { hasRenderableLyrics } from '../validity';

// Public LRCLIB catalogue: only timestamped lyrics are used; plain text is never presented as synchronized.
const BASE = 'https://lrclib.net/api';
type Entry = { id: number; trackName: string; artistName: string; albumName: string; duration: number;
    instrumental?: boolean; syncedLyrics?: string | null };
const cached = new Map<number, Entry>();
const valid = (entry: any): entry is Entry => Boolean(entry && Number.isSafeInteger(entry.id) && entry.id > 0
    && typeof entry.trackName === 'string' && typeof entry.artistName === 'string'
    && typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration >= 0);

const request = async (path: string): Promise<unknown> => {
    const response = await fetch(`${BASE}${path}`, { credentials: 'omit', signal: AbortSignal.timeout(6500) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`LRCLIB request failed (${response.status})`);
    return response.json();
};

const remember = (entry: Entry) => {
    cached.delete(entry.id);
    cached.set(entry.id, entry);
    while (cached.size > 100) cached.delete(cached.keys().next().value!);
};

export const lrclibAccess: LyricSourceAccess = {
    async search(query, limit) {
        // Respect edited manual searches as well as the automatic title/artist query.
        const parts = query.split(/\s+-\s+/u).map(part => part.trim()).filter(Boolean);
        const params = parts.length >= 2
            ? new URLSearchParams({ track_name: parts[0], artist_name: parts[1] })
            : new URLSearchParams({ q: query.trim() });
        const data = await request(`/search?${params}`);
        if (!Array.isArray(data)) {
            if (data === null) return [];
            throw new Error('Invalid LRCLIB search response');
        }
        return data.filter(valid).filter(entry => entry.instrumental === true
            || typeof entry.syncedLyrics === 'string' && /\[\d+:\d+(?:[.:]\d+)?\]/u.test(entry.syncedLyrics))
            .slice(0, limit).map(entry => {
                remember(entry);
                return { id: entry.id, name: entry.trackName, artists: [{ id: 0, name: entry.artistName }],
                    album: { id: 0, name: typeof entry.albumName === 'string' ? entry.albumName : '' },
                    durationMs: Math.round(entry.duration * 1000),
                    sourceRef: { kind: 'online', providerId: 'lrclib', mediaId: String(entry.id) } } satisfies SongResult;
            });
    },
    async fetch(song) {
        const id = Number(song.id);
        if (!Number.isSafeInteger(id) || id <= 0) return null;
        const entry = cached.get(id) ?? await request(`/get/${id}`);
        if (!valid(entry) || entry.id !== id) return null;
        remember(entry);
        const text = typeof entry.syncedLyrics === 'string' ? entry.syncedLyrics : '';
        const lyrics = /\[\d+:\d+(?:[.:]\d+)?\]/u.test(text) ? parseLyricsByFormat('lrc', text) : null;
        return { lyrics: hasRenderableLyrics(lyrics) ? lyrics : null, isPureMusic: entry.instrumental === true };
    },
    songKey: song => String(song.id),
};
