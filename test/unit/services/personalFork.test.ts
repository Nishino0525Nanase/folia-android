import { afterEach, describe, expect, it, vi } from 'vitest';

// Personal distribution never contacts an upstream APK updater or enables cloud cache implicitly.
describe('personal fork defaults', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

    it('does not fetch updates for the independently signed build', async () => {
        vi.stubGlobal('__PERSONAL_FORK_BUILD__', true);
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        vi.resetModules();
        const updater = await import('../../../src/services/appUpdate');
        expect(updater.APP_UPDATE_MANIFEST_URL).toBe('');
        expect(await updater.checkForAppUpdate()).toMatchObject({ status: 'failed', message: 'manual-update' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('starts with cloud cache off and preserves an explicit opt in', async () => {
        const values = new Map<string, string>();
        vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
        vi.resetModules();
        const cloud = await import('../../../src/services/foliaCloud');
        expect(cloud.isFoliaCloudCacheEnabled()).toBe(false);
        cloud.updateFoliaCloudSettings({ enabled: true });
        expect(cloud.isFoliaCloudCacheEnabled()).toBe(true);
        expect(JSON.parse(values.get('foliaCloudSettings.v2')!)).toMatchObject({ enabled: true });
    });
});
