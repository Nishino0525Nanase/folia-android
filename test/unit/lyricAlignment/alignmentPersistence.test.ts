import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import type { OnlineLyricsState, SongResult } from '@/types';
import type { AlignmentJob } from '@/services/lyricAlignment/alignmentService';
import { appDatabase } from '@/services/appDatabase';
import { putCacheEntry, readCacheEntry } from '@/services/repositories/cacheRepository';
import { getOnlineLyricsStateCacheKey } from '@/utils/onlineLyricsState';
import { applyAudioAlignment, canApplyAlignment, hasAlignmentBackup, restoreAudioAlignment } from '@/services/lyricAlignment/alignmentPersistence';

// IndexedDB verifies the backup and selection are saved atomically; stale jobs cannot erase manual work.
const song: SongResult = { id: 'video:1', name: 'Fixture', artists: [], album: { id: 0, name: '' }, durationMs: 60_000,
    sourceRef: { kind: 'online', providerId: 'video', mediaId: 'video:1' } };
const originalLyrics = { lines: [1, 2, 3].map(n => ({ fullText: `line ${n}`, startTime: n, endTime: n + 1, words: [] })) };
const state: OnlineLyricsState = { lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: originalLyrics };
const job: AlignmentJob = { key: 'fixture', song, originalLyrics, originalState: state, originalOffset: 2.5, language: 'english', status: 'ready', progress: { phase: 'aligning' },
    result: { kind: 'aligned', totalLines: 3, matchedLines: 3, coverage: 1, lyrics: { lines: originalLyrics.lines.map(line => ({ ...line, startTime: line.startTime + 10, endTime: line.endTime + 10 })) } } };
const key = getOnlineLyricsStateCacheKey(song);
beforeEach(async () => { await appDatabase.api_cache.clear(); await appDatabase.metadata_cache.clear(); });
it('applies an audio timeline and restores the exact prior lyrics and offset', async () => {
    await putCacheEntry(key, state);
    expect(await applyAudioAlignment(job, 'aligned.lrc', () => true)).toBe(true);
    expect(await readCacheEntry(key)).toMatchObject({ lyricsSource: 'imported', importedLyricsName: 'aligned.lrc' });
    expect(await hasAlignmentBackup(song)).toBe(true);
    expect(await restoreAudioAlignment(song, () => true)).toEqual({ source: 'online', offset: 2.5 });
    expect(await readCacheEntry(key)).toEqual(state);
    expect(await hasAlignmentBackup(song)).toBe(false);
});
it('rejects a different song, changed selection, and low-confidence results without writing a backup', async () => {
    await putCacheEntry(key, state);
    expect(await applyAudioAlignment(job, 'aligned.lrc', () => false)).toBe(false);
    const manual = { ...state, onlineOverrideLyrics: { lines: [] } };
    await putCacheEntry(key, manual);
    expect(await applyAudioAlignment(job, 'aligned.lrc', () => true)).toBe(false);
    expect(await readCacheEntry(key)).toEqual(manual);
    expect(await hasAlignmentBackup(song)).toBe(false);
    expect(canApplyAlignment({ ...job, result: { ...job.result!, coverage: 0.5 } })).toBe(false);
});
it('backs up displayed base lyrics even when there was no stored override', async () => {
    expect(await applyAudioAlignment({ ...job, originalState: null }, 'aligned.lrc', () => true)).toBe(true);
    await restoreAudioAlignment(song, () => true);
    expect(await readCacheEntry(key)).toEqual(state);
});
it('does not overwrite a newer manual selection when restoring', async () => {
    await putCacheEntry(key, state);
    await applyAudioAlignment(job, 'aligned.lrc', () => true);
    const manual = { ...state, lyricsSource: 'imported' as const, importedLyrics: originalLyrics, importedLyricsName: 'mine.lrc' };
    await putCacheEntry(key, manual);
    expect(await restoreAudioAlignment(song, () => true)).toBeNull();
    expect(await readCacheEntry(key)).toEqual(manual);
});
