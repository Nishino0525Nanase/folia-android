import type { LyricData, SongResult } from '../../../../types';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { canUpgradeToMediaSubtitles, loadOnlineLyricsState, resolveOnlineLyrics } from '../../../../utils/onlineLyricsState';
import { hasRenderableLyrics } from '../../../../utils/lyrics/validity';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { readLyricOffset } from '../../../../utils/lyrics/lyricOffsetMemory';
import { AUTOMATIC_SUBTITLES_NAME } from '../../../../utils/lyrics/automaticSubtitleIdentity';

// A finished import task can fill the currently empty player without a track restart or a manual Apply action.
export const applyPreparedLyricsToPlayback = async (song: SongResult, setLyrics: (lyrics: LyricData) => void,
    persist: (song: SongResult | null, queue: SongResult[]) => Promise<void>, active: () => boolean): Promise<void> => {
    const before = usePlaybackStore.getState();
    if (!before.currentSong || getPlaybackSongKey(before.currentSong) !== getPlaybackSongKey(song)) return;
    const replacingAutomatic = hasRenderableLyrics(before.lyrics);
    if (replacingAutomatic && !canUpgradeToMediaSubtitles(before.currentSong.onlineLyricsState)) return;
    const saved = await loadOnlineLyricsState(song);
    if (replacingAutomatic && (saved?.selectionOrigin !== 'automatic' || !saved.onlineOverrideLyrics?.mediaSubtitle)) return;
    const lyrics = resolveOnlineLyrics(saved, null);
    const now = usePlaybackStore.getState();
    if (!active() || now.currentSong !== before.currentSong || now.lyrics !== before.lyrics || !hasRenderableLyrics(lyrics)) return;
    const updated = { ...now.currentSong, onlineLyricsState: saved ?? undefined, isPureMusic: false };
    now.setCurrentSong(current => current === before.currentSong ? updated : current);
    setLyrics(lyrics);
    if (saved?.onlineOverrideLyrics?.mediaSubtitle || saved?.importedLyricsName === AUTOMATIC_SUBTITLES_NAME) {
        now.setLyricTimelineOffsetMs(readLyricOffset(song.id));
    }
    now.setCurrentLineIndex(-1);
    await persist(updated, now.playQueue);
};
