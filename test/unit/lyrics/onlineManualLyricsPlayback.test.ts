import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricData, SongResult } from '@/types';
import { saveOnlineLyricMatch } from '@/components/modal/lyric-match/onlineSongMatch';
import { loadOnlineSongLyrics } from '@/services/onlinePlayback';
import { getOptionalProviderLyrics, resolveSavedOnlineLyrics } from '@/services/onlineMusic/optionalLyrics';
import { getOnlineLyricsStateCacheKey, loadOnlineLyricsState, saveOnlineLyricsState } from '@/utils/onlineLyricsState';
import { readLyricOffset, writeLyricOffset } from '@/utils/lyrics/lyricOffsetMemory';
import { LyricParserFactory } from '@/utils/lyrics/LyricParserFactory';

// Persist real manual lyric states, replay them, and keep the video/part audio identity untouched.

const env = vi.hoisted(() => ({
    cache: new Map<string, unknown>(),
    nativeLyrics: vi.fn(),
    matchLyrics: vi.fn(),
    autoMatch: vi.fn(),
}));
vi.mock('@/services/db', () => ({
    saveToCache: async (key: string, value: unknown) => { env.cache.set(key, structuredClone(value)); },
    getFromCacheWithMigration: async (key: string, migrate: (value: unknown) => { value: unknown }) => {
        const value = env.cache.get(key);
        return value ? migrate(structuredClone(value)).value : null;
    },
}));
vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        getProviderCapabilities: () => ({ lyrics: false }),
        getLyrics: env.nativeLyrics,
    },
}));
vi.mock('@/utils/lyrics/lyricMatchSources', () => ({ fetchLyricsForMatchSource: env.matchLyrics }));
vi.mock('@/utils/lyrics/autoMatchBestLyric', () => ({ autoMatchBestLyric: env.autoMatch }));
vi.mock('@/services/onlineMusic/resourceCache', () => ({
    getSongCacheWithLegacyMigration: async () => null,
    getCachedSongAudioBlob: vi.fn(),
    getCachedSongReplayGain: vi.fn(),
    deleteCachedSongAudio: vi.fn(),
}));
vi.mock('@/services/prefetchService', () => ({ isUrlValid: () => false, updatePrefetchedAudioUrl: vi.fn() }));
vi.mock('@/stores/useLyricSettingsStore', () => ({
    useLyricSettingsStore: { getState: () => ({ autoUseBestLyric: false, preferredAlternativeLyricSource: 'qq' }) },
}));
vi.mock('@/services/lyricExport/lyricCacheMetadata', () => ({ saveLyricCacheSongMetadata: vi.fn() }));
vi.mock('@/utils/lyrics/workerClient', async () => {
    const { parseLyricsByFormat } = await import('@/utils/lyrics/parserCore');
    return {
        parseLyricsAsync: async (...args: Parameters<typeof parseLyricsByFormat>) => parseLyricsByFormat(...args),
    };
});

const song: SongResult = {
    id: 'BV1FT6dBtEff:1234', name: 'Video part', artists: [{ id: 1, name: 'Uploader' }],
    album: { id: 'BV1FT6dBtEff', name: 'Video' }, durationMs: 100000,
    sourceRef: { kind: 'online', providerId: 'bilibili', mediaId: 'BV1FT6dBtEff:1234', providerData: { bvid: 'BV1FT6dBtEff', cid: 1234, page: 1 } },
};
const matched: SongResult = { ...song, id: 42, name: 'Real song', sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'matched-mid' } };
const lyrics: LyricData = { lines: [{ startTime: 1, endTime: 4, fullText: 'Matched words', words: [] }] };

const replay = async (target = song) => {
    const onLyrics = vi.fn();
    const onDone = vi.fn();
    const onPureMusicChange = vi.fn();
    await loadOnlineSongLyrics(structuredClone(target), null, null, {
        isCurrent: () => true, onLyrics, onDone, onPureMusicChange,
    });
    expect(onDone).toHaveBeenCalled();
    return { onLyrics, onPureMusicChange };
};

beforeEach(() => {
    env.cache.clear();
    vi.clearAllMocks();
    env.nativeLyrics.mockRejectedValue(new Error('This source has no native lyric API'));
    env.matchLyrics.mockResolvedValue({ lyrics, isPureMusic: false });
});
afterEach(() => vi.unstubAllGlobals());

