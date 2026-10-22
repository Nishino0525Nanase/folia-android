import { describe, expect, it, vi } from 'vitest';
import { createMobilePanelActions } from '../../../src/components/app/mobile/mobilePanelActions';

const setup = (isMobileTouch = true, initiallyOpen = false) => {
    let isOpen = initiallyOpen;
    const events: string[] = [];
    const togglePanel = vi.fn(() => { events.push('desktop-toggle'); });
    const actions = createMobilePanelActions({
        isMobileTouch,
        readPanelOpen: () => isOpen,
        setPanelOpen: value => { isOpen = value; events.push(value ? 'open-panel' : 'close-panel'); },
        selectControls: () => { events.push('controls'); },
        togglePanel,
        closeNavigation: () => { events.push('close-more'); },
        openNavigation: () => { events.push('open-more'); },
    });
    return { actions, events, togglePanel };
};

describe('mobile player console actions', () => {
    it('opens controls directly from the original handle, with More closed', () => {
        const { actions, events } = setup();
        actions.toggle();
        expect(events).toEqual(['close-more', 'controls', 'open-panel']);
    });

    it('closes an already open panel without changing its tab', () => {
        const { actions, events } = setup(true, true);
        actions.toggle();
        expect(events).toEqual(['close-more', 'close-panel']);
    });

    it('reads live open state on rapid consecutive taps', () => {
        const { actions, events } = setup();
        actions.toggle();
        actions.toggle();
        expect(events).toEqual(['close-more', 'controls', 'open-panel', 'close-more', 'close-panel']);
    });

    it('closes the console before opening its secondary More sheet', () => {
        const { actions, events } = setup(true, true);
        actions.more();
        expect(events).toEqual(['close-panel', 'open-more']);
    });

    it('preserves the existing desktop toggle and does not navigate', () => {
        const { actions, events, togglePanel } = setup(false);
        actions.toggle();
        expect(togglePanel).toHaveBeenCalledOnce();
        expect(events).toEqual(['desktop-toggle']);
    });
});
