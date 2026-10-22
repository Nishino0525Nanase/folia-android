import cryptoJs from '../../../src/nativeBridge/vendor/crypto-es.mjs';
import { describe, expect, it, vi } from 'vitest';
import { createNeteaseXeapi, NeteaseXeapiError } from '../../../shared/neteaseXeapi.mjs';
import { bootstrapResponse, decryptRequest, encryptedResponse, fixtureState, form, type FixtureFetch } from './neteaseXeapiFixture';

// Exercise the native CryptoJS implementation against installed-protocol fixtures without live accounts.
const PATH = '/api/song/enhance/player/url/v1';
const DATA = { ids: '[123,456]', level: 'standard', encodeType: 'flac' };

function client(fetch: FixtureFetch, cookie = 'MUSIC_U=fixture-account; deviceId=fixture-device', mergeCookies = vi.fn()) {
    return createNeteaseXeapi({ cryptoJs, fetch, getCookies: () => cookie, mergeCookies, deviceId: 'fixture-device' });
}

async function failure(result: Promise<unknown>): Promise<NeteaseXeapiError> {
    try {
        await result;
    } catch (error) {
        expect(error).toBeInstanceOf(NeteaseXeapiError);
        return error as NeteaseXeapiError;
    }
    throw new Error('Expected a provider failure');
}

describe('request-local NetEase XEAPI compatibility', () => {
    it('produces the 4.41.1 X25519, AES-GCM and double-ECB wire format and decodes gzip replies', async () => {
        const answer = { code: 200, data: [{ id: 123, url: 'https://audio.example/song.flac', freeTrialInfo: null }] };
        let requestWire: ReturnType<typeof decryptRequest> | undefined;
        let providerHeaders: Headers | undefined;
        const fetch = vi.fn<FixtureFetch>(async (input, init) => {
            const url = String(input);
            expect(init?.redirect).toBe('manual');
            if (url.endsWith('/api/bsr/sk/get')) return bootstrapResponse(init);
            expect(url).toBe('https://interface3.music.163.com/xeapi/song/enhance/player/url/v1');
            requestWire = decryptRequest(init);
            providerHeaders = new Headers(init?.headers);
            return encryptedResponse(answer, true);
        });
        const result = await client(fetch)(PATH, DATA);
        expect(result).toEqual(answer);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(requestWire?.sealed.slice(1)).toEqual(['android', fixtureState.sk]);
        expect(requestWire?.routeState).toBe(`${fixtureState.version}|`);
        expect(requestWire?.plaintext).toEqual({ content: new URLSearchParams(DATA).toString(), queryString: 'e_r=true' });
        expect(providerHeaders?.get('x-client-enc-state')).toBe('ENCRYPTED');
        expect(providerHeaders?.get('x-aeapi')).toBe('true');
        expect(providerHeaders?.get('x-deviceid')).toBe('fixture-device');
        expect(providerHeaders?.get('x-music-u')).toBe('fixture-account');
    });

    it('rejects a bootstrap whose response signature does not verify, before sending credentials to XEAPI', async () => {
        const fetch = vi.fn<FixtureFetch>(async (_input, init) => bootstrapResponse(init, true));
        const error = await failure(client(fetch)(PATH, DATA));
        expect(error).toBeInstanceOf(NeteaseXeapiError);
        expect(String(error.stage)).not.toBe('');
        expect(String(error.message)).not.toContain('fixture-account');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each(['bootstrap', 'provider'])('keeps an HTTP403 %s failure identifiable without copying its HTML or request cookie', async stage => {
        const sensitiveHtml = '<html>do-not-expose-fixture-secret</html>';
        const fetch = vi.fn<FixtureFetch>(async (input, init) => {
            if (stage === 'provider' && String(input).endsWith('/api/bsr/sk/get')) return bootstrapResponse(init);
            return new Response(sensitiveHtml, { status: 403, headers: { 'content-type': 'text/html' } });
        });
        const error = await failure(client(fetch)(PATH, DATA));
        expect(error).toBeInstanceOf(NeteaseXeapiError);
        expect(error.status).toBe(403);
        expect(String(error.stage)).not.toBe('');
        expect(String(error.message)).not.toContain(sensitiveHtml);
        expect(JSON.stringify(error)).not.toContain('do-not-expose-fixture-secret');
        expect(JSON.stringify(error)).not.toContain('fixture-account');
    });

    it('rejects redirects without forwarding the original provider cookie to the destination', async () => {
        const targets: string[] = [];
        const fetch = vi.fn<FixtureFetch>(async (input, init) => {
            const target = String(input);
            targets.push(target);
            expect(init?.redirect).toBe('manual');
            if (target.endsWith('/api/bsr/sk/get')) return bootstrapResponse(init);
            return new Response(null, { status: 302, headers: { location: 'https://untrusted.example/collect' } });
        });
        const error = await failure(client(fetch)(PATH, DATA));
        expect(error).toBeInstanceOf(NeteaseXeapiError);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(targets.every(target => new URL(target).hostname.endsWith('.music.163.com'))).toBe(true);
        expect(String(error.message)).not.toContain('fixture-account');
    });

    it('keeps simultaneous device and account contexts separate and merges only each response into its owner', async () => {
        const records: Array<{ device: string; cookie: string; login: string }> = [];
        const mergesA = vi.fn();
        const mergesB = vi.fn();
        const makeFetch = (device: string): FixtureFetch => async (input, init) => {
            if (String(input).endsWith('/api/bsr/sk/get')) {
                expect(form(init).get('deviceId')).toBe(device);
                return bootstrapResponse(init);
            }
            await Promise.resolve();
            const headers = new Headers(init?.headers);
            records.push({ device: headers.get('x-deviceid') || '', cookie: headers.get('cookie') || '', login: headers.get('x-music-u') || '' });
            const response = encryptedResponse({ code: 200, owner: device });
            response.headers.append('set-cookie', `NMTID=${device}-nmtid; Path=/; Secure`);
            return response;
        };
        const a = createNeteaseXeapi({ cryptoJs, fetch: makeFetch('device-A'), getCookies: () => 'MUSIC_U=account-A; deviceId=device-A', mergeCookies: mergesA, deviceId: 'device-A' });
        const b = createNeteaseXeapi({ cryptoJs, fetch: makeFetch('device-B'), getCookies: () => 'MUSIC_U=account-B; deviceId=device-B', mergeCookies: mergesB, deviceId: 'device-B' });
        const result = await Promise.all([a(PATH, DATA), b(PATH, DATA)]);
        expect(result).toEqual([{ code: 200, owner: 'device-A' }, { code: 200, owner: 'device-B' }]);
        expect(records).toHaveLength(2);
        for (const [suffix, merges] of [['A', mergesA], ['B', mergesB]] as const) {
            const entry = records.find(item => item.device === `device-${suffix}`)!;
            expect(entry.login).toBe(`account-${suffix}`);
            expect(entry.cookie).toContain(`MUSIC_U=account-${suffix}`);
            expect(entry.cookie).not.toContain(`account-${suffix === 'A' ? 'B' : 'A'}`);
            expect(merges.mock.calls.flat().join(' ')).toContain(`device-${suffix}-nmtid`);
            expect(merges.mock.calls.flat().join(' ')).not.toContain(`device-${suffix === 'A' ? 'B' : 'A'}-nmtid`);
        }
    });
});
