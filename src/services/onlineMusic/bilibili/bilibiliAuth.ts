import i18n from '../../../i18n/config';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineAuthProvider } from '../../../types/onlineMusic';
import { normalizeBilibiliUser } from './bilibiliNormalize';
import { bilibiliJsonPost, requestBilibiliAccount } from './bilibiliTransport';
import { advanceBilibiliSessionGeneration, clearBilibiliSession, getBilibiliSession, getBilibiliSessionGeneration, keepBilibiliSession } from './bilibiliSession';

// src/services/onlineMusic/bilibili/bilibiliAuth.ts
// A confirmed first-party QR flow links this app to the account; closing it cannot revive a session.
const record = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);
let pending: { key: string; imageUrl: string; startedAt: number; expiresAt: number; generation: number } | null = null;

const invalidResponse = (): OnlineProviderError => new OnlineProviderError('invalid-response', i18n.t('importSource.invalidResponse'), 'bilibili');

const safeQrImage = (value: unknown): string | null => {
    if (typeof value !== 'string' || value.length > 1_000_000) return null;
    if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value)) return value;
    const base64 = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/]+=*)$/.exec(value)?.[1];
    if (!base64) return null;
    let svg: string;
    try { svg = atob(base64); } catch { return null; }
    // The Worker reuses the existing local two-path QR renderer. No arbitrary SVG is accepted.
    return /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d{1,3}) \1" shape-rendering="crispEdges"><path fill="white" d="M0 0h\1v\1H0z"\/><path fill="black" d="(?:M\d+ \d+h1v1h-1z)+"\/><\/svg>$/.test(svg) ? value : null;
};

export const bilibiliAuth: OnlineAuthProvider = {
    getLoginTexts: () => ({ title: 'home.loginTitleBilibili', note: 'home.loginNoteBilibili' }),
    showsKeptAccountAtStart: true,
    async getLoginStatus() {
        const generation = getBilibiliSessionGeneration();
        try {
            const response = await requestBilibiliAccount('/login/status');
            const body = record(response.data);
            if (generation !== getBilibiliSessionGeneration()) throw new OnlineProviderError('unavailable', i18n.t('importSource.serviceUnavailable'), 'bilibili');
            if (body.user === null) {
                clearBilibiliSession();
                return null;
            }
            return normalizeBilibiliUser(body.user);
        } catch (error) {
            if (error instanceof OnlineProviderError && error.code === 'auth-required') return null;
            throw error;
        }
    },
    async logout() {
        const sent = getBilibiliSession();
        pending = null;
        clearBilibiliSession();
        // Unlink locally before the first wait. A failed server logout must not restore a bearer.
        await requestBilibiliAccount('/logout', bilibiliJsonPost({}), { session: sent }).catch(error => {
            console.warn('[BilibiliAuth] local-unlink:server-unavailable', error);
        });
    },
    signInRanOut() { pending = null; clearBilibiliSession(); },
    async startLogin() {
        const generation = advanceBilibiliSessionGeneration();
        pending = null;
        const response = await requestBilibiliAccount('/login/qr/start', bilibiliJsonPost({}), { login: true, session: '' });
        const raw = record(response.data);
        const imageUrl = safeQrImage(raw.imageUrl);
        const now = Date.now();
        if (typeof raw.key !== 'string' || !raw.key || raw.key.length > 65536 || !imageUrl
            || typeof raw.expiresAt !== 'number' || !Number.isFinite(raw.expiresAt) || raw.expiresAt <= now || raw.expiresAt > now + 10 * 60_000) throw invalidResponse();
        if (generation === getBilibiliSessionGeneration()) {
            pending = { key: raw.key, imageUrl, startedAt: now, expiresAt: raw.expiresAt, generation };
        }
        return raw.key;
    },
    async createQr(key) {
        if (!pending || pending.key !== key || pending.generation !== getBilibiliSessionGeneration()) throw invalidResponse();
        return pending.imageUrl;
    },
    async checkLogin(key) {
        const attempt = pending;
        if (!attempt || attempt.key !== key || attempt.expiresAt <= Date.now()) return { state: 'expired' };
        const response = await requestBilibiliAccount('/login/qr/check', bilibiliJsonPost({ key }), { login: true, session: '' });
        // Check before storing the bearer: a late poll after cancel, logout or a newer QR is inert.
        if (pending !== attempt || attempt.generation !== getBilibiliSessionGeneration()) return { state: 'expired' };
        const raw = record(response.data);
        if (raw.state === 'confirmed') {
            if (!response.session) throw invalidResponse();
            try { keepBilibiliSession(response.session); } catch { throw invalidResponse(); }
            pending = null;
            return { state: 'confirmed' };
        }
        if (raw.state === 'expired') { pending = null; return { state: 'expired' }; }
        if (raw.state === 'waiting' || raw.state === 'scanned') return { state: raw.state };
        if (raw.state === 'error') return { state: 'error', message: i18n.t('importSource.serviceUnavailable') };
        throw invalidResponse();
    },
    async cancelLogin(key) {
        if (pending?.key === key) {
            pending = null;
            advanceBilibiliSessionGeneration();
        }
        // The server forgets the QR attempt locally; this does not claim to revoke a platform QR.
        await requestBilibiliAccount('/login/qr/cancel', bilibiliJsonPost({ key }), { login: true, session: '' }).catch(() => undefined);
    },
    getLoginTtlMs: () => pending ? pending.expiresAt - pending.startedAt : 180_000,
};
