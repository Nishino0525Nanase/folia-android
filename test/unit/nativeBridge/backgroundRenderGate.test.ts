// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Resume must keep rAF asynchronous and cancellable, including frames requested before hiding.

let frames: Map<number, FrameRequestCallback>;
let gate: typeof import('@/utils/backgroundRenderGate');

beforeEach(async () => {
    vi.resetModules();
    const frameWindow = window as Window & {
        __foliaBackgroundRequestAnimationFrame?: (callback: FrameRequestCallback) => number;
        __foliaBackgroundCancelAnimationFrame?: (handle: number) => void;
    };
    delete frameWindow.__foliaBackgroundRequestAnimationFrame;
    delete frameWindow.__foliaBackgroundCancelAnimationFrame;
    frames = new Map();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frames.set(++nextFrame, callback); return nextFrame; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn(handle => { frames.delete(handle); }));
    gate = await import('@/utils/backgroundRenderGate');
    gate.ensureBackgroundRenderGateInstalled();
});

afterEach(() => {
    gate.setBackgroundRenderSuspended(false);
    document.documentElement.removeAttribute('data-folia-background');
    vi.unstubAllGlobals();
});

const drawFrame = () => {
    const ready = Array.from(frames.values());
    frames.clear();
    for (const callback of ready) callback(123);
};

describe('background render gate', () => {
    it('defers resumed callbacks until after styles and lifecycle listeners are restored', () => {
        const states: string[] = [];
        gate.setBackgroundRenderSuspended(true);
        window.requestAnimationFrame(() => {
            expect(document.documentElement.hasAttribute('data-folia-background')).toBe(false);
            states.push('frame');
        });
        const unsubscribe = gate.subscribeBackgroundRenderSuspended(() => states.push('visible'));
        gate.setBackgroundRenderSuspended(false);
        expect(states).toEqual(['visible']);
        expect(frames.size).toBe(1);
        drawFrame();
        expect(states).toEqual(['visible', 'frame']);
        unsubscribe();
    });

    it('cancels pre-hide frames without losing them and supports cancellation after resume', () => {
        const draw = vi.fn();
        const handle = window.requestAnimationFrame(draw);
        expect(frames.size).toBe(1);
        gate.setBackgroundRenderSuspended(true);
        expect(frames.size).toBe(0);
        gate.setBackgroundRenderSuspended(false);
        expect(draw).not.toHaveBeenCalled();
        expect(frames.size).toBe(1);
        window.cancelAnimationFrame(handle);
        expect(frames.size).toBe(0);
        drawFrame();
        expect(draw).not.toHaveBeenCalled();
    });

    it('runs a surviving callback once after repeated background transitions', () => {
        const draw = vi.fn();
        gate.setBackgroundRenderSuspended(true);
        window.requestAnimationFrame(draw);
        for (let index = 0; index < 3; index += 1) {
            gate.setBackgroundRenderSuspended(false);
            gate.setBackgroundRenderSuspended(true);
        }
        gate.setBackgroundRenderSuspended(false);
        drawFrame();
        drawFrame();
        expect(draw).toHaveBeenCalledExactlyOnceWith(123);
    });

    it('keeps callback-created animation loops on separate frames', () => {
        const draw = vi.fn(() => { window.requestAnimationFrame(draw); });
        gate.setBackgroundRenderSuspended(true);
        window.requestAnimationFrame(draw);
        gate.setBackgroundRenderSuspended(false);
        drawFrame();
        expect(draw).toHaveBeenCalledTimes(1);
        expect(frames.size).toBe(1);
        drawFrame();
        expect(draw).toHaveBeenCalledTimes(2);
        gate.setBackgroundRenderSuspended(true);
    });
});
