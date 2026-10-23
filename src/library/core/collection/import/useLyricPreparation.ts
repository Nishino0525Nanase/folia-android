import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
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
    const enabled = useLyricSettingsStore(state => state.autoUseBestLyric);
    const snapshot = useSyncExternalStore(lyricPreparation.subscribe, lyricPreparation.getSnapshot);
    useEffect(() => { void lyricPreparation.initialize(); }, []);
    return useMemo(() => {
        const entries = snapshot.entries.filter(entry => entry.groups.includes(group));
        if (!entries.length) return undefined;
        const total = entries.length;
        const ready = entries.filter(entry => entry.status === 'ready').length;
        const review = entries.filter(entry => entry.status === 'review').length;
        const missed = entries.filter(entry => entry.status === 'unmatched' || entry.status === 'failed').length;
        const done = ready + review + missed;
        const recognizing = entries.find(entry => entry.status === 'recognizing');
        const queued = entries.filter(entry => entry.status === 'audio-pending').length;
        return {
            label: t(!enabled ? 'lyricPreparation.disabled' : snapshot.paused ? 'lyricPreparation.paused'
                : done < total ? 'lyricPreparation.running' : 'lyricPreparation.complete', { done, total }),
            detail: [t('lyricPreparation.results', { ready, review, missed }),
                recognizing ? t('lyricPreparation.recognizing', { name: recognizing.song.name, progress: recognizing.audioProgress ?? 0 }) : '',
                queued ? t('lyricPreparation.audioQueued', { count: queued }) : ''].filter(Boolean).join(' · '), done, total,
            toggle: enabled && done < total ? { label: t(snapshot.paused ? 'lyricPreparation.resume' : 'lyricPreparation.pause'), run: lyricPreparation.togglePause } : undefined,
            retry: enabled && done === total && missed + review > 0 ? { label: t('lyricPreparation.retry'), run: () => lyricPreparation.retry(group) } : undefined,
        };
    }, [enabled, group, snapshot, t]);
};
