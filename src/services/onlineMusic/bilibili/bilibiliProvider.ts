import type { OnlineMusicProvider } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { bilibiliSongPageUrl, bilibiliVideoSongs, normalizeBilibiliSong, parseBilibiliMediaId } from './bilibiliNormalize';
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
        search: false, playback: true, lyrics: false, auth: false, userLibrary: true, playlists: true,
        albums: false, artists: false, recommendations: false, mutations: false, wordByWordLyrics: false,
    },
    normalizeSong: normalizeBilibiliSong,
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
            return bilibiliVideoSongs(video, false).find(song => song.sourceRef.mediaId === String(id)) ?? null;
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
    library: {
        async getUserPlaylists(_userId, limit, offset) {
            const collection = await getBilibiliImportedCollection();
            return bilibiliPage(collection.trackCount ? [collection] : [], limit, offset);
        },
    },
    catalog: {
        async getPlaylistDetail(id) { return id === BILIBILI_IMPORTED_COLLECTION_ID ? getBilibiliImportedCollection() : null; },
        async getPlaylistTracks(id, limit, offset) {
            return bilibiliPage(id === BILIBILI_IMPORTED_COLLECTION_ID ? await loadBilibiliImports() : [], limit, offset);
        },
    },
};
