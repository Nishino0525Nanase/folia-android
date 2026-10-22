import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/bilibili/bilibiliProvider.test.ts
// Contract fixtures only: the platform refused the live verification environment with HTTP 412.
const stored = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/services/onlineMusic/providerStorage', () => ({
    getProviderCacheKey: (provider: string, key: string) => `online_provider_${provider}_${key}`,
    readProviderSessionValue: () => stored.values.get('session') || null,
    writeProviderSessionValue: (_provider: string, _key: string, token: string) => { stored.values.set('session', token); },
    removeProviderSessionValue: () => { stored.values.delete('session'); },
}));
vi.mock('@/services/repositories/cacheRepository', () => ({
    readCacheEntry: async (key: string) => structuredClone(stored.values.get(key) ?? null),
    putCacheEntry: async (key: string, value: unknown) => { stored.values.set(key, structuredClone(value)); },
}));

import { bilibiliProvider } from '@/services/onlineMusic/bilibili/bilibiliProvider';
import { normalizeBilibiliFavoriteFolder, normalizeBilibiliFavoriteVideo, bilibiliSongPageUrl, bilibiliVideoSongs, normalizeBilibiliSong, parseBilibiliMediaId, readBilibiliResolvedVideo } from '@/services/onlineMusic/bilibili/bilibiliNormalize';
import { keepBilibiliImports, loadBilibiliImports } from '@/services/onlineMusic/bilibili/bilibiliImports';
import { advanceBilibiliSessionGeneration, getBilibiliSession, keepBilibiliSession } from '@/services/onlineMusic/bilibili/bilibiliSession';
import { BILIBILI_REQUEST_LIMIT_MS, getBilibiliApiBase, getBilibiliAudioSource, resolveBilibiliVideo } from '@/services/onlineMusic/bilibili/bilibiliTransport';

const video = {
    bvid: 'BV1FT6dBtEff', aid: 123, title: 'Fixture video', coverUrl: 'http://i0.hdslb.com/fixture.jpg',
    owner: { id: 456, name: 'Uploader' },
    pages: [{ cid: 101, page: 1, title: 'Part one', durationSec: 122 }, { cid: 102, page: 2, title: 'Part two', durationSec: 87 }],
};
const resolved = () => readBilibiliResolvedVideo(video);

