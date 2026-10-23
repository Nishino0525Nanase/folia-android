import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { prepareSongLyrics } from '@/services/lyricPreparation/prepareSongLyrics';

// A whole preparation job must honour stored choices, confidence and cancellation before saving.
const mocks = vi.hoisted(() => ({ load: vi.fn(), match: vi.fn(), save: vi.fn(), target: vi.fn(), media: vi.fn(), lyrics: vi.fn(), automatic: true }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { getLyricMatchTarget: mocks.target, hasMediaTimedLyrics: mocks.media, getLyrics: mocks.lyrics } }));
vi.mock('@/utils/lyrics/autoMatchBestLyric', () => ({ autoMatchBestLyric: mocks.match }));
vi.mock('@/utils/onlineLyricsState', () => ({ loadOnlineLyricsState: mocks.load, savePreparedOnlineLyrics: mocks.save,
    hasAuthoritativeOnlineLyricsSelection: (state: any) => Boolean(state?.hasOnlineOverride || state?.importedLyrics),
    canUpgradeToMediaSubtitles: (state: any) => state?.selectionOrigin === 'automatic' && state.lyricsSource === 'online' && !state.onlineOverrideLyrics?.mediaSubtitle }));
vi.mock('@/stores/useLyricSettingsStore', () => ({ useLyricSettingsStore: { getState: () => ({ autoUseBestLyric: mocks.automatic }) } }));
vi.mock('@/utils/lyrics/lyricSourcePreference', () => ({ resolveLyricSourcePreference: () => 'qq' }));
const song = { id: 'video', name: '晴る' } as SongResult;
beforeEach(() => {
    vi.resetAllMocks(); mocks.load.mockResolvedValue(null); mocks.save.mockResolvedValue(true);
    mocks.automatic = true;
    mocks.target.mockReturnValue({ title: '晴る', artist: '', durationMs: 271_000, requireUniqueTitleMatch: true });
});
afterEach(() => vi.useRealTimers());
it('uses already prepared or manually chosen lyrics without more searches', async () => {
    mocks.load.mockResolvedValue({ hasOnlineOverride: true });
    expect(await prepareSongLyrics(song, () => true)).toBe('ready');
    expect(mocks.match).not.toHaveBeenCalled();
});
it('marks ambiguous titles for review without guessing or downloading audio', async () => {
    mocks.target.mockReturnValue({ autoMatch: false });
    expect(await prepareSongLyrics(song, () => true)).toBe('review');
    expect(mocks.match).not.toHaveBeenCalled();
});
it('persists an automatic timed result against the original media identity', async () => {
    const lyrics = { lines: [{ startTime: 0, fullText: 'fixture' }], isWordByWord: false };
    mocks.match.mockResolvedValue({ source: 'lrclib', id: 1, lyrics });
    expect(await prepareSongLyrics(song, () => true)).toBe('ready');
    expect(mocks.match).toHaveBeenCalledWith('晴る', '', 271_000, expect.objectContaining({ acceptLineByLine: true, requireUniqueTitleMatch: true }));
    expect(mocks.save).toHaveBeenCalledWith(song, expect.objectContaining({ onlineOverrideLyrics: lyrics, matchedLyricsSource: 'lrclib', hasOnlineOverride: true }), expect.any(Function));
});
it('never saves a late result after the job was paused', async () => {
    let current = true; mocks.match.mockImplementation(async () => { current = false; return { source: 'lrclib', id: 1, isPureMusic: true }; });
    expect(await prepareSongLyrics(song, () => current)).toBe('failed');
    expect(mocks.save).not.toHaveBeenCalled();
});
it('bounds a stalled match and invalidates its continuation', async () => {
    vi.useFakeTimers(); mocks.match.mockImplementation(() => new Promise(() => {}));
    const result = prepareSongLyrics(song, () => true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await result).toBe('failed');
    expect(mocks.match.mock.calls[0][3].isCurrent()).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
});

it('uses original video captions before title matching, including ambiguous video titles', async () => {
    mocks.media.mockReturnValue(true); mocks.target.mockReturnValue({ autoMatch: false });
    const lyrics = { mediaSubtitle: { language: 'ja', automatic: false }, lines: [{ startTime: 12.4, endTime: 15, fullText: '字幕' }] };
    mocks.lyrics.mockResolvedValue({ lyrics, isPureMusic: false });
    expect(await prepareSongLyrics(song, () => true)).toBe('ready');
    expect(mocks.match).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(song, expect.objectContaining({ onlineOverrideLyrics: lyrics, matchedIsPureMusic: false }), expect.any(Function));
});
it('falls back to text search when the original video has no available subtitles', async () => {
    mocks.media.mockReturnValue(true); mocks.lyrics.mockResolvedValue({ lyrics: null, isPureMusic: false });
    mocks.match.mockResolvedValue(null);
    expect(await prepareSongLyrics(song, () => true)).toBe('unmatched');
    expect(mocks.match).toHaveBeenCalledOnce();
});
it('does not save original captions that finish after pausing the queue', async () => {
    let current = true; mocks.media.mockReturnValue(true);
    mocks.lyrics.mockImplementation(async () => { current = false; return { lyrics: { mediaSubtitle: {}, lines: [] } }; });
    expect(await prepareSongLyrics(song, () => current)).toBe('failed');
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.match).not.toHaveBeenCalled();
});
it('fetches original captions with catalogue matching switched off and never searches if no captions exist', async () => {
    mocks.automatic = false; mocks.media.mockReturnValue(true);
    const lyrics = { mediaSubtitle: { language: 'ja', automatic: false }, lines: [{ startTime: 12.4, endTime: 15, fullText: '字幕' }] };
    mocks.lyrics.mockResolvedValueOnce({ lyrics, mediaSubtitleStatus: 'available' });
    expect(await prepareSongLyrics(song, () => true)).toBe('ready');
    expect(mocks.save).toHaveBeenCalledOnce();
    mocks.lyrics.mockResolvedValueOnce({ lyrics: null, mediaSubtitleStatus: 'none' });
    expect(await prepareSongLyrics(song, () => true)).toEqual({ status: 'unmatched', mediaSubtitleStatus: 'none' });
    expect(mocks.match).not.toHaveBeenCalled();
});
it('preserves the failed subtitle diagnosis even if catalogue lyrics are ready for now', async () => {
    mocks.media.mockReturnValue(true); mocks.lyrics.mockResolvedValue({ lyrics: null, mediaSubtitleStatus: 'unavailable' });
    mocks.match.mockResolvedValue({ source: 'lrclib', id: 1, isPureMusic: true });
    expect(await prepareSongLyrics(song, () => true)).toEqual({ status: 'ready', mediaSubtitleStatus: 'unavailable' });
});
it('upgrades explicit automatic catalogue choices but protects manual and legacy saved selections', async () => {
    mocks.media.mockReturnValue(true);
    const lyrics = { mediaSubtitle: { language: 'ja', automatic: false }, lines: [] };
    mocks.lyrics.mockResolvedValue({ lyrics });
    for (const selectionOrigin of [undefined, 'manual']) {
        mocks.load.mockResolvedValue({ hasOnlineOverride: true, lyricsSource: 'online', selectionOrigin });
        expect(await prepareSongLyrics(song, () => true)).toBe('ready');
        expect(mocks.lyrics).not.toHaveBeenCalled();
    }
    mocks.load.mockResolvedValue({ hasOnlineOverride: true, lyricsSource: 'online', selectionOrigin: 'automatic' });
    expect(await prepareSongLyrics(song, () => true)).toBe('ready');
    expect(mocks.lyrics).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.match).not.toHaveBeenCalled();
});
