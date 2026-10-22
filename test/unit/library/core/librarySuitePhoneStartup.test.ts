import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Verifies phone startup defaults without changing explicit choices or switching while browsing.
const loadStore = async ({
    width = 390,
    coarse = true,
    saved,
    media = 'available',
}: {
    width?: number;
    coarse?: boolean;
    saved?: string;
    media?: 'available' | 'missing' | 'throws' | 'server';
} = {}) => {
    vi.resetModules();
    const storage = new Map<string, string>(saved ? [['library_suite', saved]] : []);
    const setItem = vi.fn((key: string, value: string) => { storage.set(key, value); });
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem,
        removeItem: (key: string) => storage.delete(key),
    });
    const device = { width, coarse };
    const matchMedia = vi.fn(() => {
        if (media === 'throws') throw new Error('media query unavailable');
        return { matches: device.width <= 767 && device.coarse };
    });
    const addEventListener = vi.fn();
    vi.stubGlobal('window', media === 'server' ? undefined : {
        matchMedia: media === 'missing' ? undefined : matchMedia,
        addEventListener,
    });
    const { useLibrarySuiteStore } = await import('@/library/core/suite/useLibrarySuiteStore');
    return { store: useLibrarySuiteStore, device, storage, setItem, matchMedia, addEventListener };
};

describe('phone library suite startup', () => {
    beforeEach(() => vi.stubEnv('VITE_LIBRARY_INITIAL_SUITE', 'bravais'));
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('starts a new coarse-pointer phone on the original grid without persisting the inference', async () => {
        const { store, storage, setItem, matchMedia } = await loadStore();
        expect(store.getState().suite).toBe('grid');
        expect(storage.has('library_suite')).toBe(false);
        expect(setItem).not.toHaveBeenCalled();
        expect(matchMedia).toHaveBeenCalledWith('(max-width: 767px) and (pointer: coarse)');
    });

    it.each(['bravais', 'grid'])('preserves an explicit saved %s choice on a phone', async saved => {
        const { store, setItem, matchMedia } = await loadStore({ saved });
        expect(store.getState().suite).toBe(saved);
        expect(setItem).not.toHaveBeenCalled();
        expect(matchMedia).not.toHaveBeenCalled();
    });

    it.each([
        { width: 1440, coarse: false, label: 'desktop' },
        { width: 820, coarse: true, label: 'tablet' },
        { width: 390, coarse: false, label: 'fine-pointer narrow window' },
        { width: 768, coarse: true, label: 'just above the phone boundary' },
    ])('keeps the existing default on $label', async device => {
        const { store, setItem } = await loadStore(device);
        expect(store.getState().suite).toBe('bravais');
        expect(setItem).not.toHaveBeenCalled();
    });

    it.each(['server', 'missing', 'throws'] as const)('safely keeps the build default when media queries are %s', async media => {
        const { store } = await loadStore({ media });
        expect(store.getState().suite).toBe('bravais');
    });

    it('does not switch during resize; explicit hydration re-evaluates only an unsaved default', async () => {
        const { store, device, storage, setItem, addEventListener } = await loadStore();
        expect(store.getState().suite).toBe('grid');
        device.width = 1440;
        device.coarse = false;
        expect(store.getState().suite).toBe('grid');
        expect(addEventListener).not.toHaveBeenCalled();
        store.getState().hydrate();
        expect(store.getState().suite).toBe('bravais');
        expect(storage.has('library_suite')).toBe(false);
        expect(setItem).not.toHaveBeenCalled();
        storage.set('library_suite', 'bravais');
        device.width = 390;
        device.coarse = true;
        store.getState().hydrate();
        expect(store.getState().suite).toBe('bravais');
    });

    it('persists a later explicit choice using the existing storage key', async () => {
        const { store, device, storage, setItem } = await loadStore();
        store.getState().setSuite('bravais');
        expect(setItem).toHaveBeenCalledWith('library_suite', 'bravais');
        device.width = 1440;
        store.getState().hydrate();
        device.width = 390;
        store.getState().hydrate();
        expect(store.getState().suite).toBe('bravais');
        expect(storage.get('library_suite')).toBe('bravais');
        expect(setItem).toHaveBeenCalledTimes(1);
    });
});
