import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillNativeBilibiliFolderCovers } from '@/services/onlineMusic/bilibili/bilibiliNativeFolderCovers';

// A missing picture never drops a folder, changes its count, or blocks the account indefinitely.
const { native } = vi.hoisted(() => ({ native: vi.fn() }));
vi.mock('@/services/onlineMusic/bilibili/bilibiliNative', () => ({
    nativeBilibili: native,
    record: (value: unknown) => value && typeof value === 'object' ? value : {},
}));
beforeEach(() => { native.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
const folder = (id = 1) => ({ id, media_count: 141, cover: '' });

describe('native favorite cover fallback', () => {
    it('keeps custom covers and empty folders without extra requests', async () => {
        const items = [{ ...folder(), cover: '//i0.hdslb.com/bfs/custom.jpg' }, { ...folder(2), media_count: 0 }];
        await fillNativeBilibiliFolderCovers(items, 'native:fixture');
        expect(native).not.toHaveBeenCalled();
        expect(items[0].cover).toBe('//i0.hdslb.com/bfs/custom.jpg');
    });

    it('prefers the folder detail cover, then a usable video cover', async () => {
        native.mockResolvedValueOnce({ data: { info: { cover: '//i0.hdslb.com/bfs/folder.jpg' }, medias: [{ cover: 'https://i0.hdslb.com/bfs/video.jpg' }] } })
            .mockResolvedValueOnce({ data: { medias: [{ cover: '' }, { cover: 'javascript:bad' }, { cover: 'http://i2.hdslb.com/bfs/video.jpg' }] } });
        const items = [folder(1), folder(2)];
        await fillNativeBilibiliFolderCovers(items, 'native:fixture');
        expect(items.map(item => item.cover)).toEqual(['https://i0.hdslb.com/bfs/folder.jpg', 'https://i2.hdslb.com/bfs/video.jpg']);
        expect(items.map(item => item.media_count)).toEqual([141, 141]);
        expect(native).toHaveBeenCalledWith('tracks', { media_id: '1', pn: '1', ps: '20' }, 'native:fixture', expect.any(AbortSignal));
    });

    it('limits cover requests to two at a time', async () => {
        const finish: (() => void)[] = [];
        native.mockImplementation(() => new Promise(resolve => finish.push(() => resolve({ data: {} }))));
        const pending = fillNativeBilibiliFolderCovers([folder(1), folder(2), folder(3)], 'native:fixture');
        expect(native).toHaveBeenCalledTimes(2);
        finish[0]();
        await Promise.resolve();
        expect(native).toHaveBeenCalledTimes(3);
        finish[1](); finish[2]();
        await pending;
    });

    it('cancels stalled requests within one batch budget and retries on the next refresh', async () => {
        vi.useFakeTimers();
        native.mockImplementation((_operation, _params, _session, signal: AbortSignal) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }));
        const items = [folder(1), folder(2), folder(3)];
        const pending = fillNativeBilibiliFolderCovers(items, 'native:fixture');
        await vi.advanceTimersByTimeAsync(8000);
        await pending;
        expect(native).toHaveBeenCalledTimes(2);
        expect(items).toEqual([folder(1), folder(2), folder(3)]);
        native.mockResolvedValue({ data: { medias: [{ cover: 'https://i0.hdslb.com/bfs/recovered.jpg' }] } });
        await fillNativeBilibiliFolderCovers(items, 'native:fixture');
        expect(items.every(item => item.cover.endsWith('/recovered.jpg'))).toBe(true);
    });
});
