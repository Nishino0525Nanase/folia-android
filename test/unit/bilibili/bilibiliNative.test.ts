import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise Android account routing and delayed confirmations without exposing real account credentials.
const mock = vi.hoisted(() => ({ request: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined), image: vi.fn(), session: '', native: true, proxy: vi.fn() }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({
    request: async (options: { operation: string; params: Record<string, string> }) => {
        const reply = await mock.request(options);
        return options.operation === 'audioProbe' && reply?.ok
            ? { ...reply, data: { headers: { 'User-Agent': 'fixture-browser', Referer: `https://www.bilibili.com/video/${options.params.bvid}/` }, ...reply.data } }
            : reply;
    }, cancel: mock.cancel,
}) }));
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
// Shape returned by the official generate endpoint on 2026-10-23; the QR key is synthetic.
const qr = () => ({ ok: true, data: { qrcode_key: key,
    url: `https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=${key}`,
    expiresAt: Date.now() + 180_000 } });
beforeEach(() => {
    mock.cancel.mockClear();
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
        expect(mock.image).toHaveBeenCalledWith(qr().data.url, expect.any(Object));
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

    it('continues to accept the earlier official passport QR URL', async () => {
        const url = `https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=${key}`;
        mock.request.mockResolvedValueOnce({ ...qr(), data: { ...qr().data, url } });
        expect(await bilibiliAuth.startLogin!()).toBe(key);
        expect(mock.image).toHaveBeenCalledWith(url, expect.any(Object));
    });

    it.each([
        `https://evil.invalid/?qrcode_key=${key}`,
        `https://account.bilibili.com.evil.invalid/?qrcode_key=${key}`,
        `http://account.bilibili.com/?qrcode_key=${key}`,
        `https://user:password@account.bilibili.com/?qrcode_key=${key}`,
        `https://account.bilibili.com:8443/?qrcode_key=${key}`,
        'https://account.bilibili.com/?qrcode_key=00000000000000000000000000000000',
    ])('rejects an unsafe or mismatched QR URL before rendering it (%#)', async url => {
        mock.request.mockResolvedValueOnce({ ...qr(), data: { ...qr().data, url } });
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
    it('reads all 141 favorites across eight pages despite incomplete display metadata and an early false has_more', async () => {
        mock.session = 'native:kept';
        const videos = Array.from({ length: 141 }, (_, index) => ({
            bvid: `BV${String(index + 1).padStart(10, '0')}`, type: 2, id: index + 1,
            title: index === 120 ? '' : `Original video ${index + 1}`,
            upper: index === 120 ? {} : { mid: 123, name: 'Uploader' },
            duration: index === 120 ? undefined : 99, page: 1,
        }));
        mock.request.mockImplementation(({ operation, params }) => {
            expect(operation).toBe('tracks');
            const start = (Number(params.pn) - 1) * 20;
            return Promise.resolve({ ok: true, data: { medias: videos.slice(start, start + 20),
                info: { media_count: 141 }, has_more: start < 100 } });
        });
        const songs = [];
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
            const page = await getBilibiliFavoriteTracks('fav:9', 1000, offset);
            songs.push(...page.items); offset = page.nextOffset; hasMore = page.hasMore;
        }
        expect(songs).toHaveLength(141);
        expect(new Set(songs.map(song => song.sourceRef.mediaId)).size).toBe(141);
        expect(songs[120]).toMatchObject({ name: 'BV0000000121', artists: [], durationMs: 0 });
        expect(mock.request.mock.calls.map(([call]) => call.params.pn)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not mark an empty response before the reported total as a complete favorite folder', async () => {
        mock.session = 'native:kept';
        mock.request.mockResolvedValueOnce({ ok: true, data: { medias: [], info: { media_count: 141 }, has_more: false } });
        await expect(getBilibiliFavoriteTracks('fav:9', 20, 120)).rejects.toThrow();
    });

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
        mock.request.mockResolvedValueOnce({ ok: true, data: {} });
        mock.proxy.mockResolvedValueOnce('http://127.0.0.1:9999/remote-audio/test');
        expect(await getBilibiliAudioSource('BV1FT6dBtEff:first')).toMatchObject({ url: 'http://127.0.0.1:9999/remote-audio/test', quality: 'high' });
        expect(mock.request).toHaveBeenNthCalledWith(1, { operation: 'parts', requestId: expect.any(String), params: { bvid: 'BV1FT6dBtEff' }, session: 'native:kept' });
        expect(mock.proxy).toHaveBeenCalledWith('https://cn-test.bilivideo.com/audio.m4s', { allowAnyHost: true, headers: { 'User-Agent': 'fixture-browser', Referer: 'https://www.bilibili.com/video/BV1FT6dBtEff/' } });
        expect(mock.request).toHaveBeenLastCalledWith({ operation: 'audioProbe', requestId: expect.any(String), params: { url: 'https://cn-test.bilivideo.com/audio.m4s', bvid: 'BV1FT6dBtEff' }, session: '' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each(['http://cn-test.bilivideo.com/audio.m4s', 'https://xy-test.mcdn.bilivideo.cn:4483/audio.m4s'])(
        'preserves the returned signed scheme and nonstandard ports (%#)', async url => {
            mock.request.mockResolvedValueOnce({ ok: true, data: { dash: { audio: [{ mime_type: 'audio/mp4', base_url: url }] } } });
            mock.request.mockResolvedValueOnce({ ok: true, data: {} });
            mock.proxy.mockResolvedValueOnce('http://127.0.0.1:9999/remote-audio/test');
            expect(await getBilibiliAudioSource('BV1FT6dBtEff:77')).toMatchObject({ quality: 'high' });
            expect(mock.proxy).toHaveBeenCalledWith(url, expect.any(Object));
        },
    );

    it('prefers standard HTTPS backups and tries another route when a CDN probe fails', async () => {
        mock.session = 'native:kept';
        const primary = 'https://xy-test.mcdn.bilivideo.cn:4483/audio.m4s';
        const backup = 'https://upos-test.bilivideo.com/audio.m4s';
        mock.request.mockResolvedValueOnce({ ok: true, data: { dash: { audio: [{ mimeType: 'audio/mp4', baseUrl: primary, backupUrl: [backup] }] } } });
        mock.request.mockResolvedValueOnce({ ok: false, status: 502, code: 'audio-http-403' });
        mock.request.mockResolvedValueOnce({ ok: true, data: {} });
        mock.proxy.mockResolvedValueOnce('http://127.0.0.1:9999/remote-audio/test');
        await getBilibiliAudioSource('BV1FT6dBtEff:77');
        expect(mock.request.mock.calls.slice(1)).toEqual([
            [{ operation: 'audioProbe', requestId: expect.any(String), params: { url: backup, bvid: 'BV1FT6dBtEff' }, session: '' }],
            [{ operation: 'audioProbe', requestId: expect.any(String), params: { url: primary, bvid: 'BV1FT6dBtEff' }, session: '' }],
        ]);
        expect(mock.proxy).toHaveBeenCalledWith(primary, expect.any(Object));
    });

    it('uses a valid backup after malformed, unsafe and expired URLs', async () => {
        const backup = 'https://upos-test.bilivideo.com/audio.m4s';
        mock.request.mockResolvedValueOnce({ ok: true, data: { dash: { audio: [{ mime_type: 'audio/mp4', base_url: 'broken',
            backup_url: ['https://evil.invalid/audio', 'https://cn-test.bilivideo.com/audio?deadline=1', backup] }] } } });
        mock.request.mockResolvedValueOnce({ ok: true, data: {} });
        mock.proxy.mockResolvedValueOnce('http://127.0.0.1:9999/remote-audio/test');
        await getBilibiliAudioSource('BV1FT6dBtEff:77');
        expect(mock.request).toHaveBeenLastCalledWith({ operation: 'audioProbe', requestId: expect.any(String), params: { url: backup, bvid: 'BV1FT6dBtEff' }, session: '' });
    });

    it('does not pass a failed probe or an unproxied URL to the player', async () => {
        const url = 'https://cn-test.bilivideo.com/audio.m4s';
        const reply = { ok: true, data: { dash: { audio: [{ mimeType: 'audio/mp4', baseUrl: url }] } } };
        mock.request.mockResolvedValueOnce(reply).mockResolvedValueOnce({ ok: false, status: 502, code: 'invalid-audio-content' }).mockResolvedValueOnce({ ok: true, data: {} });
        await expect(getBilibiliAudioSource('BV1FT6dBtEff:77')).rejects.toMatchObject({ cause: { code: 'invalid-audio-content' } });
        expect(mock.proxy).not.toHaveBeenCalled();
        mock.request.mockResolvedValueOnce(reply).mockResolvedValueOnce({ ok: true, data: {} });
        mock.proxy.mockResolvedValueOnce(url);
        await expect(getBilibiliAudioSource('BV1FT6dBtEff:77')).rejects.toMatchObject({ cause: { code: 'local-audio-unavailable' } });
    });

    it('rejects a non-platform audio URL', async () => {
        mock.request.mockResolvedValueOnce({ ok: true, data: { dash: { audio: [{ mimeType: 'audio/mp4', baseUrl: 'https://evil.invalid/audio' }] } } });
        await expect(getBilibiliAudioSource('BV1FT6dBtEff:77')).rejects.toThrow();
        expect(mock.proxy).not.toHaveBeenCalled();
    });
});


describe('Android playback cancellation and bounded route selection', () => {
    it('cancels a pending parts request and never continues to playurl after switching songs', async () => {
        const controller = new AbortController();
        let finish!: (value: unknown) => void;
        mock.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const pending = getBilibiliAudioSource('BV1FT6dBtEff:first', controller.signal);
        controller.abort();
        await expect(pending).rejects.toThrow();
        expect(mock.cancel).toHaveBeenCalledWith({ requestId: mock.request.mock.calls[0][0].requestId });
        finish({ ok: true, data: { pages: [{ cid: 77 }] } });
        await Promise.resolve();
        expect(mock.request).toHaveBeenCalledTimes(1);
        expect(mock.proxy).not.toHaveBeenCalled();
    });

    it('uses a quick backup while the primary is stalled, cancels the loser and uses the verified redirect target', async () => {
        const first = 'https://slow.bilivideo.com/a.m4s';
        const backup = 'https://fast.bilivideo.com/a.m4s';
        const resolved = 'https://edge.bilivideo.com/a.m4s';
        mock.request.mockImplementation(({ operation, params }) => {
            if (operation === 'playurl') return Promise.resolve({ ok: true, data: { dash: { audio: [
                { mimeType: 'audio/mp4', baseUrl: first, backupUrl: [backup] },
            ] } } });
            if (params.url === first) return new Promise(() => {});
            return Promise.resolve({ ok: true, data: { url: resolved } });
        });
        mock.proxy.mockResolvedValue('http://127.0.0.1:9999/remote-audio/test');
        await getBilibiliAudioSource('BV1FT6dBtEff:77');
        expect(mock.proxy).toHaveBeenCalledWith(resolved, expect.any(Object));
        expect(mock.cancel).toHaveBeenCalledWith({ requestId: mock.request.mock.calls[1][0].requestId });
        expect(mock.request).toHaveBeenCalledTimes(3);
    });
});

describe('Android background listening to the original video', () => {
    const audio = 'https://audio.bilivideo.com/a.m4s';
    const video = 'https://video.bilivideo.com/v.mp4?signature=a%2Bb';
    const dash = { ok: true, data: { dash: { audio: [{ mimeType: 'audio/mp4', baseUrl: audio }] } } };
    const mp4 = { ok: true, data: { format: 'mp4', durl: [{ url: video }] } };

    it('falls back from a refused DASH route to the same authenticated video part', async () => {
        mock.session = 'native:kept';
        mock.request.mockResolvedValueOnce(dash)
            .mockResolvedValueOnce({ ok: false, status: 502, code: 'audio-http-403' })
            .mockResolvedValueOnce(mp4).mockResolvedValueOnce({ ok: true, data: {} });
        mock.proxy.mockResolvedValueOnce('http://127.0.0.1:9999/remote-audio/video');
        await expect(getBilibiliAudioSource('BV1FT6dBtEff:77')).resolves.toMatchObject({ url: 'http://127.0.0.1:9999/remote-audio/video' });
        expect(mock.request.mock.calls.filter(([call]) => call.operation === 'playurl').map(([call]) => call)).toEqual([
            { operation: 'playurl', session: 'native:kept', requestId: expect.any(String), params: { bvid: 'BV1FT6dBtEff', cid: '77' } },
            { operation: 'playurl', session: 'native:kept', requestId: expect.any(String), params: { bvid: 'BV1FT6dBtEff', cid: '77', mode: 'progressive' } },
        ]);
        expect(mock.proxy).toHaveBeenCalledWith(video, { allowAnyHost: true, headers: {
            'User-Agent': 'fixture-browser', Referer: 'https://www.bilibili.com/video/BV1FT6dBtEff/',
        } });
    });

    it('plays a complete MP4 returned directly without making a second playurl request', async () => {
        mock.request.mockResolvedValueOnce(mp4).mockResolvedValueOnce({ ok: true, data: {} });
        mock.proxy.mockResolvedValueOnce('http://127.0.0.1:9999/remote-audio/video');
        await getBilibiliAudioSource('BV1FT6dBtEff:77');
        expect(mock.request).toHaveBeenCalledTimes(2);
        expect(mock.proxy).toHaveBeenCalledWith(video, expect.any(Object));
    });

    it.each([401, 403, 412])('stops on a video API access denial (%s)', async status => {
        mock.request.mockResolvedValueOnce({ ok: false, status, code: 'upstream-http' });
        await expect(getBilibiliAudioSource('BV1FT6dBtEff:77')).rejects.toMatchObject({ httpStatus: status });
        expect(mock.request).toHaveBeenCalledTimes(1);
        expect(mock.proxy).not.toHaveBeenCalled();
    });

    it('does not truncate a multi-segment video to its first segment', async () => {
        mock.request.mockResolvedValueOnce({ ok: true, data: { dash: { audio: [] } } })
            .mockResolvedValueOnce({ ok: true, data: { format: 'mp4', durl: [{ url: video }, { url: video + '&part=2' }] } });
        await expect(getBilibiliAudioSource('BV1FT6dBtEff:77')).rejects.toMatchObject({ cause: { code: 'no-audio' } });
        expect(mock.proxy).not.toHaveBeenCalled();
    });

    it('cancels a pending fallback without starting another stream after switching songs', async () => {
        const controller = new AbortController();
        mock.request.mockResolvedValueOnce(dash)
            .mockResolvedValueOnce({ ok: false, status: 502, code: 'audio-http-403' })
            .mockImplementationOnce(() => { controller.abort(); return new Promise(() => {}); });
        await expect(getBilibiliAudioSource('BV1FT6dBtEff:77', controller.signal)).rejects.toThrow();
        expect(mock.request).toHaveBeenCalledTimes(3);
        expect(mock.proxy).not.toHaveBeenCalled();
    });

    it('forwards verified public headers without forwarding an unexpected cookie', async () => {
        mock.request.mockResolvedValueOnce(dash).mockResolvedValueOnce({ ok: true, data: { headers: {
            'User-Agent': 'native-browser', Referer: 'https://www.bilibili.com/video/BV1FT6dBtEff/', Cookie: 'never-forward',
        } } });
        mock.proxy.mockResolvedValueOnce('http://127.0.0.1:9999/remote-audio/audio');
        await getBilibiliAudioSource('BV1FT6dBtEff:77');
        expect(mock.proxy.mock.calls[0][1].headers).toEqual({ 'User-Agent': 'native-browser', Referer: 'https://www.bilibili.com/video/BV1FT6dBtEff/' });
    });
});
