import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricData, OnlineLyricsState, SongResult } from '@/types';
import { clearPrefetchRuntime, getPrefetchedData, invalidatePrefetchedLyrics, prefetchNearbySongs, updatePrefetchedAudioUrl } from '@/services/prefetchService';
import { useLyricSettingsStore } from '@/stores/useLyricSettingsStore';

const env = vi.hoisted(() => ({
    state: null as OnlineLyricsState | null,
    supportsLyrics: false,
    now: 1_000_000,
    audio: vi.fn(), nativeLyrics: vi.fn(), baseLyrics: vi.fn(), autoMatch: vi.fn(),
    idle: [] as Array<() => Promise<void>>,
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: {
    canPlaySong: () => true,
    resolveAudioQuality: (_id: string, quality: string) => quality,
    getAudioSource: env.audio,
    getLyrics: env.nativeLyrics,
    getLyricMatchTarget: (song: SongResult) => ({ title: song.name, artist: '', album: '', durationMs: song.durationMs }),
    getProviderCapabilities: () => ({ lyrics: env.supportsLyrics }),
} }));
vi.mock('@/services/onlineMusic/resourceCache', () => ({
    hasCachedSongAudio: async () => false,
    getSongCacheWithLegacyMigration: env.baseLyrics,
}));
vi.mock('@/utils/onlineLyricsState', async importOriginal => ({
    ...await importOriginal<typeof import('@/utils/onlineLyricsState')>(),
    loadOnlineLyricsState: async () => structuredClone(env.state),
    savePreparedOnlineLyrics: async (_song: SongResult, state: OnlineLyricsState, current: () => boolean) => {
        if (!current() || env.state?.hasOnlineOverride || env.state?.importedLyrics) return false;
        env.state = structuredClone(state); return true;
    },
}));
vi.mock('@/utils/lyrics/autoMatchBestLyric', () => ({ autoMatchBestLyric: env.autoMatch }));
vi.mock('@/services/automix/profileService', () => ({
    ensureTrackProfile: async () => {}, setAnalysisScope: () => {},
}));

const target: SongResult = {
    id: 'BV1FT6dBtEff:1234', name: 'Video part', artists: [],
    album: { id: 'video', name: 'Video' }, durationMs: 10_000,
    sourceRef: { kind: 'online', providerId: 'bilibili', mediaId: 'BV1FT6dBtEff:1234' },
};
const current: SongResult = { ...target, id: 'current', sourceRef: { kind: 'online', providerId: 'bilibili', mediaId: 'current' } };
const lyrics: LyricData = { lines: [{ startTime: 0, endTime: 2, fullText: 'Chosen words', words: [] }] };
const runPrefetch = async () => {
    await prefetchNearbySongs(current, [current, target], 'high');
    while (env.idle.length) await env.idle.shift()!();
};

