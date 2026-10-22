import { describe, expect, it, vi } from 'vitest';
import { createMobileNavigationActions, type MobileNavigationActionsDeps } from '../../../src/components/app/mobile/mobileNavigationActions';

// Checks that touch entry points keep history navigation and visible player state in sync.
const setup = () => {
    const events: string[] = [];
    const record = (name: string) => vi.fn(() => { events.push(name); });
    const request = { query: '晴天', sourceTab: 'netease' as const, returnView: 'player' as const };
    const deps: MobileNavigationActionsDeps = {
        navigateHome: record('home'),
        navigatePlayer: record('player'),
        navigateSearch: record('search'),
        readSearch: () => request,
        hideSearch: record('hide-search'),
        closePanel: record('close-panel'),
        openQueue: record('open-queue'),
        openManualLyrics: record('open-manual-lyrics'),
        revealPlayer: record('reveal-player'),
        openSettings: record('settings'),
        openCommands: record('commands'),
    };
    return { events, deps, request, actions: createMobileNavigationActions(deps) };
};

describe('mobile touch navigation', () => {
    it('opens the queue after entering the player and makes hidden controls reachable', () => {
        const { actions, events } = setup();
        actions.queue();
        expect(events).toEqual(['hide-search', 'reveal-player', 'player', 'open-queue']);
    });

    it('returns to lyrics with the covering queue panel closed', () => {
        const { actions, events } = setup();
        actions.lyrics();
        expect(events).toEqual(['hide-search', 'close-panel', 'reveal-player', 'player']);
    });

    it('opens the existing lyric source panel after revealing the player', () => {
        const { actions, events } = setup();
        actions.manualLyrics();
        expect(events).toEqual(['hide-search', 'reveal-player', 'player', 'open-manual-lyrics']);
    });

    it('opens search with its current query, source and return page', () => {
        const { actions, deps, request } = setup();
        actions.search();
        expect(deps.navigateSearch).toHaveBeenCalledWith(request);
        expect(deps.navigatePlayer).not.toHaveBeenCalled();
    });

    it('returns to the library through the existing history-aware action', () => {
        const { actions, events } = setup();
        actions.library();
        expect(events).toEqual(['hide-search', 'close-panel', 'home']);
    });

    it('opens settings and commands directly without synthetic keyboard events', () => {
        const { actions, deps } = setup();
        actions.settings();
        actions.more();
        expect(deps.openSettings).toHaveBeenCalledOnce();
        expect(deps.openCommands).toHaveBeenCalledOnce();
    });
});
