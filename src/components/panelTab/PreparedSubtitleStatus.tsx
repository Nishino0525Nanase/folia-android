import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../types';
import { lyricPreparation } from '../../services/lyricPreparation/lyricPreparation';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';

// Explain this video's actual caption lookup result instead of treating every empty response as no lyrics.
export const PreparedSubtitleStatus = ({ song }: { song: SongResult }) => {
    const { t } = useTranslation();
    const key = getPlaybackSongKey(song);
    const status = useSyncExternalStore(lyricPreparation.subscribe, () =>
        lyricPreparation.getSnapshot().entries.find(entry => entry.key === key)?.mediaSubtitleStatus);
    const label = status === 'none' ? 'noSubtitleTracks' : status === 'login-required' ? 'subtitleLogin'
        : status === 'unavailable' ? 'subtitleUnavailable' : status === 'refused' ? 'subtitleRefused'
        : status === 'invalid' ? 'subtitleInvalid' : undefined;
    return label ? <p className="mt-3 text-xs opacity-65">{t(`lyricPreparation.${label}`, { count: 1 })}</p> : null;
};
