import type { LyricData, OnlineLyricsState, SongResult } from '../../types';
import type { MediaId, OmniLyricsResult } from '../../types/onlineMusic';
import { getOnlineProviderIdForSong } from '../../utils/appPlaybackGuards';
import { hasAuthoritativeOnlineLyricsSelection, loadOnlineLyricsState, resolveOnlineLyrics } from '../../utils/onlineLyricsState';
import { omni } from './omni';

// A source can play audio without native lyrics; saved manual selections remain authoritative.

export const getOptionalProviderLyrics = async (
    song: SongResult,
    context?: { userId?: MediaId | null },
): Promise<OmniLyricsResult> => {
    const providerId = getOnlineProviderIdForSong(song);
    if (providerId && !omni.getProviderCapabilities(providerId).lyrics) {
        return { lyrics: null, isPureMusic: false, chorusRanges: [] };
    }
    return omni.getLyrics(song, context);
};

/** Manual lyrics need no original-provider request, including an explicit choice of no lyrics. */
export const resolveSavedOnlineLyrics = async (
    song: SongResult,
    loadBase: () => Promise<LyricData | null>,
): Promise<{ state: OnlineLyricsState | null; lyrics: LyricData | null }> => {
    const state = await loadOnlineLyricsState(song);
    if (hasAuthoritativeOnlineLyricsSelection(state)) {
        return { state, lyrics: resolveOnlineLyrics(state, null) };
    }
    return { state, lyrics: resolveOnlineLyrics(state, await loadBase()) };
};
