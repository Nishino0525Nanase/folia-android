// src/library/suites/bravais/bravaisHomeEmptyState.ts
// 手机首页的空墙引导只在首页稳定且没有其它交互占位时出现，不改动套件选择或存储。

export type BravaisHomeEmptyStateInput = {
    phoneTouch: boolean;
    active: boolean;
    owned: boolean;
    home: boolean;
    local?: boolean;
    depth: number;
    itemCount: number;
    loading: boolean;
    accountView: 'guest' | 'accountless' | 'authenticated' | 'resolving' | undefined;
    searchOpen: boolean;
    filterOpen: boolean;
    hasQuery: boolean;
    panelOpen: boolean;
    busy: boolean;
    settling: boolean;
};

export const shouldShowBravaisHomeEmptyState = (input: BravaisHomeEmptyStateInput): boolean => (
    input.phoneTouch
    && input.active
    && input.owned
    && input.home
    && input.depth === 0
    && input.itemCount === 0
    && !input.loading
    && (input.local === true
        || input.accountView === 'guest'
        || input.accountView === 'accountless'
        || input.accountView === 'authenticated')
    && !input.searchOpen
    && !input.filterOpen
    && !input.hasQuery
    && !input.panelOpen
    && !input.busy
    && !input.settling
);
