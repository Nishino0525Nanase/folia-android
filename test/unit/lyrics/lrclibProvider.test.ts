import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lrclibAccess } from '@/utils/lyrics/providers/lrclibProvider';

// Exercise the public wire format without network access or catalogue lyric text.
const target = { title: '晴る', artist: 'ヨルシカ', durationMs: 271_000 };
const entry = { id: 9001, trackName: '晴る', artistName: 'ヨルシカ', albumName: '', duration: 271, syncedLyrics: '[00:01.00]Fixture line\n[00:03.00]Second fixture' };
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('LRCLIB lyric source', () => {
    it('searches multilingual credits and parses timed lyrics without a music-platform account', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify([entry])));
        const songs = await lrclibAccess.search('晴る - ヨルシカ', 20, target);
        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.searchParams.get('track_name')).toBe('晴る');
        expect(url.searchParams.get('artist_name')).toBe('ヨルシカ');
        expect(fetchMock.mock.calls[0][1].credentials).toBe('omit');
        expect(songs[0]).toMatchObject({ durationMs: 271_000, sourceRef: { providerId: 'lrclib' } });
        const result = await lrclibAccess.fetch(songs[0], { chorusRanges: [] });
        expect(result?.lyrics?.lines).toHaveLength(2);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('keeps editable free-text search and excludes untimed or malformed results', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify([{ ...entry, id: 9002, syncedLyrics: null }, { ...entry, id: 'bad' }, { ...entry, id: 9003, instrumental: true, syncedLyrics: null }])));
        const songs = await lrclibAccess.search('Yorushika Haru', 20, target);
        expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('q')).toBe('Yorushika Haru');
        expect(songs.map(song => song.id)).toEqual([9003]);
        expect(await lrclibAccess.fetch(songs[0], { chorusRanges: [] })).toMatchObject({ lyrics: null, isPureMusic: true });
    });

    it('distinguishes missing lyrics from service failure', async () => {
        fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
        expect(await lrclibAccess.search('unknown', 20, target)).toEqual([]);
        fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }));
        await expect(lrclibAccess.search('unknown', 20, target)).rejects.toThrow('429');
    });

    it('ranks matching duration and artist before applying the result limit', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify([
            ...Array.from({ length: 12 }, (_, index) => ({ ...entry, id: 9100 + index, duration: index + 4 })),
            { ...entry, id: 9200, artistName: 'Yorushika' },
        ])));
        const songs = await lrclibAccess.search('晴る - ヨルシカ', 1, target);
        expect(songs.map(song => song.id)).toEqual([9200]);
        expect(await lrclibAccess.fetch(songs[0], { chorusRanges: [] })).toMatchObject({ lyrics: { lines: [{ fullText: 'Fixture line' }, { fullText: 'Second fixture' }] } });
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});
