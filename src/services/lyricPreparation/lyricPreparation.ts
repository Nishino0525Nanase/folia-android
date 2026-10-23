import type { SongResult } from '../../types';
import type { OmniCollection } from '../../types/onlineMusic';
import { omni } from '../onlineMusic/omni';
import { putCacheEntry, readCacheEntry } from '../repositories/cacheRepository';
import { useLyricSettingsStore } from '../../stores/useLyricSettingsStore';
import { createLyricPreparationQueue, type PreparationSnapshot } from './lyricPreparationQueue';
import { prepareSongLyrics } from './prepareSongLyrics';
import { recognizeMissingLyrics } from './automaticAudioLyrics';

// Shared background preparation is outside adapters: songs are matched through Omni and the lyric-source registry.
const CACHE_KEY = 'lyricPreparation_jobs_v1';
export const lyricPreparation = createLyricPreparationQueue({
    load: () => readCacheEntry<PreparationSnapshot>(CACHE_KEY),
    save: state => putCacheEntry(CACHE_KEY, state),
    prepare: prepareSongLyrics,
    recognize: recognizeMissingLyrics,
    canRun: () => (typeof navigator === 'undefined' || navigator.onLine !== false)
        && useLyricSettingsStore.getState().autoUseBestLyric,
    wait: () => new Promise(resolve => setTimeout(resolve, 500)),
});
if (typeof window !== 'undefined') {
    window.addEventListener('online', lyricPreparation.wake);
    window.addEventListener('offline', lyricPreparation.wake);
}
useLyricSettingsStore.subscribe((state, previous) => {
    if (state.autoUseBestLyric !== previous.autoUseBestLyric) lyricPreparation.wake();
});

export const lyricPreparationGroup = (collection: OmniCollection): string => `online:${collection.providerId}:${collection.type}:${collection.id}`;

export const enqueueImportedLyrics = (songs: SongResult[], group: string): Promise<void> => {
    if (!useLyricSettingsStore.getState().autoUseBestLyric) return Promise.resolve();
    return lyricPreparation.enqueue(songs, group);
};

// Existing imported/video collections are prepared as their cached and newly loaded pages become available.
export const enqueueCollectionLyrics = (collection: OmniCollection, songs: SongResult[]): void => {
    if (!omni.canImportCollection(collection) || omni.getProviderCapabilities(collection.providerId).lyrics) return;
    void enqueueImportedLyrics(songs, lyricPreparationGroup(collection)).catch(error => console.warn('[LyricPreparation] Could not enqueue collection', error));
};
