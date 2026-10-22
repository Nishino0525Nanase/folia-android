import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { xeapiRequest } from '../../../src/nativeBridge/api/eapi.js';
import { clearCookieCache } from '../../../src/nativeBridge/api/cookies.js';

// test/unit/nativeBridge/neteaseXeapiAdapter.test.ts
// The shared protocol has its own crypto fixtures; these checks exercise native session/storage integration.

type ProtocolOptions = {
    cryptoJs: { AES: unknown };
    fetch: typeof fetch;
    deviceId: string;
    getCookies: () => string;
    mergeCookies: (cookie: string) => Promise<void>;
};

const protocol = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../../shared/neteaseXeapi.mjs', () => ({ createNeteaseXeapi: protocol.create }));

const stored = new Map<string, unknown>();
const nativeCookies: Array<{ url: string; name: string; value: string }> = [];

beforeEach(() => {
    protocol.create.mockReset();
    clearCookieCache();
    stored.clear();
    nativeCookies.length = 0;
    stored.set('neteaseDeviceId', 'stable-native-device');
    stored.set('neteaseNuid', 'stable-native-nuid');
    stored.set('neteaseWnmcid', 'stable-native-wnmcid');
    vi.stubGlobal('chrome', {
        storage: {
            local: {
                get: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, stored.get(key)])),
                set: async (patch: Record<string, unknown>) => {
                    Object.entries(patch).forEach(([key, value]) => stored.set(key, value));
                },
            },
        },
        cookies: {
            get: async () => null,
            set: async (cookie: { url: string; name: string; value: string }) => {
                nativeCookies.push(cookie);
                return cookie;
            },
        },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('native NetEase XEAPI adapter', () => {
    it('keeps the incoming account while awaiting new anonymous/device cookies in both native stores', async () => {
        stored.set('foliaBridgeNeteaseCookie', 'MUSIC_U=signed-in-fixture');
        const responseBody = { code: 200, data: [{ id: 42, url: null, freeTrialInfo: { start: 0, end: 30 } }] };
        const input = { ids: '[42]', level: 'standard' };
        const transport = vi.fn(async () => Response.json({ code: 200 }));
        vi.stubGlobal('fetch', transport);
        const run = vi.fn(async (path: string, data: Record<string, unknown>, options: ProtocolOptions) => {
            expect(path).toBe('/api/song/enhance/player/url/v1');
            expect(data).toBe(input);
            expect(data).not.toHaveProperty('header');
            expect(options.deviceId).toBe('stable-native-device');
            expect(options.cryptoJs.AES).toBeDefined();
            expect(options.getCookies()).toContain('MUSIC_U=signed-in-fixture');
            await options.fetch('https://interface3.music.163.com/xeapi/fixture', { method: 'POST', body: 'fixture' });
            await options.mergeCookies('MUSIC_A=anonymous-fixture');
            await options.mergeCookies('NMTID=device-marker-fixture');
            await options.mergeCookies('MUSIC_U=must-not-replace-the-account');
            expect(options.getCookies()).toContain('MUSIC_U=signed-in-fixture');
            expect(options.getCookies()).toContain('MUSIC_A=anonymous-fixture');
            expect(options.getCookies()).toContain('NMTID=device-marker-fixture');
            return responseBody;
        });
        protocol.create.mockImplementation((options: ProtocolOptions) => (path: string, data: Record<string, unknown>) => run(path, data, options));

        const result = await xeapiRequest('/api/song/enhance/player/url/v1', input, 'MUSIC_U=signed-in-fixture; __csrf=fixture-csrf');

        expect(result.body).toBe(responseBody);
        expect(result).toMatchObject({ status: 200, setCookies: ['MUSIC_A=anonymous-fixture', 'NMTID=device-marker-fixture'] });
        expect(nativeCookies.map(cookie => [cookie.name, cookie.value])).toEqual([
            ['MUSIC_A', 'anonymous-fixture'],
            ['NMTID', 'device-marker-fixture'],
        ]);
        expect(nativeCookies.every(cookie => cookie.url === 'https://music.163.com/')).toBe(true);
        expect(stored.get('neteaseNmtid')).toBe('device-marker-fixture');
        expect(stored.get('foliaBridgeNeteaseCookie')).toContain('MUSIC_U=signed-in-fixture');
        expect(stored.get('foliaBridgeNeteaseCookie')).toContain('MUSIC_A=anonymous-fixture');
        expect(stored.get('foliaBridgeNeteaseCookie')).not.toContain('must-not-replace');
        expect(transport).toHaveBeenCalledOnce();
    });

    it('preserves the protocol error and creates an isolated cookie closure for the next operation', async () => {
        const failure = Object.assign(new Error('XEAPI upstream refused'), { status: 403, code: 'UPSTREAM_HTTP', stage: 'request' });
        const snapshots: string[] = [];
        protocol.create.mockImplementation((options: ProtocolOptions) => async () => {
            snapshots.push(options.getCookies());
            if (snapshots.length === 1) {
                await options.mergeCookies('MUSIC_A=first-operation-only');
                throw failure;
            }
            return { code: 200 };
        });

        await expect(xeapiRequest('/api/register/anonimous', {}, 'MUSIC_U=first-account')).rejects.toBe(failure);
        const second = await xeapiRequest('/api/song/enhance/player/url/v1', {}, 'MUSIC_U=second-account');

        expect(protocol.create).toHaveBeenCalledTimes(2);
        expect(second.body).toEqual({ code: 200 });
        expect(snapshots[0]).toContain('MUSIC_U=first-account');
        expect(snapshots[1]).toContain('MUSIC_U=second-account');
        expect(snapshots[1]).not.toContain('first-account');
        expect(snapshots[1]).not.toContain('first-operation-only');
    });

    it('registers a fresh guest before the song, reuses its saved cookie, and stops on registration refusal', async () => {
        const calls: string[] = [];
        const username = 'c3RhYmxlLW5hdGl2ZS1kZXZpY2UgZ00rZXVOaW51K1cxQjVaTjRJclZNQT09';
        let refusal: { code: number; message: string } | null = null;
        let transportError: Error | null = null;
        protocol.create.mockImplementation((options: ProtocolOptions) => async (path: string, data: Record<string, unknown>) => {
            calls.push(path);
            if (path === '/api/register/anonimous') {
                expect(data).toEqual({ username });
                if (transportError) throw transportError;
                if (refusal) return refusal;
                await options.mergeCookies('MUSIC_A=registered-guest-fixture');
                return { code: 200 };
            }
            expect(options.getCookies()).toContain('MUSIC_A=registered-guest-fixture');
            expect(stored.get('foliaBridgeNeteaseCookie')).toContain('MUSIC_A=registered-guest-fixture');
            expect(nativeCookies).toEqual(expect.arrayContaining([
                expect.objectContaining({ name: 'MUSIC_A', value: 'registered-guest-fixture' }),
            ]));
            return { code: 200, data: [{ id: 42, url: null }] };
        });

        await xeapiRequest('/api/song/enhance/player/url/v1', { ids: '[42]', level: 'standard' }, '');
        await xeapiRequest('/api/song/enhance/player/url', { ids: '[42]', br: 128000 }, '');
        expect(calls).toEqual([
            '/api/register/anonimous',
            '/api/song/enhance/player/url/v1',
            '/api/song/enhance/player/url',
        ]);
        // An explicit registration also derives its username from the stable local device.
        await xeapiRequest('/api/register/anonimous', {}, '');

        for (const code of [401, 403, 500]) {
            stored.delete('foliaBridgeNeteaseCookie');
            clearCookieCache();
            calls.length = 0;
            refusal = { code, message: 'Registration refused' };
            const result = await xeapiRequest('/api/song/enhance/player/url/v1', { ids: '[42]' }, '');
            expect(result.body).toBe(refusal);
            expect(result).toMatchObject({ status: 200, registrationFailed: true, setCookies: [] });
            expect(calls).toEqual(['/api/register/anonimous']);
        }
        calls.length = 0;
        refusal = null;
        transportError = Object.assign(new Error('Registration HTTP refused'), { status: 403 });
        await expect(xeapiRequest('/api/song/enhance/player/url/v1', {}, '')).rejects.toBe(transportError);
        expect(calls).toEqual(['/api/register/anonimous']);
    });
});
