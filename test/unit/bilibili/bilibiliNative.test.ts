import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise Android account routing and delayed confirmations without exposing real account credentials.
const mock = vi.hoisted(() => ({ request: vi.fn(), image: vi.fn(), session: '', native: true, proxy: vi.fn() }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({ request: mock.request }) }));
vi.mock('@/platform/runtime', () => ({ isCapacitorAndroid: () => mock.native }));
vi.mock('qrcode', () => ({ default: { toDataURL: mock.image } }));
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/services/nativeRemoteAudio', () => ({ proxyNativeRemoteAudioUrl: mock.proxy }));
vi.mock('@/services/onlineMusic/providerStorage', () => ({
    getProviderCacheKey: (provider: string, key: string) => `${provider}_${key}`,
    readProviderSessionValue: () => mock.session || null,
    writeProviderSessionValue: (_provider: string, _key: string, value: string) => { mock.session = value; },
    removeProviderSessionValue: () => { mock.session = ''; },
}));
import { bilibiliAuth } from '@/services/onlineMusic/bilibili/bilibiliAuth';
import { getBilibiliAudioSource, requestBilibiliAccount } from '@/services/onlineMusic/bilibili/bilibiliTransport';
import { getBilibiliFavoriteFolders, getBilibiliFavoriteTracks } from '@/services/onlineMusic/bilibili/bilibiliLibrary';

const key = '1234567890abcdef1234567890abcdef';
const qr = () => ({ ok: true, data: { qrcode_key: key,
    url: `https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=${key}`,
    expiresAt: Date.now() + 180_000 } });
