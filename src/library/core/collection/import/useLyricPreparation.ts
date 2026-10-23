import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { omni } from '../../../../services/onlineMusic/omni';
import { lyricPreparation } from '../../../../services/lyricPreparation/lyricPreparation';
import { useLyricSettingsStore } from '../../../../stores/useLyricSettingsStore';

// Collection progress observes bounded job updates; playback time never updates this view.
export type LyricPreparationModel = {
    label: string; detail: string; done: number; total: number;
    toggle?: { label: string; run: () => void };
    retry?: { label: string; run: () => void };
};
export const useLyricPreparation = (group: string): LyricPreparationModel | undefined => {
    const { t } = useTranslation();
    const automaticMatching = useLyricSettingsStore(state => state.autoUseBestLyric);
    const snapshot = useSyncExternalStore(lyricPreparation.subscribe, lyricPreparation.getSnapshot);
    useEffect(() => { void lyricPreparation.initialize(); }, []);
    return useMemo(() => {
        const entries = snapshot.entries.filter(entry => entry.groups.includes(group));
        if (!entries.length) return undefined;
        const enabled = automaticMatching || entries.some(entry => omni.hasMediaTimedLyrics(entry.song));
        const total = entries.length;
        const ready = entries.filter(entry => entry.status === 'ready').length;
        const review = entries.filter(entry => entry.status === 'review').length;
        const missed = entries.filter(entry => entry.status === 'unmatched' || entry.status === 'failed').length;
        const done = ready + review + missed;
        const noSubtitles = entries.filter(entry => entry.mediaSubtitleStatus === 'none').length;
        const login = entries.filter(entry => entry.mediaSubtitleStatus === 'login-required').length;
        const failedSubtitle = entries.filter(entry => entry.mediaSubtitleStatus === 'unavailable').length;
        const refused = entries.filter(entry => entry.mediaSubtitleStatus === 'refused').length;
        const invalid = entries.filter(entry => entry.mediaSubtitleStatus === 'invalid').length;
        const recognizing = entries.find(entry => entry.status === 'recognizing');
        const queued = entries.filter(entry => entry.status === 'audio-pending').length;
        return {
            label: t(!enabled ? 'lyricPreparation.disabled' : snapshot.paused ? 'lyricPreparation.paused'
                : done < total ? 'lyricPreparation.running' : 'lyricPreparation.complete', { done, total }),
            detail: [t('lyricPreparation.results', { ready, review, missed }),
                noSubtitles ? t('lyricPreparation.noSubtitleTracks', { count: noSubtitles }) : '',
                login ? t('lyricPreparation.subtitleLogin', { count: login }) : '',
                failedSubtitle ? t('lyricPreparation.subtitleUnavailable', { count: failedSubtitle }) : '',
                refused ? t('lyricPreparation.subtitleRefused', { count: refused }) : '',
                invalid ? t('lyricPreparation.subtitleInvalid', { count: invalid }) : '',
                recognizing ? t('lyricPreparation.recognizing', { name: recognizing.song.name, progress: recognizing.audioProgress ?? 0 }) : '',
                queued ? t('lyricPreparation.audioQueued', { count: queued }) : ''].filter(Boolean).join(' · '), done, total,
            toggle: enabled && done < total ? { label: t(snapshot.paused ? 'lyricPreparation.resume' : 'lyricPreparation.pause'), run: lyricPreparation.togglePause } : undefined,
            retry: enabled && done === total && missed + review + failedSubtitle + login + refused + invalid > 0
                ? { label: t('lyricPreparation.retry'), run: () => lyricPreparation.retry(group) } : undefined,
        };
    }, [automaticMatching, group, snapshot, t]);
};
