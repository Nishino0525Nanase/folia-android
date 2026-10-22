import type { SongResult, UnifiedSong } from '../../../types';
import type { ProviderCollection, ProviderUser } from '../../../types/onlineMusic';
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

export type BilibiliMediaIdentity = { bvid: string; cid: number; first?: false } | { bvid: string; first: true; cid?: never };

export const parseBilibiliMediaId = (value: unknown): BilibiliMediaIdentity | null => {
    if (typeof value !== 'string') return null;
    const first = /^(BV[0-9A-Za-z]{10}):first$/.exec(value);
    if (first) return { bvid: first[1], first: true };
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
        id: identity.first ? `${identity.bvid}:first` : `${identity.bvid}:${identity.cid}`, name: text(raw.name),
        artists: artists.filter(artist => text(artist.name)).map(artist => ({ id: positive(artist.id) ? artist.id : numericId(artist.id) || 0, name: text(artist.name) })),
        album: { id: identity.bvid, name: text(album.name), coverUrl: coverUrl(album.coverUrl) },
        durationMs,
        sourceRef: { kind: 'online', providerId: 'bilibili', mediaId: identity.first ? `${identity.bvid}:first` : `${identity.bvid}:${identity.cid}`,
            providerData: { bvid: identity.bvid, ...(identity.first ? { firstPart: true } : { cid: identity.cid }), aid: data.aid, page: data.page } },
    };
};

export const bilibiliSongPageUrl = (song: SongResult): string | null => {
    const source = song.sourceRef;
    if (source?.kind !== 'online' || source.providerId !== 'bilibili') return null;
    const identity = parseBilibiliMediaId(source.mediaId);
    if (!identity) return null;
    const page = identity.first ? 1 : source.providerData?.page;
    return `https://www.bilibili.com/video/${identity.bvid}/${positive(page) ? `?p=${page}` : ''}`;
};


const numericId = (value: unknown): string => {
    const id = typeof value === 'number' && positive(value) ? String(value) : text(value);
    return /^[1-9]\d{0,19}$/.test(id) ? id : '';
};

export const normalizeBilibiliUser = (value: unknown): ProviderUser => {
    const raw = record(value);
    const id = numericId(raw.id);
    if (!id || typeof raw.nickname !== 'string') throw new OnlineProviderError('invalid-response', 'The account response is incomplete', 'bilibili');
    return { id, nickname: text(raw.nickname), ...(coverUrl(raw.avatarUrl) ? { avatarUrl: coverUrl(raw.avatarUrl) } : {}) };
};

export const bilibiliFavoriteFolderId = (value: unknown): string | null => {
    const match = /^fav:([1-9]\d{0,19})$/.exec(String(value));
    return match?.[1] ?? null;
};

export const normalizeBilibiliFavoriteFolder = (value: unknown): ProviderCollection => {
    const raw = record(value);
    const owner = record(raw.owner);
    const existing = record(raw.providerData);
    const rawId = numericId(raw.id) || bilibiliFavoriteFolderId(raw.id);
    const ownerId = numericId(owner.id) || numericId(existing.ownerId);
    const name = text(raw.title) || text(raw.name);
    const trackCount = raw.trackCount;
    if (!rawId || !ownerId || !name || typeof trackCount !== 'number' || !Number.isSafeInteger(trackCount) || trackCount < 0) {
        throw new OnlineProviderError('invalid-response', 'The favorite folder response is incomplete', 'bilibili');
    }
    return {
        providerId: 'bilibili', id: `fav:${rawId}`, type: 'playlist', name,
        coverUrl: coverUrl(raw.coverUrl), description: text(raw.description), trackCount, isOwned: true,
        creator: { id: ownerId, nickname: text(owner.name) || text(record(raw.creator).nickname) },
        providerData: { ownerId, kind: 'favorite-folder' },
    };
};

// A favorite resource names a video, not a cid. Its first-part intent stays explicit until playback.
export const normalizeBilibiliFavoriteVideo = (value: unknown): UnifiedSong => {
    const raw = record(value);
    const owner = record(raw.owner);
    const bvid = text(raw.bvid);
    const ownerId = numericId(owner.id);
    if (!bvidPattern.test(bvid) || !positive(raw.aid) || !text(raw.title) || !ownerId || !text(owner.name)
        || typeof raw.durationSec !== 'number' || !Number.isFinite(raw.durationSec) || raw.durationSec < 0) {
        throw new OnlineProviderError('invalid-response', 'The favorite video response is incomplete', 'bilibili');
    }
    return {
        id: `${bvid}:first`, name: text(raw.title), artists: [{ id: ownerId, name: text(owner.name) }],
        album: { id: bvid, name: text(raw.title), coverUrl: coverUrl(raw.coverUrl) },
        // A multipart video's aggregate duration is not the duration of the part that will play.
        durationMs: raw.pageCount === 1 ? Math.round(raw.durationSec * 1000) : 0,
        sourceRef: { kind: 'online', providerId: 'bilibili', mediaId: `${bvid}:first`,
            providerData: { bvid, aid: raw.aid, page: 1, firstPart: true } },
    };
};
