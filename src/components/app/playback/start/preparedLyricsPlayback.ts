import type { LyricData, SongResult } from '../../../../types';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { loadOnlineLyricsState, resolveOnlineLyrics } from '../../../../utils/onlineLyricsState';
import { hasRenderableLyrics } from '../../../../utils/lyrics/validity';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { readLyricOffset } from '../../../../utils/lyrics/lyricOffsetMemory';
import { AUTOMATIC_SUBTITLES_NAME } from '../../../../utils/lyrics/automaticSubtitleIdentity';

// A finished import task can fill the currently empty player without a track restart or a manual Apply action.
export const applyPreparedLyricsToPlayback = async (song: SongResult, setLyrics: (lyrics: LyricData) => void,
    persist: (song: SongResult | null, queue: SongResult[]) => Promise<void>, active: () => boolean): Promise<void> => {
    const before = usePlaybackStore.getState();
    if (!before.currentSong || getPlaybackSongKey(before.currentSong) !== getPlaybackSongKey(song) || hasRenderableLyrics(before.lyrics)) return;
    const saved = await loadOnlineLyricsState(song);
    const lyrics = resolveOnlineLyrics(saved, null);
    const now = usePlaybackStore.getState();
    if (!active() || now.currentSong !== before.currentSong || now.lyrics !== before.lyrics || !hasRenderableLyrics(lyrics)) return;
    const updated = { ...now.currentSong, onlineLyricsState: saved ?? undefined };
    now.setCurrentSong(updated);
    setLyrics(lyrics);
    if (saved?.importedLyricsName === AUTOMATIC_SUBTITLES_NAME) now.setLyricTimelineOffsetMs(readLyricOffset(song.id));
    now.setCurrentLineIndex(-1);
    await persist(updated, now.playQueue);
};
