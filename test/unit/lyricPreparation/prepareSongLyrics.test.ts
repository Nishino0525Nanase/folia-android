import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { prepareSongLyrics } from '@/services/lyricPreparation/prepareSongLyrics';

// A whole preparation job must honour stored choices, confidence and cancellation before saving.
const mocks = vi.hoisted(() => ({ load: vi.fn(), match: vi.fn(), save: vi.fn(), target: vi.fn() }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: { getLyricMatchTarget: mocks.target } }));
vi.mock('@/utils/lyrics/autoMatchBestLyric', () => ({ autoMatchBestLyric: mocks.match }));
vi.mock('@/utils/onlineLyricsState', () => ({ loadOnlineLyricsState: mocks.load, savePreparedOnlineLyrics: mocks.save,
    hasAuthoritativeOnlineLyricsSelection: (state: any) => Boolean(state?.hasOnlineOverride || state?.importedLyrics) }));
vi.mock('@/stores/useLyricSettingsStore', () => ({ useLyricSettingsStore: { getState: () => ({}) } }));
vi.mock('@/utils/lyrics/lyricSourcePreference', () => ({ resolveLyricSourcePreference: () => 'qq' }));
const song = { id: 'video', name: '晴る' } as SongResult;
beforeEach(() => {
    vi.resetAllMocks(); mocks.load.mockResolvedValue(null); mocks.save.mockResolvedValue(true);
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