beforeEach(() => { bilibiliProvider.auth!.signInRanOut!(); stored.values.clear(); vi.stubEnv('VITE_BILIBILI_API_BASE', '/api/bilibili'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('video import identity', () => {
    it('uses cid for playback identity and p for the original video page', () => {
        const songs = bilibiliVideoSongs(resolved());
        expect(songs.map(song => song.sourceRef.mediaId)).toEqual(['BV1FT6dBtEff:101', 'BV1FT6dBtEff:102']);
        expect(songs[1].durationMs).toBe(87_000);
        expect(songs[0].album.coverUrl).toBe('https://i0.hdslb.com/fixture.jpg');
        expect(bilibiliSongPageUrl(songs[1])).toBe('https://www.bilibili.com/video/BV1FT6dBtEff/?p=2');
        expect(normalizeBilibiliSong(songs[1])).toEqual(songs[1]);
    });

    it('imports only the explicit part, and refuses missing or duplicate parts', () => {
        expect(bilibiliVideoSongs(readBilibiliResolvedVideo({ ...video, selectedPage: 2 })).map(song => song.name)).toEqual(['Part two']);
        expect(() => readBilibiliResolvedVideo({ ...video, selectedPage: 3 })).toThrow();
        expect(() => readBilibiliResolvedVideo({ ...video, pages: [video.pages[0], video.pages[0]] })).toThrow();
        expect(parseBilibiliMediaId('BV1FT6dBtEff:101/../../other')).toBeNull();
        expect(parseBilibiliMediaId('BV1FT6dBtEff:9007199254740992')).toBeNull();
    });

    it('does not preserve signed media URLs or foreign provider identities', () => {
        const song = bilibiliVideoSongs(resolved())[0];
        if (song.sourceRef.kind !== 'online') throw new Error('Expected online fixture');
        const normalized = normalizeBilibiliSong({ ...song, url: 'https://signed.invalid/audio', sourceRef: { ...song.sourceRef, providerData: { ...song.sourceRef.providerData, url: 'secret' } } });
        expect(JSON.stringify(normalized)).not.toContain('secret');
        expect(JSON.stringify(normalized)).not.toContain('signed.invalid');
        expect(() => normalizeBilibiliSong({ ...song, sourceRef: { ...song.sourceRef, providerId: 'other' } })).toThrow();
    });
});

describe('original input links', () => {
    it('opens canonical video pages for bare IDs and official URLs without resolving metadata', () => {
        const link = bilibiliProvider.linkImport!.getInputPageUrl!;
        expect(link('BV1FT6dBtEff')).toBe('https://www.bilibili.com/video/BV1FT6dBtEff/');
        expect(link('AV123')).toBe('https://www.bilibili.com/video/av123/');
        expect(link('分享视频 https://m.bilibili.com/video/BV1FT6dBtEff?p=2&share_source=copy#reply')).toBe('https://www.bilibili.com/video/BV1FT6dBtEff/?p=2');
        expect(link('https://bilibili.com/video/av123/')).toBe('https://www.bilibili.com/video/av123/');
    });

    it('accepts only an official short-link path and strips tracking parameters', () => {
        const link = bilibiliProvider.linkImport!.getInputPageUrl!;
        expect(link('【分享】https://b23.tv/Ab12Cd?share_source=copy_web')).toBe('https://b23.tv/Ab12Cd');
        expect(link('https://b23.tv/Ab12Cd/?p=3')).toBe('https://b23.tv/Ab12Cd?p=3');
        expect(link('https://b23.tv/video/Ab12Cd')).toBeNull();
        expect(link('https://www.b23.tv/Ab12Cd')).toBeNull();
    });

    it('rejects lookalike hosts, credentials, non-HTTPS URLs, multiple links and invalid parts', () => {
        const link = bilibiliProvider.linkImport!.getInputPageUrl!;
        for (const input of [
            'https://bilibili.com.evil.invalid/video/BV1FT6dBtEff',
            'https://bilibili.com@evil.invalid/video/BV1FT6dBtEff',
            'https://www.bilibili.com:443/video/BV1FT6dBtEff',
            'http://www.bilibili.com/video/BV1FT6dBtEff',
            'javascript:alert(1)',
            'https://www.bilibili.com/video/BV1FT6dBtEff https://b23.tv/Ab12Cd',
            'https://www.bilibili.com/video/BV1FT6dBtEff?p=0',
            'https://www.bilibili.com/video/BV1FT6dBtEff?p=2&p=3',
            'https://www.bilibili.com/video/BV1FT6dBtEff?p=10001',
            'https://www.bilibili.com/video/%42V1FT6dBtEff',
        ]) expect(link(input)).toBeNull();
    });
});

describe('imported references', () => {
    it('serializes simultaneous imports without losing a part, and deduplicates repeated imports', async () => {
        const songs = bilibiliVideoSongs(resolved());
        await Promise.all([keepBilibiliImports([songs[0]]), keepBilibiliImports([songs[1]])]);
        await keepBilibiliImports([{ ...songs[0], name: 'Updated title' }]);
        const kept = await loadBilibiliImports();
        expect(kept.map(song => song.name)).toEqual(['Updated title', 'Part two']);
        expect(kept.map(song => song.sourceRef.mediaId)).toEqual(['BV1FT6dBtEff:101', 'BV1FT6dBtEff:102']);
        expect(await bilibiliProvider.linkImport!.getImported!()).toEqual(kept);
        const page = await bilibiliProvider.catalog!.getPlaylistTracks!('local-imports', 1, 0);
        expect(page).toMatchObject({ hasMore: true, total: 2, nextOffset: 1 });
    });

    it('offers explicit account login without pretending to support keyword search', () => {
        expect(bilibiliProvider.capabilities.search).toBe(false);
        expect(bilibiliProvider.capabilities.auth).toBe(true);
        expect(bilibiliProvider.search).toBeUndefined();
        expect(bilibiliProvider.auth?.startLogin).toBeTypeOf('function');
    });
});

describe('anonymous hosted transport', () => {
    it('posts a link without cookies and keeps a successful import', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...video, selectedPage: 2 }));
        vi.stubGlobal('fetch', fetchMock);
        const songs = await bilibiliProvider.linkImport!.resolve('https://www.bilibili.com/video/BV1FT6dBtEff?p=2');
        expect(songs).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledWith('/api/bilibili/resolve', expect.objectContaining({ method: 'POST', credentials: 'omit', cache: 'no-store', signal: expect.any(AbortSignal) }));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ input: 'https://www.bilibili.com/video/BV1FT6dBtEff?p=2' });
        expect(await loadBilibiliImports()).toEqual(songs);
    });

    it('reads refusal codes from a bodyless HEAD and never gives the player a URL', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403, headers: { 'X-Folia-Error-Code': 'upstream-restricted', 'X-Folia-Upstream-Code': '412' } })));
        await expect(getBilibiliAudioSource('BV1FT6dBtEff:101')).rejects.toMatchObject({
            providerId: 'bilibili', httpStatus: 403, message: 'importSource.platformRestricted',
            cause: { code: 'upstream-restricted', upstreamCode: '412' },
        });
    });

    it('validates AAC before giving a same-adapter stream URL', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { headers: { 'Content-Type': 'audio/mp4' } }));
        vi.stubGlobal('fetch', fetchMock);
        expect(await getBilibiliAudioSource('BV1FT6dBtEff:101')).toMatchObject({ url: '/api/bilibili/stream?bvid=BV1FT6dBtEff&cid=101', quality: 'high' });
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'HEAD', credentials: 'omit' });
        fetchMock.mockResolvedValue(new Response(null, { headers: { 'Content-Type': 'text/html' } }));
        await expect(getBilibiliAudioSource('BV1FT6dBtEff:101')).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('identifies malformed input without calling it an unavailable service', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'invalid-input' }, { status: 400 })));
        await expect(resolveBilibiliVideo('not a video')).rejects.toMatchObject({ code: 'unsupported', message: 'importSource.bilibiliPlaceholder', httpStatus: 400 });
    });

    it('keeps failed imports out of local history', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'video-unavailable' }, { status: 404 })));
        await expect(bilibiliProvider.linkImport!.resolve('BV1FT6dBtEff')).rejects.toMatchObject({ message: 'importSource.videoUnavailable', httpStatus: 404 });
        expect(await loadBilibiliImports()).toEqual([]);
    });

    it('rejects malformed backend responses and unsafe configured endpoints', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ bvid: 'BV1FT6dBtEff', pages: [] })));
        await expect(resolveBilibiliVideo('BV1FT6dBtEff')).rejects.toMatchObject({ code: 'invalid-response' });
        for (const base of ['http://service.invalid/api', 'https://user:password@service.invalid/api', '//service.invalid/api', '/api/bilibili?target=']) {
            vi.stubEnv('VITE_BILIBILI_API_BASE', base);
            expect(() => getBilibiliApiBase()).toThrow();
        }
    });

    it('times out a request instead of keeping import pending forever', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => undefined)));
        const result = expect(resolveBilibiliVideo('BV1FT6dBtEff')).rejects.toMatchObject({ code: 'network', name: 'OnlineRequestTimeout' });
        await vi.advanceTimersByTimeAsync(BILIBILI_REQUEST_LIMIT_MS);
        await result;
    });
});

