// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisualizerRendererModel } from '@/components/visualizer/useVisualizerRendererModel';
import { useSearchNavigationStore } from '@/stores/useSearchNavigationStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { lyricCurrentTime } from '@/stores/motionSignals';
import { PlayerState, type Theme } from '@/types';

// Search may freeze a phone's covered background without freezing its live playback clock.

const fixture = vi.hoisted(() => {
    const state = {
        view: 'player', isPanelOpen: false, isPlayerChromeHidden: false,
        settingsModalState: { isOpen: false }, isSubSettingsViewOpen: false,
        isDaylight: false, staticMode: false, alwaysShowPlayerBackButton: false,
        visualizerMode: 'sonnet', visualizerOpacity: 1, disableGeometricBackground: false,
        obsKeepMainWindowAnimation: false,
    };
    return {
        touch: true,
        read: <T,>(select: (value: typeof state) => T): T => select(state),
        background: { mode: 'common' },
    };
});

vi.mock('@/stores/useSearchNavigationStore', async () => {
    const { create } = await import('zustand');
    return { useSearchNavigationStore: create(() => ({ isSearchOpen: false })) };
});
vi.mock('@/hooks/useMobileTouchLayout', () => ({ useMobileTouchLayout: () => fixture.touch }));
vi.mock('@/stores/useAppViewStore', () => ({ useAppViewStore: fixture.read }));
vi.mock('@/stores/useAppChromeStore', () => ({ useAppChromeStore: fixture.read }));
vi.mock('@/stores/useSettingsModalStore', () => ({ useSettingsModalStore: fixture.read }));
vi.mock('@/stores/useThemeSettingsStore', () => ({ useThemeSettingsStore: fixture.read }));
vi.mock('@/stores/useTypographySettingsStore', () => ({ useTypographySettingsStore: fixture.read }));
vi.mock('@/stores/usePlayerChromeSettingsStore', () => ({ usePlayerChromeSettingsStore: fixture.read }));
vi.mock('@/stores/useVisualizerSettingsStore', () => ({ useVisualizerSettingsStore: fixture.read }));
vi.mock('@/stores/useStageSettingsStore', () => ({ useStageSettingsStore: fixture.read }));
vi.mock('@/stores/useLibraryPlayerOcclusionStore', () => ({
    useLibraryPlayerOcclusionStore: fixture.read,
    selectLibraryPlayerBackdrop: () => ({ lyrics: false }),
}));
vi.mock('@/components/visualizer/registry', () => ({
    getVisualizerRegistryEntry: () => ({ followsSongHandoff: false, seeksOnLineClick: false }),
}));
vi.mock('@/components/visualizer/useVisualizerBackgroundConfig', () => ({ useVisualizerBackgroundConfig: () => fixture.background }));
vi.mock('@/components/visualizer/useVisualizerStyleAssets', () => ({ useVisualizerStyleAssets: () => ({}) }));
vi.mock('@/components/visualizer/useVisualizerTunings', () => ({ useVisualizerTunings: () => ({}) }));
vi.mock('@/components/visualizer/useVisualizerSongHandoff', () => ({ useVisualizerSongHandoff: () => null }));
vi.mock('@/services/onlineMusic/songMetadata', () => ({
    getSongArtistLabel: () => '', getSongAlbumLabel: () => '', getSongCoverUrl: () => undefined,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const theme = { backgroundColor: '#000000', primaryColor: '#ffffff' } as Theme;
let root: Root;
let model: ReturnType<typeof useVisualizerRendererModel>;
const Probe = ({ holdBackground }: { holdBackground: boolean }) => {
    model = useVisualizerRendererModel({
        theme, subtitleTheme: theme, seed: 'fixture', isObsBrowserSourceRendering: false,
        shouldPauseVisualizerBackground: holdBackground, hideTranslationSubtitle: false,
        isPlayerPageTransparent: false, onLyricLineSeek: () => {}, onBack: () => {},
    });
    return null;
};
const render = (holdBackground = false) => act(() => root.render(createElement(Probe, { holdBackground })));
const search = (isSearchOpen: boolean) => act(() => useSearchNavigationStore.setState({ isSearchOpen }));

beforeEach(() => {
    fixture.touch = true;
    useSearchNavigationStore.setState({ isSearchOpen: false });
    usePlaybackStore.setState({ playerState: PlayerState.PLAYING, isLoadingToPlay: false, transitionDisplay: null });
    lyricCurrentTime.set(12);
    root = createRoot(document.createElement('div'));
});

afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
});

describe('mobile search background activity', () => {
    it('reacts to opening and closing search while music and the lyric clock stay live', () => {
        render();
        const clock = model.currentTime;
        for (const isSearchOpen of [false, true, false]) {
            search(isSearchOpen);
            expect(model.backgroundStaticMode).toBe(isSearchOpen);
            expect(model.paused).toBe(false);
            expect(model.currentTime).toBe(clock);
            expect(model.currentTime).toBe(lyricCurrentTime);
        }
        lyricCurrentTime.set(18);
        expect(model.currentTime.get()).toBe(18);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
    });

    it('preserves the desktop background behavior when search opens', () => {
        fixture.touch = false;
        render();
        search(true);
        expect(model.backgroundStaticMode).toBe(false);
        expect(model.paused).toBe(false);
    });

    it('keeps an existing background pause request through search changes', () => {
        render(true);
        search(true);
        search(false);
        expect(model.backgroundStaticMode).toBe(true);
        expect(model.paused).toBe(false);
        render(false);
        expect(model.backgroundStaticMode).toBe(false);
    });
});
