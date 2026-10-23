import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LyricData, SongResult } from '@/types';
import { appDatabase } from '@/services/appDatabase';
import { putCacheEntry, readCacheEntry } from '@/services/repositories/cacheRepository';
import { getOnlineLyricsStateCacheKey } from '@/utils/onlineLyricsState';
import { readLyricOffset, writeLyricOffset } from '@/utils/lyrics/lyricOffsetMemory';
import { recognizeMissingLyrics, usableAutomaticSubtitles, AUTOMATIC_SUBTITLES_NAME } from '@/services/lyricPreparation/automaticAudioLyrics';

// Real persistence, with only network/audio/model work mocked: import output is already selected for playback.
const mocks = vi.hoisted(() => ({ source: vi.fn(), read: vi.fn(), infer: vi.fn() }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { getAudioSource: mocks.source } }));
vi.mock('@/services/lyricAlignment/alignmentAudio', () => ({ readAlignmentAudio: mocks.read }));
vi.mock('@/services/lyricAlignment/alignmentService', () => ({ inferAlignment: mocks.infer }));
const song: SongResult = { id: 'video:1', name: 'Unknown track', artists: [], album: { id: 0, name: '' }, durationMs: 20_000,
    sourceRef: { kind: 'online', providerId: 'video', mediaId: 'video:1' } };
const lyrics: LyricData = { isWordByWord: true, lines: ['The morning is blue', 'We follow the road', 'The day has begun']
    .map((fullText, i) => ({ fullText, startTime: i * 4, endTime: i * 4 + 3, words: [] })) };
const key = getOnlineLyricsStateCacheKey(song);
const run = (signal = new AbortController().signal) => recognizeMissingLyrics(song, () => true, signal, () => {});
beforeEach(async () => {
    vi.resetAllMocks(); await appDatabase.metadata_cache.clear(); await appDatabase.api_cache.clear();
    mocks.source.mockResolvedValue({ url: 'https://audio.example.test/original', quality: 'standard' });
    mocks.read.mockResolvedValue(new Float32Array(20 * 16000)); mocks.infer.mockResolvedValue({ lyrics, kind: 'transcribed' });
});
afterEach(() => vi.useRealTimers());
it('automatically saves timed subtitles against the original video without a current-playing song or Apply click', async () => {
    writeLyricOffset(song.id, 2400);
    expect(await run()).toBe('ready');
    expect(readLyricOffset(song.id)).toBe(0);
    expect(mocks.source).toHaveBeenCalledWith(song, 'standard', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.read).toHaveBeenCalledWith(song, 'https://audio.example.test/original', expect.any(AbortSignal));
    expect(mocks.infer.mock.calls[0][0]).toMatchObject({ lyrics: null, language: 'auto' });
    expect(await readCacheEntry(key)).toMatchObject({ lyricsSource: 'imported', importedLyricsName: AUTOMATIC_SUBTITLES_NAME,
        importedLyrics: { lines: expect.arrayContaining([expect.objectContaining({ startTime: 4 })]) } });
    expect(await run()).toBe('ready'); expect(mocks.source).toHaveBeenCalledOnce();
});
it('preserves a lyric manually chosen while recognition was running', async () => {
    const manual = { lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: lyrics };
    mocks.infer.mockImplementation(async () => { await putCacheEntry(key, manual); return { lyrics }; });
    expect(await run()).toBe('ready'); expect(await readCacheEntry(key)).toMatchObject(manual);
});
it('does not download previews, overlong videos, or songs with a stored instrumental choice', async () => {
    mocks.source.mockResolvedValue({ url: 'https://audio.example.test/preview', preview: true });
    expect(await run()).toBe('failed'); expect(mocks.read).not.toHaveBeenCalled();
    expect(await recognizeMissingLyrics({ ...song, durationMs: 900_001 }, () => true, new AbortController().signal, () => {})).toBe('unmatched');
    await putCacheEntry(key, { lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: null, matchedIsPureMusic: true });
    expect(await run()).toBe('ready'); expect(mocks.source).toHaveBeenCalledOnce();
});
it('cancels a stalled read and prevents late inference or saves', async () => {
    let release!: (value: Float32Array) => void;
    mocks.read.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const controller = new AbortController(); const result = run(controller.signal);
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalled()); controller.abort();
    expect(await result).toBe('failed'); release(new Float32Array(320000)); await Promise.resolve();
    expect(mocks.infer).not.toHaveBeenCalled(); expect(await readCacheEntry(key)).toBeNull();
});
it('does not automatically apply empty, repeated filler, or invalid timing output', async () => {
    expect(usableAutomaticSubtitles(lyrics, 20)).toBe(true);
    expect(usableAutomaticSubtitles({ lines: [] }, 20)).toBe(false);
    expect(usableAutomaticSubtitles({ lines: lyrics.lines.map(line => ({ ...line, fullText: 'Thanks for watching' })) }, 20)).toBe(false);
    expect(usableAutomaticSubtitles({ lines: lyrics.lines.map(line => ({ ...line, endTime: Infinity })) }, 20)).toBe(false);
    mocks.infer.mockResolvedValue({ lyrics: { lines: [] } }); expect(await run()).toBe('unmatched');
    expect(await readCacheEntry(key)).toBeNull();
});