const qrResponse = () => Response.json({ key: 'fixture_qr_attempt', imageUrl: 'data:image/png;base64,iVBORw0KGgo=', expiresAt: Date.now() + 180_000 });
const user = { id: '456', nickname: 'Fixture account', avatarUrl: 'https://i0.hdslb.com/avatar.jpg' };
const favoriteFolder = { id: '789', title: 'Favorite music', coverUrl: 'https://i0.hdslb.com/folder.jpg', trackCount: 2, owner: { id: '456', name: 'Fixture account' } };
const favoriteVideo = { bvid: video.bvid, aid: video.aid, title: video.title, coverUrl: video.coverUrl, owner: { id: '456', name: 'Uploader' }, durationSec: 122, pageCount: 1 };

// No token below is a real session; fixtures verify only the app/backend contract.
describe('explicit QR account flow', () => {
    it('keeps a confirmed sealed bearer without browser cookies or a bearer in the request URL', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(qrResponse())
            .mockResolvedValueOnce(Response.json({ state: 'confirmed' }, { headers: { 'X-Bilibili-Session': 'fixture_sealed_bearer' } }))
            .mockResolvedValueOnce(Response.json({ user }));
        vi.stubGlobal('fetch', fetchMock);
        const auth = bilibiliProvider.auth!;
        const key = await auth.startLogin!();
        expect(await auth.createQr!(key)).toContain('data:image/png;base64,');
        expect(await auth.checkLogin!(key)).toEqual({ state: 'confirmed' });
        expect(getBilibiliSession()).toBe('fixture_sealed_bearer');
        expect(await auth.getLoginStatus()).toMatchObject({ id: '456', nickname: 'Fixture account' });
        for (const [url, init] of fetchMock.mock.calls) {
            expect(init.credentials).toBe('omit');
            expect(String(url)).not.toContain('fixture_sealed_bearer');
        }
        expect(fetchMock.mock.calls[0][1].headers.has('X-Bilibili-Session')).toBe(false);
        expect(fetchMock.mock.calls[1][1].headers.has('X-Bilibili-Session')).toBe(false);
        expect(fetchMock.mock.calls[2][1].headers.get('X-Bilibili-Session')).toBe('fixture_sealed_bearer');
    });

    it('cannot revive a canceled attempt when the confirmed poll arrives late', async () => {
        let finish!: (response: Response) => void;
        const late = new Promise<Response>(resolve => { finish = resolve; });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(qrResponse()).mockImplementationOnce(() => late).mockResolvedValueOnce(Response.json({ ok: true })));
        const auth = bilibiliProvider.auth!;
        const key = await auth.startLogin!();
        const checking = auth.checkLogin!(key);
        await auth.cancelLogin!(key);
        finish(Response.json({ state: 'confirmed' }, { headers: { 'X-Bilibili-Session': 'late_fixture_bearer' } }));
        expect(await checking).toEqual({ state: 'expired' });
        expect(getBilibiliSession()).toBe('');
    });

    it('clears the local bearer before waiting for logout and does not restore it after a server failure', async () => {
        keepBilibiliSession('fixture_sealed_bearer');
        let finish!: (response: Response) => void;
        const pending = new Promise<Response>(resolve => { finish = resolve; });
        const fetchMock = vi.fn().mockImplementation(() => pending);
        vi.stubGlobal('fetch', fetchMock);
        const signOut = bilibiliProvider.auth!.logout();
        expect(getBilibiliSession()).toBe('');
        expect(fetchMock.mock.calls[0][1].headers.get('X-Bilibili-Session')).toBe('fixture_sealed_bearer');
        finish(Response.json({ code: 'upstream-unavailable' }, { status: 502 }));
        await signOut;
        expect(getBilibiliSession()).toBe('');
    });

    it('treats an explicit 401 as signed out but preserves the session on 412', async () => {
        keepBilibiliSession('fixture_sealed_bearer');
        const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ code: 'upstream-restricted' }, { status: 412 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(bilibiliProvider.auth!.getLoginStatus()).rejects.toMatchObject({ httpStatus: 412, code: 'unavailable' });
        expect(getBilibiliSession()).toBe('fixture_sealed_bearer');
        fetchMock.mockResolvedValueOnce(Response.json({ code: 'auth-required' }, { status: 401 }));
        expect(await bilibiliProvider.auth!.getLoginStatus()).toBeNull();
        expect(getBilibiliSession()).toBe('');
    });

    it('rejects stale status from a previous session without clearing the newer session', async () => {
        keepBilibiliSession('old_fixture_bearer');
        let finish!: (response: Response) => void;
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })));
        const status = bilibiliProvider.auth!.getLoginStatus();
        advanceBilibiliSessionGeneration();
        keepBilibiliSession('new_fixture_bearer');
        finish(Response.json({ user: null }));
        await expect(status).rejects.toMatchObject({ cause: { code: 'session-changed' } });
        expect(getBilibiliSession()).toBe('new_fixture_bearer');
    });

    it('rejects arbitrary SVG or remote QR image URLs', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        for (const imageUrl of ['https://untrusted.invalid/qr.png', `data:image/svg+xml;base64,${btoa('<svg><script>alert(1)</script></svg>')}`]) {
            fetchMock.mockResolvedValueOnce(Response.json({ key: 'fixture', imageUrl, expiresAt: Date.now() + 180_000 }));
            await expect(bilibiliProvider.auth!.startLogin!()).rejects.toMatchObject({ code: 'invalid-response' });
        }
    });

    it('accepts the existing Worker two-path SVG QR format', async () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><path fill="white" d="M0 0h29v29H0z"/><path fill="black" d="M4 4h1v1h-1z"/></svg>';
        const imageUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ key: 'fixture', imageUrl, expiresAt: Date.now() + 180_000 })));
        const key = await bilibiliProvider.auth!.startLogin!();
        expect(await bilibiliProvider.auth!.createQr!(key)).toBe(imageUrl);
    });
});

