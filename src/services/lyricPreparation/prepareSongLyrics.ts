import type { OnlineLyricsState, SongResult } from '../../types';
import type { MediaSubtitleStatus } from '../../types/onlineMusic';
import { omni } from '../onlineMusic/omni';
import { autoMatchBestLyric } from '../../utils/lyrics/autoMatchBestLyric';
import { canUpgradeToMediaSubtitles, hasAuthoritativeOnlineLyricsSelection, loadOnlineLyricsState, savePreparedOnlineLyrics } from '../../utils/onlineLyricsState';
import { useLyricSettingsStore } from '../../stores/useLyricSettingsStore';
import { resolveLyricSourcePreference } from '../../utils/lyrics/lyricSourcePreference';
import type { PreparationOutcome, PreparationResult } from './lyricPreparationQueue';

// Explicit cross-source lyric matching changes lyrics only; playback remains the original media.
export const prepareSongLyrics = async (song: SongResult, isCurrent: () => boolean): Promise<PreparationOutcome> => {
    const savedSelection = await loadOnlineLyricsState(song);
    const hasSaved = hasAuthoritativeOnlineLyricsSelection(savedSelection);
    const originalSubtitles = omni.hasMediaTimedLyrics(song);
    if (hasSaved && !(originalSubtitles && canUpgradeToMediaSubtitles(savedSelection))) return 'ready';
    let mediaSubtitleStatus: MediaSubtitleStatus | undefined;
    const outcome = (status: PreparationResult): PreparationOutcome => mediaSubtitleStatus ? { status, mediaSubtitleStatus } : status;
    if (!isCurrent()) return 'failed';
    if (originalSubtitles) {
        const original = await omni.getLyrics(song);
        mediaSubtitleStatus = original.mediaSubtitleStatus;
        if (!isCurrent()) return 'failed';
        if (original.lyrics?.mediaSubtitle) {
            const saved = await savePreparedOnlineLyrics(song, {
                lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: original.lyrics, matchedIsPureMusic: false,
            }, isCurrent);
            return saved || hasAuthoritativeOnlineLyricsSelection(await loadOnlineLyricsState(song)) ? 'ready' : 'failed';
        }
    }
    if (hasSaved) return outcome('ready');
    // Retrieving the video's own cues is independent of the optional cross-catalogue lyric upgrade.
    if (useLyricSettingsStore.getState().autoUseBestLyric === false) return outcome('unmatched');
    const target = omni.getLyricMatchTarget(song);
    if (target.autoMatch === false) return outcome('review');
    if (!isCurrent()) return 'failed';
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => !expired && isCurrent();
    try {
        const result = await Promise.race([
            autoMatchBestLyric(target.title, target.artist, target.durationMs, {
                album: target.album, durationToleranceMs: target.durationToleranceMs,
                requireUniqueTitleMatch: target.requireUniqueTitleMatch, acceptLineByLine: true,
                preferredSource: resolveLyricSourcePreference(useLyricSettingsStore.getState(), song), isCurrent: current,
            }),
            new Promise<null>(resolve => { timer = setTimeout(() => { expired = true; resolve(null); }, 90_000); }),
        ]);
        if (!current()) return 'failed';
        if (!result) return outcome('unmatched');
        const state: OnlineLyricsState = 'lyrics' in result ? {
            lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: result.lyrics,
            matchedSongId: result.id, matchedLyricsSource: result.source,
            matchedLyricsProviderPlatform: result.matchedLyricsProviderPlatform, matchedIsPureMusic: false,
        } : { lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: null, matchedIsPureMusic: true,
            matchedLyricsSource: result.source, matchedSongId: result.id };
        const saved = await savePreparedOnlineLyrics(song, state, current);
        return outcome(saved || hasAuthoritativeOnlineLyricsSelection(await loadOnlineLyricsState(song)) ? 'ready' : 'failed');
    } finally { if (timer) clearTimeout(timer); expired = true; }
};
