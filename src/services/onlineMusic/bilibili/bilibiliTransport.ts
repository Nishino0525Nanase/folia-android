import i18n from '../../../i18n/config';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderAudioSource } from '../../../types/onlineMusic';
import { withOnlineRequestLimit } from '../failure/onlineRequestLimit';
import { parseBilibiliMediaId, readBilibiliResolvedVideo } from './bilibiliNormalize';
import type { BilibiliResolvedVideo } from './bilibiliNormalize';

// src/services/onlineMusic/bilibili/bilibiliTransport.ts
// Anonymous requests use the hosted adapter; no cookies, signatures or stored media URLs.
export const BILIBILI_REQUEST_LIMIT_MS = 35_000;

export const getBilibiliApiBase = (): string => {
    const configured = String(import.meta.env.VITE_BILIBILI_API_BASE || '/api/bilibili').trim().replace(/\/+$/, '');
    if (configured.startsWith('/') && !configured.startsWith('//') && !/[?#]/.test(configured)) return configured;
    try {
        const url = new URL(configured);
        if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return configured;
    } catch { /* A malformed deployment setting is unavailable, not a different backend. */ }
    throw new OnlineProviderError('unavailable', i18n.t('importSource.serviceUnavailable'), 'bilibili');
};

const errorFromResponse = async (response: Response): Promise<OnlineProviderError> => {
    let body: { code?: unknown; message?: unknown; upstreamCode?: unknown } = {};
    if (response.headers.get('content-type')?.includes('application/json')) {
        try {
            const value: unknown = await response.json();
            if (value && typeof value === 'object' && !Array.isArray(value)) body = value;
        } catch { /* HEAD failures use the safe error headers. */ }
    }
    const code = typeof body.code === 'string' ? body.code : response.headers.get('X-Folia-Error-Code') || 'request-failed';
    const upstream = body.upstreamCode ?? response.headers.get('X-Folia-Upstream-Code');
    const upstreamCode = upstream === null || upstream === undefined ? undefined : String(upstream);
    const restricted = response.status === 403 || response.status === 412 || code.includes('restricted');
    const messageKey = response.status === 400 ? 'importSource.bilibiliPlaceholder' : restricted ? 'importSource.platformRestricted'
        : response.status === 404 ? 'importSource.videoUnavailable'
            : response.status === 422 ? 'importSource.audioUnavailable'
                : response.status === 429 ? 'importSource.retryLater' : 'importSource.serviceUnavailable';
    return new OnlineProviderError(
        response.status === 400 ? 'unsupported' : response.status === 422 ? 'not-playable' : 'unavailable', i18n.t(messageKey), 'bilibili',
        { code, ...(upstreamCode === undefined ? {} : { upstreamCode }), httpStatus: response.status }, response.status,
    );
};

const request = async <T>(path: string, init: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> => withOnlineRequestLimit(async signal => {
    let response: Response;
    try {
        response = await fetch(`${getBilibiliApiBase()}${path}`, { ...init, signal, credentials: 'omit', cache: 'no-store' });
    } catch (error) {
        if (error instanceof OnlineProviderError) throw error;
        throw new OnlineProviderError('network', i18n.t('importSource.serviceUnavailable'), 'bilibili', error);
    }
    if (!response.ok) throw await errorFromResponse(response);
    return consume(response);
}, BILIBILI_REQUEST_LIMIT_MS);

export const resolveBilibiliVideo = async (input: string): Promise<BilibiliResolvedVideo> => {
    if (!input.trim() || input.length > 4096) {
        throw new OnlineProviderError('unsupported', i18n.t('importSource.bilibiliPlaceholder'), 'bilibili');
    }
    return request('/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: input.trim() }) }, async response => {
        let raw: unknown;
        try { raw = await response.json(); } catch {
            throw new OnlineProviderError('invalid-response', i18n.t('importSource.serviceUnavailable'), 'bilibili');
        }
        return readBilibiliResolvedVideo(raw);
    });
};

export const getBilibiliAudioSource = async (mediaId: string): Promise<ProviderAudioSource> => {
    const identity = parseBilibiliMediaId(mediaId);
    if (!identity) throw new OnlineProviderError('unsupported', i18n.t('importSource.videoUnavailable'), 'bilibili');
    const path = `/stream?${new URLSearchParams({ bvid: identity.bvid, cid: String(identity.cid) })}`;
    // HEAD checks normal public AAC access before the player receives a URL. GET still revalidates it.
    const response = await request(path, { method: 'HEAD' }, async response => response);
    if (!response.headers.get('content-type')?.startsWith('audio/mp4')) {
        throw new OnlineProviderError('invalid-response', i18n.t('importSource.audioUnavailable'), 'bilibili');
    }
    return { url: `${getBilibiliApiBase()}${path}`, fetchedAt: Date.now(), expiresAt: Date.now() + 60_000, quality: 'high' };
};
