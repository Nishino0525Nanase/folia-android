import type { SongResult } from '../../types';
import type { OmniCollection } from '../../types/onlineMusic';
import { omni } from '../onlineMusic/omni';
import { putCacheEntry, readCacheEntry } from '../repositories/cacheRepository';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { useLyricSettingsStore } from '../../stores/useLyricSettingsStore';
import { isBackgroundRenderSuspended, subscribeBackgroundRenderSuspended } from '../../utils/backgroundRenderGate';
import { createLyricPreparationQueue, type PreparationSnapshot } from './lyricPreparationQueue';
import { prepareSongLyrics } from './prepareSongLyrics';

// Shared background preparation is outside adapters: songs are matched through Omni and the lyric-source registry.
const CACHE_KEY = 'lyricPreparation_jobs_v1';
export const lyricPreparation = createLyricPreparationQueue({
    load: () => readCacheEntry<PreparationSnapshot>(CACHE_KEY),
    save: state => putCacheEntry(CACHE_KEY, state),
    prepare: prepareSongLyrics,
    retryUnresolved: song => omni.hasMediaTimedLyrics(song),
    // Import preparation is text-only: no full audio download, decoding or speech model competes with playback.
    canRun: () => (typeof navigator === 'undefined' || navigator.onLine !== false)
        && !isBackgroundRenderSuspended() && (typeof document === 'undefined' || document.visibilityState !== 'hidden'),
    canRunSong: song => omni.hasMediaTimedLyrics(song) || useLyricSettingsStore.getState().autoUseBestLyric,
    wait: () => new Promise(resolve => setTimeout(resolve, 500)),
});
if (typeof window !== 'undefined') {
    window.addEventListener('online', () => lyricPreparation.retrySubtitleLookups());
    window.addEventListener('offline', lyricPreparation.wake);
    document.addEventListener('visibilitychange', lyricPreparation.wake);
}
subscribeBackgroundRenderSuspended(lyricPreparation.wake);
useLyricSettingsStore.subscribe((state, previous) => {
    if (state.autoUseBestLyric !== previous.autoUseBestLyric) lyricPreparation.wake();
});

// A confirmed login automatically resumes subtitle lookups that previously lacked a usable session.
useOnlineProviderAccountStore.subscribe((state, previous) => {
    for (const [providerId, account] of Object.entries(state.accounts)) {
        const before = previous.accounts[providerId];
        if (account.status === 'authenticated' && (before?.status !== 'authenticated' || before.user?.id !== account.user?.id)) {
            lyricPreparation.retrySubtitleLookups(providerId);
        }
    }
});

export const lyricPreparationGroup = (collection: OmniCollection): string => `online:${collection.providerId}:${collection.type}:${collection.id}`;

export const enqueueImportedLyrics = (songs: SongResult[], group: string): Promise<void> => {
    const eligible = useLyricSettingsStore.getState().autoUseBestLyric ? songs : songs.filter(song => omni.hasMediaTimedLyrics(song));
    return eligible.length ? lyricPreparation.enqueue(eligible, group) : Promise.resolve();
};

// Existing imported/video collections are prepared as their cached and newly loaded pages become available.
export const enqueueCollectionLyrics = (collection: OmniCollection, songs: SongResult[]): void => {
    if (!omni.canImportCollection(collection) || (omni.getProviderCapabilities(collection.providerId).lyrics && !songs.some(song => omni.hasMediaTimedLyrics(song)))) return;
    void enqueueImportedLyrics(songs, lyricPreparationGroup(collection)).catch(error => console.warn('[LyricPreparation] Could not enqueue collection', error));
};