describe('account favorite folders', () => {
    it('uses video:first without fabricating a cid and preserves this identity in local imports', async () => {
        const song = normalizeBilibiliFavoriteVideo({ ...favoriteVideo, pageCount: 2, durationSec: 999 });
        expect(song.sourceRef.mediaId).toBe(`${video.bvid}:first`);
        expect(song.sourceRef.kind === 'online' && song.sourceRef.providerData?.cid).toBeUndefined();
        expect(song.durationMs).toBe(0);
        expect(bilibiliSongPageUrl(song)).toBe(`https://www.bilibili.com/video/${video.bvid}/?p=1`);
        expect(normalizeBilibiliSong(song)).toEqual(song);
        await keepBilibiliImports([song]);
        expect(await loadBilibiliImports()).toEqual([song]);
    });

    it('normalizes own folders and consumes backend paging offsets rather than displayed row counts', async () => {
        keepBilibiliSession('fixture_bearer');
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(Response.json({ items: [favoriteFolder], total: 1, hasMore: false, nextOffset: 1 }))
            .mockResolvedValueOnce(Response.json({ items: [favoriteVideo], total: 3, hasMore: true, nextOffset: 2, skipped: 1 }));
        vi.stubGlobal('fetch', fetchMock);
        const folders = await bilibiliProvider.library!.getUserPlaylists('456', 50, 0);
        expect(folders.items[0]).toMatchObject({ id: 'fav:789', providerId: 'bilibili', creator: { id: '456' } });
        expect(normalizeBilibiliFavoriteFolder(folders.items[0])).toEqual(folders.items[0]);
        const page = await bilibiliProvider.catalog!.getPlaylistTracks!('fav:789', 50, 0);
        expect(page.items).toHaveLength(1);
        expect(page.nextOffset).toBe(2);
        expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/bilibili/favorites?limit=20&offset=0', '/api/bilibili/favorites/789/tracks?limit=20&offset=0']);
    });

    it('refuses folders belonging to a different account and non-advancing pages', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ items: [favoriteFolder], hasMore: false, nextOffset: 1 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(bilibiliProvider.library!.getUserPlaylists('999', 20, 0)).rejects.toMatchObject({ code: 'invalid-response' });
        fetchMock.mockResolvedValueOnce(Response.json({ items: [], hasMore: true, nextOffset: 0 }));
        await expect(bilibiliProvider.catalog!.getPlaylistTracks!('fav:789', 20, 0)).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('imports all successful pages once and never resolves every cid while browsing a folder', async () => {
        keepBilibiliSession('fixture_bearer');
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(Response.json({ items: [favoriteVideo], hasMore: true, nextOffset: 2 }))
            .mockResolvedValueOnce(Response.json({ items: [{ ...favoriteVideo, bvid: 'BV1FT6dBtEfg' }], hasMore: false, nextOffset: 3 }));
        vi.stubGlobal('fetch', fetchMock);
        const imported = await bilibiliProvider.linkImport!.importCollection!(normalizeBilibiliFavoriteFolder(favoriteFolder));
        expect(imported).toHaveLength(2);
        expect(await loadBilibiliImports()).toEqual(imported);
        expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/bilibili/favorites/789/tracks?limit=20&offset=0', '/api/bilibili/favorites/789/tracks?limit=20&offset=2']);
    });

    it('does not persist partial folder imports or a response after signing out', async () => {
        keepBilibiliSession('fixture_bearer');
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(Response.json({ items: [favoriteVideo], hasMore: true, nextOffset: 1 }))
            .mockResolvedValueOnce(Response.json({ code: 'upstream-restricted' }, { status: 412 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(bilibiliProvider.linkImport!.importCollection!(normalizeBilibiliFavoriteFolder(favoriteFolder))).rejects.toMatchObject({ httpStatus: 412 });
        expect(await loadBilibiliImports()).toEqual([]);
        let finish!: (response: Response) => void;
        fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
        const importing = bilibiliProvider.linkImport!.importCollection!(normalizeBilibiliFavoriteFolder(favoriteFolder));
        bilibiliProvider.auth!.signInRanOut!();
        finish(Response.json({ items: [favoriteVideo], hasMore: false, nextOffset: 1 }));
        await expect(importing).rejects.toMatchObject({ cause: { code: 'session-changed' } });
        expect(await loadBilibiliImports()).toEqual([]);
    });
});

describe('single-video account playback tickets', () => {
    it('prepares the first part only when played and returns a short-lived same-adapter ticket', async () => {
        keepBilibiliSession('fixture_bearer');
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ url: '/api/bilibili/stream?ticket=fixture_short_ticket', quality: 'high', expiresAt: Date.now() + 90 * 60_000 }));
        vi.stubGlobal('fetch', fetchMock);
        const audio = await getBilibiliAudioSource(`${video.bvid}:first`);
        expect(audio.url).toBe('/api/bilibili/stream?ticket=fixture_short_ticket');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ bvid: video.bvid, first: true });
        expect(fetchMock.mock.calls[0][1].headers.get('X-Bilibili-Session')).toBe('fixture_bearer');
        expect(fetchMock.mock.calls[0][0]).not.toContain('fixture_bearer');
    });

    it('rejects arbitrary media URLs, long session query parameters and expired playback tickets', async () => {
        keepBilibiliSession('fixture_bearer');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        for (const source of [
            { url: 'https://untrusted.invalid/audio?ticket=fixture', expiresAt: Date.now() + 60_000 },
            { url: '/api/bilibili/stream?ticket=fixture&session=long_token', expiresAt: Date.now() + 60_000 },
            { url: '/api/bilibili/stream?ticket=fixture', expiresAt: Date.now() - 1000 },
        ]) {
            fetchMock.mockResolvedValueOnce(Response.json({ ...source, quality: 'high' }));
            await expect(getBilibiliAudioSource(`${video.bvid}:first`)).rejects.toMatchObject({ code: 'invalid-response' });
        }
    });

    it('never retries an authenticated 412 through the anonymous path', async () => {
        keepBilibiliSession('fixture_bearer');
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 'upstream-restricted' }, { status: 412 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(getBilibiliAudioSource(`${video.bvid}:first`)).rejects.toMatchObject({ httpStatus: 412 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/bilibili/playback/prepare');
    });
});
