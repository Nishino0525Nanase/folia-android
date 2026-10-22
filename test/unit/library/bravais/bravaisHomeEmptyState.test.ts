import { describe, expect, it, vi } from 'vitest';
import { shouldShowBravaisHomeEmptyState, type BravaisHomeEmptyStateInput } from '@/library/suites/bravais/bravaisHomeEmptyState';

// test/unit/library/bravais/bravaisHomeEmptyState.test.ts
// 手机空墙引导不能遮挡其它层、已有内容、搜索或切换中的界面，也不持久化首页选择。

const emptyGuest: BravaisHomeEmptyStateInput = {
    phoneTouch: true,
    active: true,
    owned: true,
    home: true,
    depth: 0,
    itemCount: 0,
    loading: false,
    accountView: 'guest',
    searchOpen: false,
    filterOpen: false,
    hasQuery: false,
    panelOpen: false,
    busy: false,
    settling: false,
};

describe('shouldShowBravaisHomeEmptyState', () => {
    it.each(['guest', 'accountless', 'authenticated'] as const)('shows a stable empty phone home for %s', accountView => {
        expect(shouldShowBravaisHomeEmptyState({ ...emptyGuest, accountView })).toBe(true);
    });

    it.each(['phoneTouch', 'active', 'owned', 'home'] as const)('requires %s', flag => {
        expect(shouldShowBravaisHomeEmptyState({ ...emptyGuest, [flag]: false })).toBe(false);
    });

    it.each(['loading', 'searchOpen', 'filterOpen', 'hasQuery', 'panelOpen', 'busy', 'settling'] as const)('stays hidden while %s', flag => {
        expect(shouldShowBravaisHomeEmptyState({ ...emptyGuest, [flag]: true })).toBe(false);
    });

    it.each(['resolving', undefined] as const)('waits for a known online account view instead of %s', accountView => {
        expect(shouldShowBravaisHomeEmptyState({ ...emptyGuest, accountView })).toBe(false);
    });

    it.each(['resolving', undefined] as const)('shows a local empty home independently of online account view %s', accountView => {
        expect(shouldShowBravaisHomeEmptyState({ ...emptyGuest, local: true, accountView })).toBe(true);
    });

    it('still respects interaction blockers on the local empty home', () => {
        expect(shouldShowBravaisHomeEmptyState({ ...emptyGuest, local: true, accountView: undefined, loading: true })).toBe(false);
        expect(shouldShowBravaisHomeEmptyState({ ...emptyGuest, local: true, accountView: undefined, panelOpen: true })).toBe(false);
    });

    it('stays hidden in a collection even when its wall is empty', () => {
        expect(shouldShowBravaisHomeEmptyState({ ...emptyGuest, depth: 1 })).toBe(false);
    });

    it('stays hidden when a home card is present', () => {
        expect(shouldShowBravaisHomeEmptyState({ ...emptyGuest, itemCount: 1 })).toBe(false);
    });

    it('does not read or write storage or mutate its input', () => {
        const getItem = vi.fn(() => { throw new Error('Storage must not be read'); });
        const setItem = vi.fn(() => { throw new Error('Storage must not be written'); });
        vi.stubGlobal('localStorage', { getItem, setItem });
        try {
            const input = Object.freeze({ ...emptyGuest });
            expect(shouldShowBravaisHomeEmptyState(input)).toBe(true);
            expect(input).toEqual(emptyGuest);
            expect(getItem).not.toHaveBeenCalled();
            expect(setItem).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
