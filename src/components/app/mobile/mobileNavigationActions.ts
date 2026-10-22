import type { SearchSource } from '../../../stores/useSearchNavigationStore';

// Uses the existing history-aware navigation callbacks for every touch entry point.
export type MobileNavigationActionsDeps = {
    navigateHome: () => void;
    navigatePlayer: () => void;
    navigateSearch: (request: { query: string; sourceTab: SearchSource; returnView: 'home' | 'player' }) => void;
    readSearch: () => { query: string; sourceTab: SearchSource; returnView: 'home' | 'player' };
    hideSearch: () => void;
    closePanel: () => void;
    openQueue: () => void;
    openManualLyrics: () => void;
    revealPlayer: () => void;
    openSettings: () => void;
    openCommands: () => void;
};

export const createMobileNavigationActions = (deps: MobileNavigationActionsDeps) => ({
    library: () => {
        deps.hideSearch();
        deps.closePanel();
        deps.navigateHome();
    },
    search: () => {
        const request = deps.readSearch();
        deps.closePanel();
        deps.navigateSearch(request);
    },
    lyrics: () => {
        deps.hideSearch();
        deps.closePanel();
        deps.revealPlayer();
        deps.navigatePlayer();
    },
    queue: () => {
        deps.hideSearch();
        deps.revealPlayer();
        deps.navigatePlayer();
        deps.openQueue();
    },
    manualLyrics: () => {
        deps.hideSearch();
        deps.revealPlayer();
        deps.navigatePlayer();
        deps.openManualLyrics();
    },
    more: deps.openCommands,
    settings: deps.openSettings,
});
