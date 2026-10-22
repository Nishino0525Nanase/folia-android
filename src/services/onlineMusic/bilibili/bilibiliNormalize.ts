import type { SongResult, UnifiedSong } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/bilibili/bilibiliNormalize.ts
// Video and part IDs survive imports; temporary media URLs never become song identity.
export interface BilibiliPage {
    cid: number;
    page: number;
    title: string;
    durationSec: number;
}

export interface BilibiliResolvedVideo {
    bvid: string;
    aid: number;
    title: string;
    coverUrl: string;
    owner: { id: number; name: string };
    pages: BilibiliPage[];
    selectedPage?: number;
}

const record = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const bvidPattern = /^BV[0-9A-Za-z]{10}$/;

export const parseBilibiliMediaId = (value: unknown): { bvid: string; cid: number } | null => {
    if (typeof value !== 'string') return null;
    const match = /^(BV[0-9A-Za-z]{10}):([1-9]\d*)$/.exec(value);
    const cid = Number(match?.[2]);
    return match && positive(cid) ? { bvid: match[1], cid } : null;
};

const coverUrl = (value: unknown): string => {
    const input = text(value).replace(/^http:\/\//, 'https://').replace(/^\/\//, 'https://');
    try {
        const url = new URL(input);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
};

export const readBilibiliResolvedVideo = (value: unknown): BilibiliResolvedVideo => {
    const raw = record(value);
    const owner = record(raw.owner);
    const pages = Array.isArray(raw.pages) ? raw.pages.map(record) : [];
    if (!bvidPattern.test(text(raw.bvid)) || !positive(raw.aid) || !text(raw.title)
        || !positive(owner.id) || !text(owner.name) || !pages.length
        || pages.some(page => !positive(page.cid) || !positive(page.page) || !text(page.title)
            || typeof page.durationSec !== 'number' || !Number.isFinite(page.durationSec) || page.durationSec < 0)) {
        throw new OnlineProviderError('invalid-response', 'The video response is incomplete', 'bilibili');
    }
    const selectedPage = raw.selectedPage;
    if (selectedPage !== undefined && (!positive(selectedPage) || !pages.some(page => page.page === selectedPage))) {
        throw new OnlineProviderError('invalid-response', 'The requested video part is unavailable', 'bilibili');
    }
    if (new Set(pages.map(page => page.cid)).size !== pages.length || new Set(pages.map(page => page.page)).size !== pages.length) {
        throw new OnlineProviderError('invalid-response', 'The video contains duplicate part identifiers', 'bilibili');
    }
    return {
        bvid: text(raw.bvid), aid: raw.aid, title: text(raw.title), coverUrl: coverUrl(raw.coverUrl),
        owner: { id: owner.id, name: text(owner.name) },
        pages: pages.map(page => ({ cid: page.cid as number, page: page.page as number, title: text(page.title), durationSec: page.durationSec as number })),
        ...(selectedPage === undefined ? {} : { selectedPage: selectedPage as number }),
    };
};

export const bilibiliVideoSongs = (video: BilibiliResolvedVideo, respectSelectedPart = true): UnifiedSong[] => (
    video.pages.filter(page => !respectSelectedPart || video.selectedPage === undefined || page.page === video.selectedPage)
        .map(page => ({
            id: `${video.bvid}:${page.cid}`,
            name: video.pages.length === 1 ? video.title : page.title,
            artists: [{ id: video.owner.id, name: video.owner.name }],
            album: { id: video.bvid, name: video.title, coverUrl: video.coverUrl },
            durationMs: Math.round(page.durationSec * 1000),
            sourceRef: {
                kind: 'online' as const, providerId: 'bilibili', mediaId: `${video.bvid}:${page.cid}`,
                providerData: { bvid: video.bvid, cid: page.cid, aid: video.aid, page: page.page },
            },
        }))
);

// Rebuild stored songs from their stable IDs, keeping only display metadata and the part number.
export const normalizeBilibiliSong = (value: unknown): UnifiedSong => {
    const raw = record(value);
    const source = record(raw.sourceRef);
    const identity = source.kind === 'online' && source.providerId === 'bilibili' ? parseBilibiliMediaId(source.mediaId) : null;
    const data = record(source.providerData);
    const album = record(raw.album);
    const artists = Array.isArray(raw.artists) ? raw.artists.map(record) : [];
    const durationMs = raw.durationMs;
    if (!identity || !text(raw.name) || !positive(data.page) || !positive(data.aid)
        || typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
        throw new OnlineProviderError('invalid-response', 'The imported video identity is incomplete', 'bilibili');
    }
    return {
        id: `${identity.bvid}:${identity.cid}`, name: text(raw.name),
        artists: artists.filter(artist => text(artist.name)).map(artist => ({ id: positive(artist.id) ? artist.id : 0, name: text(artist.name) })),
        album: { id: identity.bvid, name: text(album.name), coverUrl: coverUrl(album.coverUrl) },
        durationMs,
        sourceRef: { kind: 'online', providerId: 'bilibili', mediaId: `${identity.bvid}:${identity.cid}`,
            providerData: { ...identity, aid: data.aid, page: data.page } },
    };
};

export const bilibiliSongPageUrl = (song: SongResult): string | null => {
    const source = song.sourceRef;
    if (source?.kind !== 'online' || source.providerId !== 'bilibili') return null;
    const identity = parseBilibiliMediaId(source.mediaId);
    if (!identity) return null;
    const page = source.providerData?.page;
    return `https://www.bilibili.com/video/${identity.bvid}/${positive(page) ? `?p=${page}` : ''}`;
};