beforeEach(() => {
    clearPrefetchRuntime();
    vi.clearAllMocks();
    env.idle.length = 0;
    env.now = 1_000_000;
    env.supportsLyrics = false;
    env.state = { lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: lyrics };
    env.audio.mockImplementation(async () => ({ url: 'https://audio.test/stream.m4a', fetchedAt: env.now, expiresAt: env.now + 1000, quality: 'high' }));
    env.nativeLyrics.mockRejectedValue(new Error('unsupported lyric API'));
    env.baseLyrics.mockRejectedValue(new Error('manual lyrics do not need a base cache'));
    vi.spyOn(Date, 'now').mockImplementation(() => env.now);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('requestIdleCallback', (run: () => Promise<void>) => { env.idle.push(run); return 0; });
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No platform requests in these tests'); }));
    useLyricSettingsStore.setState({ autoUseBestLyric: true, preferredAlternativeLyricSource: 'qq' });
});
afterEach(() => { clearPrefetchRuntime(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('manual lyrics and expiring audio during prefetch', () => {
    it('prefetches the saved choice without querying native lyrics, old base lyrics, or automatic matching', async () => {
        await runPrefetch();
        expect(getPrefetchedData(target)?.lyrics).toEqual(lyrics);
        expect(env.nativeLyrics).not.toHaveBeenCalled();
        expect(env.baseLyrics).not.toHaveBeenCalled();
        expect(env.autoMatch).not.toHaveBeenCalled();
    });

    it('keeps an imported file authoritative even when automatic matching is enabled', async () => {
        env.state = { lyricsSource: 'imported', importedLyrics: lyrics, importedLyricsName: 'my.lrc' };
        await runPrefetch();
        expect(getPrefetchedData(target)?.lyrics).toEqual(lyrics);
        expect(env.autoMatch).not.toHaveBeenCalled();
        expect(env.nativeLyrics).not.toHaveBeenCalled();
    });

    it('preserves a saved instrumental without repeatedly resolving the native lyric API', async () => {
        env.state = { lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: null, matchedIsPureMusic: true };
        await runPrefetch();
        await runPrefetch();
        expect(getPrefetchedData(target)?.lyricRaw?.isPureMusic).toBe(true);
        expect(env.audio).toHaveBeenCalledTimes(1);
        expect(env.nativeLyrics).not.toHaveBeenCalled();
    });

    it('refreshes an expired provider ticket rather than taking the cached fast path or reusing the old URL', async () => {
        await runPrefetch();
        expect(getPrefetchedData(target)?.audioUrlExpiresAt).toBe(1_001_000);
        env.now += 1_001;
        env.audio.mockResolvedValueOnce({ url: 'https://audio.test/refreshed.m4a', fetchedAt: env.now, expiresAt: env.now + 1000, quality: 'high' });
        await runPrefetch();
        expect(env.audio).toHaveBeenCalledTimes(2);
        expect(getPrefetchedData(target)).toMatchObject({ audioUrl: 'https://audio.test/refreshed.m4a', audioUrlExpiresAt: env.now + 1000, lyrics });
    });

    it('invalidates the cleared song lyrics under the actual prefetch key while retaining its audio and other entries', async () => {
        await runPrefetch();
        updatePrefetchedAudioUrl(current, 'https://audio.test/current.m4a', 'high');
        invalidatePrefetchedLyrics(target);
        expect(getPrefetchedData(target)).toMatchObject({ audioUrl: 'https://audio.test/stream.m4a', lyrics: null, lyricRaw: null });
        expect(getPrefetchedData(current)?.audioUrl).toBe('https://audio.test/current.m4a');
    });
});

it('preserves native video subtitle cues during prefetch instead of replacing them with catalogue lyrics', async () => {
    env.state = null; env.supportsLyrics = true; env.baseLyrics.mockResolvedValue(null);
    const subtitles = { ...lyrics, mediaSubtitle: { language: 'ja', automatic: false } };
    env.nativeLyrics.mockResolvedValue({ lyrics: subtitles, isPureMusic: false });
    await runPrefetch();
    expect(getPrefetchedData(target)?.lyrics).toEqual(subtitles);
    expect(env.autoMatch).not.toHaveBeenCalled();
});

it('keeps original subtitles prepared while a slower catalogue prefetch finishes', async () => {
    env.state = null; env.supportsLyrics = true; env.baseLyrics.mockResolvedValue(null);
    env.nativeLyrics.mockResolvedValue({ lyrics: null, isPureMusic: false });
    const subtitles = { ...lyrics, mediaSubtitle: { language: 'ja', automatic: false } };
    env.autoMatch.mockImplementation(async () => {
        env.state = { lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: subtitles };
        return { source: 'qq', id: 123, lyrics: { lines: [] }, isPureMusic: false };
    });
    await runPrefetch();
    expect(getPrefetchedData(target)?.lyrics).toEqual(subtitles);
    expect(env.state).toMatchObject({ onlineOverrideLyrics: subtitles });
});
