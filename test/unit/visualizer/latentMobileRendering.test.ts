// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LatentBackground from '@/components/visualizer/backgrounds/latent/LatentBackground';
import { LATENT_MAX_SHADER_PIXELS, resolveLatentPixelBudget } from '@/components/visualizer/backgrounds/latent/useLatentPixelBudget';
import { audioBands, audioPower } from '@/stores/motionSignals';
import type { Theme } from '@/types';

// Exercise the real background's measured phone budget and the static-mode RAF boundary.

const shaders = vi.hoisted(() => ({ setSpeed: vi.fn() }));
vi.mock('@paper-design/shaders-react', async () => {
    const React = await import('react');
    const Shader = React.forwardRef<HTMLElement, { maxPixelCount: number; speed: number }>((props, ref) => {
        React.useImperativeHandle(ref, () => Object.assign(document.createElement('div'), {
            paperShaderMount: { setSpeed: shaders.setSpeed },
        }));
        return React.createElement('div', { 'data-budget': props.maxPixelCount, 'data-speed': props.speed });
    });
    return { MeshGradient: Shader, Dithering: Shader };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let width: number;
let height: number;
let resize: () => void;
let frames: Map<number, FrameRequestCallback>;
const disconnect = vi.fn();
const theme = { backgroundColor: '#000000', primaryColor: '#ffffff', secondaryColor: '#888888', accentColor: '#ff0000' } as Theme;
const render = (staticMode: boolean) => act(() => root.render(createElement(LatentBackground, {
    theme, audioPower, audioBands, staticMode, paused: false,
})));

beforeEach(() => {
    vi.clearAllMocks();
    width = 390; height = 844;
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => width);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) { resize = callback; }
        observe() {} disconnect = disconnect;
    });
    frames = new Map(); let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++nextFrame, callback); return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('Latent phone rendering load', () => {
    it('limits both shader layers to measured CSS pixels and follows container resizing', () => {
        render(false);
        expect([...host.querySelectorAll('[data-budget]')].map(element => Number(element.getAttribute('data-budget'))))
            .toEqual([390 * 844, 390 * 844]);
        width = 412; height = 720;
        act(() => resize());
        expect([...host.querySelectorAll('[data-budget]')].map(element => Number(element.getAttribute('data-budget'))))
            .toEqual([412 * 720, 412 * 720]);
        act(() => root.unmount());
        expect(disconnect).toHaveBeenCalledTimes(1);
        root = createRoot(host);
    });

    it('keeps the desktop budget and safely handles an unmeasured or unusually large container', () => {
        expect(resolveLatentPixelBudget(false, 390, 844)).toBe(LATENT_MAX_SHADER_PIXELS);
        expect(resolveLatentPixelBudget(true, 0, 844)).toBe(LATENT_MAX_SHADER_PIXELS);
        expect(resolveLatentPixelBudget(true, Infinity, 844)).toBe(LATENT_MAX_SHADER_PIXELS);
        expect(resolveLatentPixelBudget(true, 767, 2000)).toBe(LATENT_MAX_SHADER_PIXELS);
    });

    it('stops its audio-response RAF and both shaders when covered, then resumes without pausing playback', () => {
        render(false);
        expect(frames.size).toBe(1);
        render(true);
        expect(frames.size).toBe(0);
        expect(shaders.setSpeed.mock.calls.slice(-2)).toEqual([[0], [0]]);
        expect([...host.querySelectorAll('[data-speed]')].map(element => element.getAttribute('data-speed'))).toEqual(['0', '0']);
        render(false);
        expect(frames.size).toBe(1);
    });
});
