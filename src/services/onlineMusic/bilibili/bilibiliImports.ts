import i18n from '../../../i18n/config';
import type { UnifiedSong } from '../../../types';
import type { ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import { getProviderCacheKey } from '../providerStorage';
import { putCacheEntry, readCacheEntry } from '../../repositories/cacheRepository';
import { normalizeBilibiliSong } from './bilibiliNormalize';

// src/services/onlineMusic/bilibili/bilibiliImports.ts
// A local list of imported references, not the platform account's library or downloaded audio.
export const BILIBILI_IMPORTED_COLLECTION_ID = 'local-imports';
const cacheKey = getProviderCacheKey('bilibili', 'imported_videos_v1');
let lastWrite: Promise<void> = Promise.resolve();

const readImports = async (): Promise<UnifiedSong[]> => {
    const value = await readCacheEntry<{ version?: unknown; songs?: unknown[] }>(cacheKey);
    if (value?.version !== 1 || !Array.isArray(value.songs)) return [];
    return value.songs.flatMap(song => {
        try { return [normalizeBilibiliSong(song)]; } catch { return []; }
    });
};

export const loadBilibiliImports = async (): Promise<UnifiedSong[]> => {
    await lastWrite.catch(() => undefined);
    return readImports();
};

export const keepBilibiliImports = (songs: UnifiedSong[]): Promise<void> => {
    const write = lastWrite.catch(() => undefined).then(async () => {
        const prior = await readImports();
        const merged = new Map<string, UnifiedSong>();
        // Latest imported references come first, with a fresh title when importing one again.
        for (const song of [...songs, ...prior]) {
            const normalized = normalizeBilibiliSong(song);
            if (!merged.has(normalized.sourceRef.mediaId)) merged.set(normalized.sourceRef.mediaId, normalized);
        }
        await putCacheEntry(cacheKey, { version: 1, songs: [...merged.values()] });
    });
    lastWrite = write;
    return write;
};

export const bilibiliPage = <T>(items: T[], limit: number, offset: number): ProviderPage<T> => {
    const start = Math.max(0, Math.floor(offset));
    const count = Math.max(1, Math.floor(limit));
    const rows = items.slice(start, start + count);
    return { items: rows, total: items.length, hasMore: start + rows.length < items.length, nextOffset: start + rows.length };
};

export const getBilibiliImportedCollection = async (): Promise<ProviderCollection> => {
    const songs = await loadBilibiliImports();
    return {
        providerId: 'bilibili', id: BILIBILI_IMPORTED_COLLECTION_ID, type: 'playlist',
        name: i18n.t('importSource.importedVideos'), trackCount: songs.length,
        coverUrl: songs[0]?.album.coverUrl, isOwned: false,
    };
};
