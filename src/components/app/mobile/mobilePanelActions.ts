export type MobilePanelActionsDeps = {
    isMobileTouch: boolean;
    readPanelOpen: () => boolean;
    setPanelOpen: (isOpen: boolean) => void;
    selectControls: () => void;
    togglePanel: () => void;
    closeNavigation: () => void;
    openNavigation: () => void;
};

// The original corner handle remains the console's primary entry on touch screens. Read its
// live state for every tap so a quick second tap closes the panel before React has rendered it.
export const createMobilePanelActions = (deps: MobilePanelActionsDeps) => ({
    toggle: () => {
        if (!deps.isMobileTouch) {
            deps.togglePanel();
            return;
        }
        deps.closeNavigation();
        if (deps.readPanelOpen()) {
            deps.setPanelOpen(false);
            return;
        }
        deps.selectControls();
        deps.setPanelOpen(true);
    },
    more: () => {
        deps.setPanelOpen(false);
        deps.openNavigation();
    },
});
