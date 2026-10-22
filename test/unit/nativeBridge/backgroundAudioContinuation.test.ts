// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackgroundRenderPause } from '@/hooks/useBackgroundRenderPause';
import { isBackgroundRenderSuspended } from '@/utils/backgroundRenderGate';

// Check the existing native background event boundary without claiming device playback coverage.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let background: (payload: { background: boolean }) => void;
const Probe = () => { useBackgroundRenderPause(); return null; };

beforeEach(() => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('Capacitor', {
        getPlatform: () => 'android',
        Plugins: { FoliaNative: { addListener: (_event: string, listener: typeof background) => {
            background = listener;
            return Promise.resolve({ remove: vi.fn() });
        } } },
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.querySelectorAll('[data-background-audio-test]').forEach(element => element.remove());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('native background audio continuation boundary', () => {
    it('suspends rendering and video while leaving the playing audio untouched', async () => {
        const audio = document.createElement('audio');
        const video = document.createElement('video');
        for (const element of [audio, video]) {
            element.dataset.backgroundAudioTest = '1'; document.body.append(element);
        }
        vi.spyOn(audio, 'paused', 'get').mockReturnValue(false);
        const pauseAudio = vi.spyOn(audio, 'pause').mockImplementation(() => {});
        const playAudio = vi.spyOn(audio, 'play').mockResolvedValue();
        let videoPaused = false;
        vi.spyOn(video, 'paused', 'get').mockImplementation(() => videoPaused);
        const pauseVideo = vi.spyOn(video, 'pause').mockImplementation(() => { videoPaused = true; });
        const playVideo = vi.spyOn(video, 'play').mockImplementation(async () => { videoPaused = false; });

        await act(async () => root.render(createElement(Probe)));
        act(() => background({ background: true }));
        expect(isBackgroundRenderSuspended()).toBe(true);
        expect(pauseVideo).toHaveBeenCalledTimes(1);
        const draw = vi.fn();
        window.requestAnimationFrame(draw);
        expect(draw).not.toHaveBeenCalled();

        act(() => background({ background: false }));
        expect(isBackgroundRenderSuspended()).toBe(false);
        expect(draw).toHaveBeenCalledTimes(1);
        expect(playVideo).toHaveBeenCalledTimes(1);
        expect(pauseAudio).not.toHaveBeenCalled();
        expect(playAudio).not.toHaveBeenCalled();
        expect(audio.paused).toBe(false);
    });
});