describe('manual lyrics on a source without native lyrics', () => {
    it('saves a cross-platform choice, restores it on replay, and keeps BV:cid and its audio source', async () => {
        const original = structuredClone(song);
        expect(await saveOnlineLyricMatch(song, 'qq', matched)).toBe(true);
        expect(getOnlineLyricsStateCacheKey(song)).toBe('lyric_online:bilibili:BV1FT6dBtEff:1234_state');
        expect(await loadOnlineLyricsState(song)).toMatchObject({ hasOnlineOverride: true, matchedSongId: 42, matchedLyricsSource: 'qq' });
        const played = await replay();
        expect(played.onLyrics).toHaveBeenCalledTimes(1);
        expect(played.onLyrics.mock.calls[0][0]).toMatchObject(lyrics);
        expect(env.nativeLyrics).not.toHaveBeenCalled();
        expect(env.autoMatch).not.toHaveBeenCalled();
        expect(song).toEqual(original);
    });

    it('resolves a saved match without calling a failing base lyric loader', async () => {
        await saveOnlineLyricMatch(song, 'qq', matched);
        const base = vi.fn(async () => { throw new Error('unsupported native lyrics'); });
        expect((await resolveSavedOnlineLyrics(song, base)).lyrics).toMatchObject(lyrics);
        expect(base).not.toHaveBeenCalled();
    });

    it('reuses the existing parser for an imported LRC and keeps it across replay', async () => {
        const imported = await LyricParserFactory.parse({ type: 'local', lrcContent: '[00:01.20]From my file\n[00:03.00]Next line' });
        await saveOnlineLyricsState(song, { lyricsSource: 'imported', importedLyrics: imported, importedLyricsName: 'my-song.lrc' });
        const played = await replay();
        expect(played.onLyrics).toHaveBeenCalledExactlyOnceWith(imported);
        expect(env.nativeLyrics).not.toHaveBeenCalled();
    });

    it('honors an explicit instrumental choice with no lyric lines without querying a provider', async () => {
        await saveOnlineLyricsState(song, { lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: null, matchedIsPureMusic: true });
        const played = await replay();
        expect(played.onLyrics).toHaveBeenCalledExactlyOnceWith(null);
        expect(played.onPureMusicChange).toHaveBeenCalledWith(true);
        expect(env.nativeLyrics).not.toHaveBeenCalled();
    });

    it('keeps separate choices for different parts and returns an empty base when native lyrics are unsupported', async () => {
        await saveOnlineLyricMatch(song, 'qq', matched);
        const other = { ...song, id: 'BV1FT6dBtEff:5678', sourceRef: { kind: 'online' as const, providerId: 'bilibili', mediaId: 'BV1FT6dBtEff:5678' } };
        expect(await loadOnlineLyricsState(other)).toBeNull();
        const played = await replay(other);
        expect(played.onLyrics).toHaveBeenLastCalledWith(null);
        expect(env.nativeLyrics).not.toHaveBeenCalled();
    });

    it('clears the saved override and resolves no lyrics rather than falling back to a failing native API', async () => {
        await saveOnlineLyricMatch(song, 'qq', matched);
        env.cache.delete(getOnlineLyricsStateCacheKey(song));
        const restored = await resolveSavedOnlineLyrics(song, async () => (await getOptionalProviderLyrics(song)).lyrics);
        expect(restored).toEqual({ state: null, lyrics: null });
        const played = await replay();
        expect(played.onLyrics).toHaveBeenLastCalledWith(null);
        expect(env.nativeLyrics).not.toHaveBeenCalled();
    });

    it('retains the existing per-part offset storage without replacing the source identity', () => {
        const values = new Map<string, string>();
        vi.stubGlobal('window', {});
        vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
        writeLyricOffset(song.id, 1250);
        expect(readLyricOffset(song.id)).toBe(1250);
        expect(readLyricOffset('BV1FT6dBtEff:5678')).toBe(0);
        expect(JSON.parse(values.get('lyric_timeline_offsets')!)[String(song.id)]).toBe(1250);
        expect(song.sourceRef?.kind).toBe('online');
    });
});
