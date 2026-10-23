import { beforeEach, expect, it, vi } from 'vitest';
import type { LyricData, SongResult } from '@/types';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { applyPreparedLyricsToPlayback } from '@/components/app/playback/start/preparedLyricsPlayback';
import { writeLyricOffset } from '@/utils/lyrics/lyricOffsetMemory';

// Late background results fill an empty player, but cannot replace a different track or a manual lyric choice.
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/utils/onlineLyricsState', async importOriginal => ({ ...await importOriginal<object>(), loadOnlineLyricsState: mocks.load }));
const song: SongResult = { id: 'video:1', name: 'Fixture', artists: [], album: { id: 0, name: '' }, durationMs: 20000,
    sourceRef: { kind: 'online', providerId: 'video', mediaId: 'video:1' } };
const lyrics: LyricData = { lines: [{ fullText: 'A timed sentence', startTime: 1, endTime: 3, words: [] }] };
beforeEach(() => { vi.resetAllMocks(); usePlaybackStore.setState({ currentSong: song, lyrics: null, playQueue: [song] });
    mocks.load.mockResolvedValue({ lyricsSource: 'imported', importedLyrics: lyrics }); });
it('shows completed subtitles during playback without restarting the track', async () => {
    usePlaybackStore.setState({ lyricTimelineOffsetMs: 2400 });
    writeLyricOffset(song.id, 0);
    mocks.load.mockResolvedValue({ lyricsSource: 'imported', importedLyrics: lyrics, importedLyricsName: 'folia-auto-subtitles.lrc' });
    const set = vi.fn(value => usePlaybackStore.getState().setLyricsState(value)), persist = vi.fn(async () => {});
    await applyPreparedLyricsToPlayback(song, set, persist, () => true);
    expect(set).toHaveBeenCalledWith(lyrics); expect(persist).toHaveBeenCalledOnce();
    expect(usePlaybackStore.getState().currentSong?.sourceRef).toEqual(song.sourceRef);
    expect(usePlaybackStore.getState().lyricTimelineOffsetMs).toBe(0);
});
it('keeps existing lyrics and discards a late result after a song switch or panel lifecycle change', async () => {
    const set = vi.fn(), persist = vi.fn();
    usePlaybackStore.setState({ lyrics }); await applyPreparedLyricsToPlayback(song, set, persist, () => true);
    expect(mocks.load).not.toHaveBeenCalled();
    usePlaybackStore.setState({ lyrics: null });
    mocks.load.mockImplementation(async () => { usePlaybackStore.setState({ currentSong: { ...song, id: 'another' } }); return { lyricsSource: 'imported', importedLyrics: lyrics }; });
    await applyPreparedLyricsToPlayback(song, set, persist, () => true); expect(set).not.toHaveBeenCalled();
    usePlaybackStore.setState({ currentSong: song }); mocks.load.mockResolvedValue({ lyricsSource: 'imported', importedLyrics: lyrics });
    await applyPreparedLyricsToPlayback(song, set, persist, () => false); expect(set).not.toHaveBeenCalled();
});
