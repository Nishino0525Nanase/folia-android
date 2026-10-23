import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SongResult, OnlineLyricsState } from '@/types';
import { appDatabase } from '@/services/appDatabase';
import { clearBrowserCacheByCategory, putCacheEntry, readCacheEntry } from '@/services/repositories/cacheRepository';
import { getOnlineLyricsStateCacheKey, savePreparedOnlineLyrics } from '@/utils/onlineLyricsState';

// Real IndexedDB transactions verify that manual selections win over background writes.
const song: SongResult = { id: 'video:1', name: 'Fixture', artists: [], album: { id: 0, name: '' }, durationMs: 200_000,
    sourceRef: { kind: 'online', providerId: 'video', mediaId: 'video:1' } };
const automatic: OnlineLyricsState = { lyricsSource: 'online', hasOnlineOverride: true, matchedIsPureMusic: true, matchedLyricsSource: 'lrclib' };
const key = getOnlineLyricsStateCacheKey(song);
beforeEach(async () => { await appDatabase.api_cache.clear(); await appDatabase.metadata_cache.clear(); });
it('fills an unset lyric selection exactly once and is readable by playback', async () => {
    expect(await savePreparedOnlineLyrics(song, automatic, () => true)).toBe(true);
    expect(await readCacheEntry(key)).toMatchObject(automatic);
    expect(await savePreparedOnlineLyrics(song, { ...automatic, matchedLyricsSource: 'qq' }, () => true)).toBe(false);
});
it('does not replace a manually selected or imported lyric', async () => {
    const manual: OnlineLyricsState = { lyricsSource: 'imported', importedLyricsName: 'mine.lrc', importedLyrics: { lines: [{ startTime: 0, endTime: 1, words: [], fullText: 'fixture' }], isWordByWord: false } };
    await putCacheEntry(key, manual);
    expect(await savePreparedOnlineLyrics(song, automatic, () => true)).toBe(false);
    expect(await readCacheEntry(key)).toEqual(manual);
});
it('rejects a cancelled result and keeps a manual save during concurrent writes', async () => {
    expect(await savePreparedOnlineLyrics(song, automatic, () => false)).toBe(false);
    const manual = { ...automatic, matchedSongId: 'manual-choice' };
    await Promise.all([savePreparedOnlineLyrics(song, automatic, () => true), putCacheEntry(key, manual)]);
    expect(await readCacheEntry(key)).toMatchObject({ matchedSongId: 'manual-choice' });
});
it('clears durable jobs together with the lyric cache', async () => {
    await putCacheEntry('lyricPreparation_jobs_v1', { version: 1, entries: [] });
    expect(await appDatabase.metadata_cache.get('lyricPreparation_jobs_v1')).toBeTruthy();
    await clearBrowserCacheByCategory('lyrics');
    expect(await readCacheEntry('lyricPreparation_jobs_v1')).toBeNull();
});
