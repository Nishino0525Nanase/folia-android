import { create } from 'zustand';

// Only the original player corner button opens this transient touch action sheet.
export const useMobileNavigationStore = create<{
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
}>(set => ({
    isOpen: false,
    setIsOpen: isOpen => set({ isOpen }),
}));

export const openMobileNavigation = (): void => useMobileNavigationStore.getState().setIsOpen(true);
export const closeMobileNavigation = (): void => useMobileNavigationStore.getState().setIsOpen(false);
