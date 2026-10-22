import type { OnlineMusicProvider } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { bilibiliSongPageUrl, bilibiliVideoSongs, normalizeBilibiliSong, parseBilibiliMediaId, normalizeBilibiliUser, normalizeBilibiliFavoriteFolder } from './bilibiliNormalize';
import { bilibiliAuth } from './bilibiliAuth';
import { getBilibiliFavoriteFolders, getBilibiliFavoriteTracks, importBilibiliFavoriteFolder } from './bilibiliLibrary';
import { bilibiliInputPageUrl } from './bilibiliInput';
import { getBilibiliApiBase, getBilibiliAudioSource, resolveBilibiliVideo } from './bilibiliTransport';
import { bilibiliPage, BILIBILI_IMPORTED_COLLECTION_ID, getBilibiliImportedCollection, keepBilibiliImports, loadBilibiliImports } from './bilibiliImports';

// src/services/onlineMusic/bilibili/bilibiliProvider.ts
// Experimental public-video link imports. Live verification was refused by the platform (HTTP 412).
export const bilibiliProvider: OnlineMusicProvider = {
    id: 'bilibili', displayName: 'Bilibili', shortName: 'B站', mark: { letter: '哔', color: '#fb7299' },
    getAvailability() {
        try { getBilibiliApiBase(); return { configured: true }; } catch { return { configured: false, reason: 'not-configured' }; }
    },
    capabilities: {
        search: false, playback: true, lyrics: false, auth: true, userLibrary: true, playlists: true,
        albums: false, artists: false, recommendations: false, mutations: false, wordByWordLyrics: false,
    },
    normalizeSong: normalizeBilibiliSong,
    normalizeUser: normalizeBilibiliUser,
    normalizeCollection: normalizeBilibiliFavoriteFolder,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    getSongPageUrl: bilibiliSongPageUrl,
    linkImport: {
        labelKey: 'importSource.bilibiliLabel', placeholderKey: 'importSource.bilibiliPlaceholder', descriptionKey: 'importSource.bilibiliDescription',
        async resolve(input) {
            const songs = bilibiliVideoSongs(await resolveBilibiliVideo(input));
            await keepBilibiliImports(songs);
            return songs;
        },
        getImported: loadBilibiliImports,
        getInputPageUrl: bilibiliInputPageUrl,
        importCollection: importBilibiliFavoriteFolder,
    },
    describeFailure(_operation, error) {
        if (!(error instanceof OnlineProviderError) || error.providerId !== 'bilibili') return null;
        const cause = error.cause as { code?: unknown; upstreamCode?: unknown } | undefined;
        const code = typeof cause?.code === 'string' ? cause.code : undefined;
        return {
            ...(error.code === 'not-playable' ? { case: 'no-audio' as const } : {}),
            ...(error.httpStatus === 403 || error.httpStatus === 412 || code?.includes('restricted') ? { case: 'refused' as const } : {}),
            message: error.message, httpStatus: error.httpStatus, code,
            ...(typeof cause?.upstreamCode === 'string' ? { upstreamCode: cause.upstreamCode } : {}),
        };
    },
    playback: {
        audioQualityLevels: ['high'],
        async getSongDetail(id) {
            const identity = parseBilibiliMediaId(String(id));
            if (!identity) return null;
            const video = await resolveBilibiliVideo(identity.bvid);
            const songs = bilibiliVideoSongs(video, false);
            if (identity.first) {
                const first = songs[0];
                return first ? normalizeBilibiliSong({ ...first, sourceRef: { kind: 'online', providerId: 'bilibili', mediaId: String(id), providerData: { aid: video.aid, page: 1 } } }) : null;
            }
            return songs.find(song => song.sourceRef.mediaId === String(id)) ?? null;
        },
        async getAudioSource(song) {
            const source = song.sourceRef;
            if (source?.kind !== 'online' || source.providerId !== 'bilibili') {
                throw new OnlineProviderError('unsupported', 'The song is not an imported video', 'bilibili');
            }
            return getBilibiliAudioSource(source.mediaId);
        },
        getAvailability: () => ({ state: 'unknown' }),
    },
    auth: bilibiliAuth,
    library: { getUserPlaylists: getBilibiliFavoriteFolders },
    catalog: {
        async getPlaylistDetail(id, collection) { return id === BILIBILI_IMPORTED_COLLECTION_ID ? getBilibiliImportedCollection() : collection ?? null; },
        async getPlaylistTracks(id, limit, offset) {
            return id === BILIBILI_IMPORTED_COLLECTION_ID ? bilibiliPage(await loadBilibiliImports(), limit, offset) : getBilibiliFavoriteTracks(id, limit, offset);
        },
    },
};
