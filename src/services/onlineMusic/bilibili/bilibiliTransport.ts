import i18n from '../../../i18n/config';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderAudioSource } from '../../../types/onlineMusic';
import { withOnlineRequestLimit } from '../failure/onlineRequestLimit';
import { withLoginRequestLimit } from '../login/loginRequestLimit';
import { parseBilibiliMediaId, readBilibiliResolvedVideo } from './bilibiliNormalize';
import type { BilibiliResolvedVideo } from './bilibiliNormalize';
import { clearBilibiliSessionIfSent, getBilibiliSession, getBilibiliSessionGeneration } from './bilibiliSession';
import { usesNativeBilibili } from './bilibiliNative';
import { requestNativeBilibiliAccount } from './bilibiliNativeAccount';
import { getNativeBilibiliAudio, nativeMediaError, nativeVideoParams, resolveNativeBilibiliVideo } from './bilibiliNativeMedia';

// src/services/onlineMusic/bilibili/bilibiliTransport.ts
// Anonymous imports never receive account credentials; account APIs use only a sealed backend bearer.
export const BILIBILI_REQUEST_LIMIT_MS = 35_000;
export const BILIBILI_SESSION_HEADER = 'X-Bilibili-Session';

export const getBilibiliApiBase = (): string => {
    const configured = String(import.meta.env.VITE_BILIBILI_API_BASE || '/api/bilibili').trim().replace(/\/+$/, '');
    if (configured.startsWith('/') && !configured.startsWith('//') && !/[?#]/.test(configured)) return configured;
    try {
        const url = new URL(configured);
        if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return configured;
    } catch { /* A malformed deployment setting is unavailable, not a different backend. */ }
    throw new OnlineProviderError('unavailable', i18n.t('importSource.serviceUnavailable'), 'bilibili');
};

const record = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

const errorFromResponse = async (response: Response, login = false): Promise<OnlineProviderError> => {
    let body: Record<string, unknown> = {};
    if (response.headers.get('content-type')?.includes('application/json')) {
        try { body = record(await response.json()); } catch { /* HEAD failures use safe error headers. */ }
    }
    const code = typeof body.code === 'string' ? body.code : response.headers.get('X-Folia-Error-Code') || 'request-failed';
    const upstream = body.upstreamCode ?? response.headers.get('X-Folia-Upstream-Code');
    const upstreamCode = upstream === null || upstream === undefined ? undefined : String(upstream);
    const restricted = response.status === 403 || response.status === 412 || code.includes('restricted');
    const messageKey = response.status === 429 ? 'importSource.retryLater'
        : login && restricted ? 'home.loginBilibiliRestricted'
        : response.status === 401 ? 'importSource.loginRequired'
        : code === 'session-unavailable' || code === 'session-not-configured' ? 'importSource.sessionUnavailable'
            : login ? 'importSource.serviceUnavailable'
                : response.status === 400 ? 'importSource.bilibiliPlaceholder' : restricted ? 'importSource.platformRestricted'
                : response.status === 404 ? 'importSource.videoUnavailable'
                    : response.status === 422 ? 'importSource.audioUnavailable'
                        : 'importSource.serviceUnavailable';
    return new OnlineProviderError(
        response.status === 401 ? 'auth-required' : response.status === 400 ? 'unsupported' : response.status === 422 ? 'not-playable' : 'unavailable',
        i18n.t(messageKey), 'bilibili', { code, ...(upstreamCode === undefined ? {} : { upstreamCode }), httpStatus: response.status }, response.status,
    );
};

type RequestOptions = { account?: boolean; login?: boolean; session?: string };

const request = async <T>(path: string, init: RequestInit, consume: (response: Response) => Promise<T>, options: RequestOptions = {}): Promise<T> => {
    const sentSession = options.account ? options.session ?? getBilibiliSession() : '';
    const generation = getBilibiliSessionGeneration();
    const assertCurrentSession = () => {
        if (options.account && !options.login && generation !== getBilibiliSessionGeneration()) {
            throw new OnlineProviderError('unavailable', i18n.t('importSource.loginExpired'), 'bilibili', { code: 'session-changed' });
        }
    };
    const run = async (signal: AbortSignal): Promise<T> => {
        let response: Response;
        const headers = new Headers(init.headers);
        if (sentSession) headers.set(BILIBILI_SESSION_HEADER, sentSession);
        try {
            response = usesNativeBilibili() && options.account
                ? await requestNativeBilibiliAccount(path, init, sentSession)
                : await fetch(`${getBilibiliApiBase()}${path}`, {
                ...init, headers, signal, credentials: 'omit', cache: 'no-store',
                });
        } catch (error) {
            if (error instanceof OnlineProviderError) throw error;
            throw new OnlineProviderError('network', i18n.t('importSource.serviceUnavailable'), 'bilibili', error);
        }
        assertCurrentSession();
        if (!response.ok) {
            if (options.account && response.status === 401) clearBilibiliSessionIfSent(sentSession);
            throw await errorFromResponse(response, options.login);
        }
        const result = await consume(response);
        assertCurrentSession();
        return result;
    };
    return options.login ? withLoginRequestLimit(run) : withOnlineRequestLimit(run, BILIBILI_REQUEST_LIMIT_MS);
};

export const requestBilibiliAccount = async (
    path: string, init: RequestInit = {}, options: Omit<RequestOptions, 'account'> = {},
): Promise<{ data: unknown; session: string | null }> => request(path, init, async response => {
    let data: unknown;
    try { data = await response.json(); } catch {
        throw new OnlineProviderError('invalid-response', i18n.t('importSource.invalidResponse'), 'bilibili');
    }
    return { data, session: response.headers.get(BILIBILI_SESSION_HEADER) };
}, { ...options, account: true });

export const bilibiliJsonPost = (data: unknown): RequestInit => ({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});

export const resolveBilibiliVideo = async (input: string): Promise<BilibiliResolvedVideo> => {
    if (!input.trim() || input.length > 4096) {
        throw new OnlineProviderError('unsupported', i18n.t('importSource.bilibiliPlaceholder'), 'bilibili');
    }
    const params = usesNativeBilibili() ? nativeVideoParams(input) : null;
    if (params) {
        try { return await withOnlineRequestLimit(() => resolveNativeBilibiliVideo(params), BILIBILI_REQUEST_LIMIT_MS); }
        catch (error) { throw nativeMediaError(error); }
    }
    return request('/resolve', bilibiliJsonPost({ input: input.trim() }), async response => {
        let raw: unknown;
        try { raw = await response.json(); } catch {
            throw new OnlineProviderError('invalid-response', i18n.t('importSource.serviceUnavailable'), 'bilibili');
        }
        return readBilibiliResolvedVideo(raw);
    });
};

const checkedTicketSource = (raw: unknown): ProviderAudioSource => {
    const data = record(raw);
    if (typeof data.url !== 'string' || typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt)
        || data.expiresAt <= Date.now() || data.expiresAt > Date.now() + 6 * 60 * 60_000 + 5_000 || data.quality !== 'high') {
        throw new OnlineProviderError('invalid-response', i18n.t('importSource.invalidResponse'), 'bilibili');
    }
    const base = getBilibiliApiBase();
    const appOrigin = typeof location === 'undefined' ? 'https://folia.invalid' : location.origin;
    const api = new URL(base, appOrigin);
    let url: URL;
    try { url = new URL(data.url, api.origin); } catch {
        throw new OnlineProviderError('invalid-response', i18n.t('importSource.invalidResponse'), 'bilibili');
    }
    const ticket = url.searchParams.get('ticket');
    if (url.origin !== api.origin || url.pathname !== `${api.pathname}/stream` || url.username || url.password || url.hash
        || !ticket || ticket.length > 65536 || [...url.searchParams.keys()].length !== 1 || /[^\x21-\x7e]/.test(ticket)) {
        throw new OnlineProviderError('invalid-response', i18n.t('importSource.invalidResponse'), 'bilibili');
    }
    return { url: base.startsWith('/') ? `${url.pathname}${url.search}` : url.href, fetchedAt: Date.now(), expiresAt: data.expiresAt, quality: 'high' };
};

export const getBilibiliAudioSource = async (mediaId: string): Promise<ProviderAudioSource> => {
    if (usesNativeBilibili()) {
        try { return await withOnlineRequestLimit(() => getNativeBilibiliAudio(mediaId), BILIBILI_REQUEST_LIMIT_MS); }
        catch (error) { throw nativeMediaError(error); }
    }
    const identity = parseBilibiliMediaId(mediaId);
    if (!identity) throw new OnlineProviderError('unsupported', i18n.t('importSource.videoUnavailable'), 'bilibili');
    if (getBilibiliSession() || identity.first) {
        const body = { bvid: identity.bvid, ...(identity.first ? { first: true } : { cid: identity.cid }) };
        const generation = getBilibiliSessionGeneration();
        const response = await requestBilibiliAccount('/playback/prepare', bilibiliJsonPost(body));
        if (generation !== getBilibiliSessionGeneration()) throw new OnlineProviderError('auth-required', i18n.t('importSource.loginRequired'), 'bilibili');
        return checkedTicketSource(response.data);
    }
    const path = `/stream?${new URLSearchParams({ bvid: identity.bvid, cid: String(identity.cid) })}`;
    // Anonymous imports stay anonymous: a refusal never triggers a credentialed retry.
    const response = await request(path, { method: 'HEAD' }, async response => response);
    if (!response.headers.get('content-type')?.startsWith('audio/mp4')) {
        throw new OnlineProviderError('invalid-response', i18n.t('importSource.audioUnavailable'), 'bilibili');
    }
    return { url: `${getBilibiliApiBase()}${path}`, fetchedAt: Date.now(), expiresAt: Date.now() + 60_000, quality: 'high' };
};
