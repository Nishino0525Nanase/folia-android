import type { OnlineLyricsState, SongResult } from '../../types';
import { omni } from '../onlineMusic/omni';
import { autoMatchBestLyric } from '../../utils/lyrics/autoMatchBestLyric';
import { hasAuthoritativeOnlineLyricsSelection, loadOnlineLyricsState, savePreparedOnlineLyrics } from '../../utils/onlineLyricsState';
import { useLyricSettingsStore } from '../../stores/useLyricSettingsStore';
import { resolveLyricSourcePreference } from '../../utils/lyrics/lyricSourcePreference';
import type { PreparationResult } from './lyricPreparationQueue';

// Explicit cross-source lyric matching changes lyrics only; playback remains the original media.
export const prepareSongLyrics = async (song: SongResult, isCurrent: () => boolean): Promise<PreparationResult> => {
    if (hasAuthoritativeOnlineLyricsSelection(await loadOnlineLyricsState(song))) return 'ready';
    if (!isCurrent()) return 'failed';
    if (omni.hasMediaTimedLyrics(song)) {
        const original = await omni.getLyrics(song);
        if (!isCurrent()) return 'failed';
        if (original.lyrics?.mediaSubtitle) {
            const saved = await savePreparedOnlineLyrics(song, {
                lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: original.lyrics, matchedIsPureMusic: false,
            }, isCurrent);
            return saved || hasAuthoritativeOnlineLyricsSelection(await loadOnlineLyricsState(song)) ? 'ready' : 'failed';
        }
    }
    const target = omni.getLyricMatchTarget(song);
    if (target.autoMatch === false) return 'review';
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
        if (!result) return 'unmatched';
        const state: OnlineLyricsState = 'lyrics' in result ? {
            lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: result.lyrics,
            matchedSongId: result.id, matchedLyricsSource: result.source,
            matchedLyricsProviderPlatform: result.matchedLyricsProviderPlatform, matchedIsPureMusic: false,
        } : { lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: null, matchedIsPureMusic: true,
            matchedLyricsSource: result.source, matchedSongId: result.id };
        const saved = await savePreparedOnlineLyrics(song, state, current);
        return saved || hasAuthoritativeOnlineLyricsSelection(await loadOnlineLyricsState(song)) ? 'ready' : 'failed';
    } finally { if (timer) clearTimeout(timer); expired = true; }
};
