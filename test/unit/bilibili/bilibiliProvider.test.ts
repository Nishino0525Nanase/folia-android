import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/bilibili/bilibiliProvider.test.ts
// Contract fixtures only: the platform refused the live verification environment with HTTP 412.
const stored = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/services/onlineMusic/providerStorage', () => ({ getProviderCacheKey: (provider: string, key: string) => `online_provider_${provider}_${key}` }));
vi.mock('@/services/repositories/cacheRepository', () => ({
    readCacheEntry: async (key: string) => structuredClone(stored.values.get(key) ?? null),
    putCacheEntry: async (key: string, value: unknown) => { stored.values.set(key, structuredClone(value)); },
}));

import { bilibiliProvider } from '@/services/onlineMusic/bilibili/bilibiliProvider';
import { bilibiliSongPageUrl, bilibiliVideoSongs, normalizeBilibiliSong, parseBilibiliMediaId, readBilibiliResolvedVideo } from '@/services/onlineMusic/bilibili/bilibiliNormalize';
import { keepBilibiliImports, loadBilibiliImports } from '@/services/onlineMusic/bilibili/bilibiliImports';
import { BILIBILI_REQUEST_LIMIT_MS, getBilibiliApiBase, getBilibiliAudioSource, resolveBilibiliVideo } from '@/services/onlineMusic/bilibili/bilibiliTransport';

const video = {
    bvid: 'BV1FT6dBtEff', aid: 123, title: 'Fixture video', coverUrl: 'http://i0.hdslb.com/fixture.jpg',
    owner: { id: 456, name: 'Uploader' },
    pages: [{ cid: 101, page: 1, title: 'Part one', durationSec: 122 }, { cid: 102, page: 2, title: 'Part two', durationSec: 87 }],
};
const resolved = () => readBilibiliResolvedVideo(video);

beforeEach(() => { stored.values.clear(); vi.stubEnv('VITE_BILIBILI_API_BASE', '/api/bilibili'); });
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

    it('does not expose keyword search or account login', () => {
        expect(bilibiliProvider.capabilities.search).toBe(false);
        expect(bilibiliProvider.capabilities.auth).toBe(false);
        expect(bilibiliProvider.search).toBeUndefined();
        expect(bilibiliProvider.auth).toBeUndefined();
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
