import i18n from '../../../i18n/config';
import type { UnifiedSong } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { MediaId, ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import { bilibiliFavoriteFolderId, normalizeBilibiliFavoriteFolder, normalizeBilibiliFavoriteVideo } from './bilibiliNormalize';
import { keepBilibiliImports } from './bilibiliImports';
import { requestBilibiliAccount } from './bilibiliTransport';
import { getBilibiliSessionGeneration } from './bilibiliSession';

// src/services/onlineMusic/bilibili/bilibiliLibrary.ts
// The backend reads only folders owned by the verified account, without resolving every video's cid.
const record = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);
const invalid = (): OnlineProviderError => new OnlineProviderError('invalid-response', i18n.t('importSource.invalidResponse'), 'bilibili');
const remotePageSize = (limit: number): number => Math.min(20, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 20)));
const safeOffset = (offset: number): number => Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0));

const readPage = <T>(value: unknown, offset: number, normalize: (value: unknown) => T): ProviderPage<T> => {
    const raw = record(value);
    if (!Array.isArray(raw.items) || typeof raw.hasMore !== 'boolean' || typeof raw.nextOffset !== 'number'
        || !Number.isSafeInteger(raw.nextOffset) || raw.nextOffset < offset || (raw.hasMore && raw.nextOffset <= offset)
        || (raw.total !== undefined && (typeof raw.total !== 'number' || !Number.isSafeInteger(raw.total) || raw.total < 0))) throw invalid();
    // nextOffset counts all consumed upstream resources, including entries the backend reports as skipped.
    return { items: raw.items.map(normalize), hasMore: raw.hasMore, nextOffset: raw.nextOffset,
        ...(raw.total === undefined ? {} : { total: raw.total as number }) };
};

export const getBilibiliFavoriteFolders = async (userId: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>> => {
    const start = safeOffset(offset);
    const query = new URLSearchParams({ limit: String(remotePageSize(limit)), offset: String(start) });
    const response = await requestBilibiliAccount(`/favorites?${query}`);
    const page = readPage(response.data, start, normalizeBilibiliFavoriteFolder);
    if (page.items.some(folder => folder.creator?.id !== String(userId))) throw invalid();
    return page;
};

export const getBilibiliFavoriteTracks = async (id: MediaId, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> => {
    const folderId = bilibiliFavoriteFolderId(id);
    if (!folderId) throw new OnlineProviderError('unsupported', i18n.t('importSource.favoriteUnavailable'), 'bilibili');
    const start = safeOffset(offset);
    const query = new URLSearchParams({ limit: String(remotePageSize(limit)), offset: String(start) });
    const response = await requestBilibiliAccount(`/favorites/${folderId}/tracks?${query}`);
    return readPage(response.data, start, normalizeBilibiliFavoriteVideo);
};

export const getBilibiliFavoriteFolder = async (id: MediaId): Promise<ProviderCollection> => {
    const folderId = bilibiliFavoriteFolderId(id);
    if (!folderId) throw invalid();
    const response = await requestBilibiliAccount(`/favorites/${folderId}`);
    const folder = normalizeBilibiliFavoriteFolder(response.data);
    if (String(folder.id) !== `fav:${folderId}`) throw invalid();
    return folder;
};

export const importBilibiliFavoriteFolder = async (collection: ProviderCollection): Promise<UnifiedSong[]> => {
    if (collection.providerId !== 'bilibili' || !bilibiliFavoriteFolderId(collection.id)) {
        throw new OnlineProviderError('unsupported', i18n.t('importSource.favoriteUnavailable'), 'bilibili');
    }
    const generation = getBilibiliSessionGeneration();
    const songs = new Map<string, UnifiedSong>();
    let offset = 0;
    let hasMore = true;
    let pages = 0;
    while (hasMore) {
        if (generation !== getBilibiliSessionGeneration()) throw new OnlineProviderError('auth-required', i18n.t('importSource.loginRequired'), 'bilibili');
        const page = await getBilibiliFavoriteTracks(collection.id, 20, offset);
        for (const song of page.items) if (!songs.has(song.sourceRef.mediaId)) songs.set(song.sourceRef.mediaId, song);
        offset = page.nextOffset;
        hasMore = page.hasMore;
        if (++pages > 5000) throw invalid();
    }
    if (generation !== getBilibiliSessionGeneration()) throw new OnlineProviderError('auth-required', i18n.t('importSource.loginRequired'), 'bilibili');
    const imported = [...songs.values()];
    // Save once, after all pages are read. Failed reads do not masquerade as a complete imported folder.
    await keepBilibiliImports(imported);
    return imported;
};
