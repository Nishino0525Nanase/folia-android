import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNativeAndroidBridge } from '@/services/nativeAndroidBridge';

// test/unit/services/nativeAndroidBridgeBinary.test.ts
// Native encrypted/compressed replies must reach arrayBuffer without passing through UTF-8 text.

vi.mock('@/platform/runtime', () => ({ isCapacitorAndroid: () => true }));
vi.mock('@/nativeBridge/api/folia.js', () => ({ handleFoliaApiRequest: async () => ({}) }));

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Android native fetch binary response', () => {
    it('preserves every byte and exposes the native Set-Cookie mirror', async () => {
        const bytes = new Uint8Array([0x1f, 0x8b, 0x00, 0xff, 0x80, 0xc3, 0x28, 0x00, 0x7f]);
        const httpRequest = vi.fn(async (_options: Record<string, unknown>) => ({
            status: 200,
            headers: [{ name: 'Set-Cookie', value: 'NMTID=test; Path=/' }],
            bodyBase64: btoa(String.fromCharCode(...bytes)),
        }));
        const ordinaryFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({}));
        const fakeWindow = {
            fetch: ordinaryFetch,
            postMessage: vi.fn(),
            addEventListener: vi.fn(),
            Capacitor: { Plugins: { FoliaNative: { httpRequest } } },
        };
        const storage = new Map<string, string>();
        vi.stubGlobal('window', fakeWindow);
        vi.stubGlobal('location', { href: 'https://localhost/' });
        vi.stubGlobal('chrome', {});
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });

        await installNativeAndroidBridge();
        const response = await fakeWindow.fetch('https://interface3.music.163.com/xeapi/song/enhance/player/url/v1');

        expect(response.status).toBe(200);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
        expect(response.headers.get('x-folia-set-cookie')).toBe('NMTID=test; Path=/');
        expect(httpRequest).toHaveBeenCalledOnce();
        expect(httpRequest).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://interface3.music.163.com/xeapi/song/enhance/player/url/v1',
            method: 'GET',
        }));
        expect(ordinaryFetch).not.toHaveBeenCalled();
    });
});
