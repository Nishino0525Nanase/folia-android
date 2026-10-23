import { useEffect } from 'react';
import type { LyricData, SongResult } from '../../../../types';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { lyricPreparation } from '../../../../services/lyricPreparation/lyricPreparation';
import { applyPreparedLyricsToPlayback } from './preparedLyricsPlayback';

// Observe job completion imperatively; recognition percentages never rerender the playback controller.
export const usePreparedLyricsPlayback = (song: SongResult | null, setLyrics: (lyrics: LyricData | null) => void,
    persist: (song: SongResult | null, queue: SongResult[]) => Promise<void>) => {
    useEffect(() => { void lyricPreparation.initialize(); }, []);
    useEffect(() => {
        if (!song || song.sourceRef?.kind !== 'online') return;
        let active = true, handled = -1;
        const key = getPlaybackSongKey(song);
        const check = () => {
            const entry = lyricPreparation.getSnapshot().entries.find(entry => entry.key === key && entry.status === 'ready');
            if (!entry || entry.updatedAt === handled) return;
            handled = entry.updatedAt;
            void applyPreparedLyricsToPlayback(song, setLyrics, persist, () => active)
                .catch(error => console.warn('[LyricPreparation] Could not display prepared lyrics', error));
        };
        const unsubscribe = lyricPreparation.subscribe(check);
        check();
        return () => { active = false; unsubscribe(); };
    }, [song, setLyrics, persist]);
};