beforeEach(() => {
    mock.request.mockReset(); mock.image.mockReset(); mock.proxy.mockReset();
    mock.image.mockResolvedValue('data:image/png;base64,YQ==');
    mock.native = true;
    bilibiliAuth.signInRanOut!();
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Cloud must not be contacted'); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Android QR account flow', () => {
    it('generates the QR locally and preserves waiting/scanned/confirmed states', async () => {
        mock.request.mockResolvedValueOnce(qr());
        expect(await bilibiliAuth.startLogin!()).toBe(key);
        expect(await bilibiliAuth.createQr!(key)).toBe('data:image/png;base64,YQ==');
        expect(mock.image).toHaveBeenCalledWith(expect.stringContaining('passport.bilibili.com'), expect.any(Object));
        for (const [code, state] of [[86101, 'waiting'], [86090, 'scanned'], [0, 'confirmed']]) {
            mock.request.mockResolvedValueOnce({ ok: true, data: { code }, ...(code === 0 ? { session: 'native:account' } : {}) });
            expect(await bilibiliAuth.checkLogin!(key)).toEqual({ state });
        }
        expect(mock.session).toBe('native:account');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not claim confirmation without a native session', async () => {
        mock.request.mockResolvedValueOnce(qr());
        await bilibiliAuth.startLogin!();
        mock.request.mockResolvedValueOnce({ ok: true, data: { code: 0 } });
        await expect(bilibiliAuth.checkLogin!(key)).rejects.toThrow();
        expect(mock.session).toBe('');
    });

    it('rejects a QR URL from an unexpected host before rendering it', async () => {
        mock.request.mockResolvedValueOnce({ ...qr(), data: { ...qr().data, url: `https://evil.invalid/?qrcode_key=${key}` } });
        await expect(bilibiliAuth.startLogin!()).rejects.toThrow();
        expect(mock.image).not.toHaveBeenCalled();
    });

    it('keeps a delayed confirmation inert after cancellation', async () => {
        mock.request.mockResolvedValueOnce(qr());
        await bilibiliAuth.startLogin!();
        let finish!: (value: unknown) => void;
        mock.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const check = bilibiliAuth.checkLogin!(key);
        mock.request.mockResolvedValueOnce({ ok: true, data: {} });
        await bilibiliAuth.cancelLogin!(key);
        finish({ ok: true, data: { code: 0 }, session: 'native:late' });
        expect(await check).toEqual({ state: 'expired' });
        expect(mock.session).toBe('');
    });

    it('maps expired native QR attempts without a retry through cloud', async () => {
        mock.request.mockResolvedValueOnce(qr());
        await bilibiliAuth.startLogin!();
        mock.request.mockResolvedValueOnce({ ok: false, status: 410, code: 'qr-expired' });
        expect(await bilibiliAuth.checkLogin!(key)).toEqual({ state: 'expired' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('preserves direct upstream 412 refusal diagnostics', async () => {
        mock.request.mockResolvedValueOnce({ ok: false, status: 412, code: 'upstream-http' });
        await expect(bilibiliAuth.startLogin!()).rejects.toMatchObject({ httpStatus: 412,
            cause: { code: 'upstream-restricted', upstreamCode: '412' } });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('requires a new local login instead of sending an old web bearer to Bilibili', async () => {
        mock.session = 'old-sealed-worker-bearer';
        expect(await bilibiliAuth.getLoginStatus!()).toBeNull();
        expect(mock.session).toBe('');
        expect(mock.request).not.toHaveBeenCalled();
    });

    it('restores account status through the persisted native handle and unlinks on logout', async () => {
        mock.session = 'native:kept';
        mock.request.mockResolvedValueOnce({ ok: true, data: { isLogin: true, mid: 123, uname: 'User', face: 'https://i0.hdslb.com/a.jpg' } });
        expect(await bilibiliAuth.getLoginStatus!()).toMatchObject({ id: '123', nickname: 'User' });
        expect(mock.request).toHaveBeenLastCalledWith({ operation: 'nav', params: {}, session: 'native:kept' });
        mock.request.mockResolvedValueOnce({ ok: true, data: {} });
        await bilibiliAuth.logout!();
        expect(mock.session).toBe('');
        expect(mock.request).toHaveBeenLastCalledWith({ operation: 'logout', params: {}, session: 'native:kept' });
    });

    it('clears the sent session after the platform reports expiry', async () => {
        mock.session = 'native:expired';
        mock.request.mockResolvedValueOnce({ ok: false, status: 401, code: '-101' });
        expect(await bilibiliAuth.getLoginStatus!()).toBeNull();
        expect(mock.session).toBe('');
    });
});

describe('Android authenticated reads', () => {
    it('normalizes the signed-in user folders', async () => {
        mock.session = 'native:kept';
        mock.request.mockResolvedValueOnce({ ok: true, data: { ownerId: '123', list: [{ id: 9, title: 'Favorites', media_count: 2 }] } });
        expect(await getBilibiliFavoriteFolders('123', 20, 0)).toMatchObject({ hasMore: false, total: 1,
            items: [{ id: 'fav:9', name: 'Favorites', creator: { id: '123' }, trackCount: 2 }] });
    });

    it('advances past deleted entries and reads the correct fixed-size upstream page', async () => {
        mock.session = 'native:kept';
        const video = { bvid: 'BV1FT6dBtEff', type: 2, id: 1, title: 'video', upper: { mid: 123, name: 'up' }, duration: 99, page: 1 };
        mock.request.mockResolvedValueOnce({ ok: true, data: { medias: [video, { type: 2, bvid: '' }, video], info: { media_count: 23 }, has_more: false } });
        expect(await getBilibiliFavoriteTracks('fav:9', 2, 21)).toMatchObject({ nextOffset: 23, hasMore: false, items: [{ name: 'video' }] });
        expect(mock.request).toHaveBeenCalledWith({ operation: 'tracks', session: 'native:kept', params: { media_id: '9', pn: '2', ps: '20' } });
    });

    it('rejects a missing page with has_more instead of silently truncating the folder', async () => {
        mock.session = 'native:kept';
        mock.request.mockResolvedValueOnce({ ok: true, data: { medias: [], info: {}, has_more: true } });
        await expect(getBilibiliFavoriteTracks('fav:9', 20, 0)).rejects.toThrow();
    });

    it('does not pass arbitrary provider routes through native HTTP', async () => {
        mock.session = 'native:kept';
        await expect(requestBilibiliAccount('/unknown')).rejects.toThrow();
        expect(mock.request).not.toHaveBeenCalled();
    });

    it('prepares favorite-video audio locally without exposing cookies to the CDN', async () => {
        mock.session = 'native:kept';
        mock.request.mockResolvedValueOnce({ ok: true, data: { pages: [{ cid: 77 }] } });
        mock.request.mockResolvedValueOnce({ ok: true, data: { dash: { audio: [{ mimeType: 'audio/mp4', bandwidth: 100,
            baseUrl: 'https://cn-test.bilivideo.com/audio.m4s' }] } } });
        mock.proxy.mockResolvedValueOnce('http://127.0.0.1:9999/remote-audio/test');
        expect(await getBilibiliAudioSource('BV1FT6dBtEff:first')).toMatchObject({ url: 'http://127.0.0.1:9999/remote-audio/test', quality: 'high' });
        expect(mock.proxy).toHaveBeenCalledWith('https://cn-test.bilivideo.com/audio.m4s', { allowAnyHost: true, headers: { Referer: 'https://www.bilibili.com/' } });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects a non-platform audio URL', async () => {
        mock.request.mockResolvedValueOnce({ ok: true, data: { dash: { audio: [{ mimeType: 'audio/mp4', baseUrl: 'https://evil.invalid/audio' }] } } });
        await expect(getBilibiliAudioSource('BV1FT6dBtEff:77')).rejects.toThrow();
        expect(mock.proxy).not.toHaveBeenCalled();
    });
});
