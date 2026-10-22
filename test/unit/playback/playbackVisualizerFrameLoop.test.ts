import { describe, expect, it, vi } from 'vitest';
import { createPlaybackVisualizerFrameLoop, PLAYBACK_VISUALIZER_IDLE_INTERVAL_MS } from '@/components/app/playback/bridges/playbackVisualizerFrameLoop';

// The playback visual clock must release hidden/idle work without throttling active lyric clocks.

function fixture(active = true, hidden = false) {
    let nextHandle = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const timers = new Map<number, { callback: () => void; milliseconds: number }>();
    const update = vi.fn(() => active);
    const handles: number[] = [];
    const loop = createPlaybackVisualizerFrameLoop({
        update,
        isHidden: () => hidden,
        requestFrame: callback => { frames.set(++nextHandle, callback); return nextHandle; },
        cancelFrame: handle => { frames.delete(handle); },
        delay: (callback, milliseconds) => { timers.set(++nextHandle, { callback, milliseconds }); return nextHandle; },
        cancelDelay: handle => { timers.delete(handle); },
        onFrameHandle: handle => { handles.push(handle); },
    });
    return {
        loop, frames, timers, update, handles,
        active: (value: boolean) => { active = value; },
        hidden: (value: boolean) => { hidden = value; },
        frame: () => {
            const [handle, callback] = frames.entries().next().value!;
            frames.delete(handle);
            callback(0);
        },
        timer: () => {
            const [handle, timer] = timers.entries().next().value!;
            timers.delete(handle);
            timer.callback();
        },
    };
}

describe('playback visual frame scheduling', () => {
    it('keeps active audio or synthetic lyrics on consecutive display frames', () => {
        const f = fixture();
        for (let index = 0; index < 5; index += 1) {
            expect(f.frames.size).toBe(1);
            f.frame();
            expect(f.timers.size).toBe(0);
        }
        expect(f.update).toHaveBeenCalledTimes(5);
        f.loop.dispose();
    });

    it('leaves no RAF queued while idle and requests one only after its low-rate delay', () => {
        const f = fixture(false);
        f.frame();
        expect(f.frames.size).toBe(0);
        expect(f.timers.size).toBe(1);
        expect([...f.timers.values()][0].milliseconds).toBe(PLAYBACK_VISUALIZER_IDLE_INTERVAL_MS);
        f.timer();
        expect(f.update).toHaveBeenCalledTimes(1);
        expect(f.frames.size).toBe(1);
        f.frame();
        expect(f.update).toHaveBeenCalledTimes(2);
        f.loop.dispose();
    });

    it('cancels the idle delay when playback wakes and immediately returns to display rate', () => {
        const f = fixture(false);
        f.frame();
        f.active(true);
        f.loop.wake();
        expect(f.timers.size).toBe(0);
        expect(f.frames.size).toBe(1);
        f.frame();
        expect(f.frames.size).toBe(1);
        expect(f.timers.size).toBe(0);
        f.loop.dispose();
    });

    it('does not start hidden and refreshes from the live clock when shown', () => {
        const f = fixture(true, true);
        expect(f.frames.size).toBe(0);
        expect(f.timers.size).toBe(0);
        expect(f.update).not.toHaveBeenCalled();
        f.hidden(false);
        f.loop.wake();
        f.frame();
        expect(f.update).toHaveBeenCalledTimes(1);
        f.loop.dispose();
    });

    it.each([true, false])('cancels pending work on hide when active=%s', active => {
        const f = fixture(active);
        f.frame();
        f.hidden(true);
        f.loop.wake();
        expect(f.frames.size).toBe(0);
        expect(f.timers.size).toBe(0);
        expect(f.handles.at(-1)).toBe(0);
        f.loop.dispose();
    });

    it('releases timers/frames on unmount and cannot restart after disposal', () => {
        const f = fixture(false);
        f.frame();
        f.loop.dispose();
        f.loop.wake();
        expect(f.frames.size).toBe(0);
        expect(f.timers.size).toBe(0);
        expect(f.update).toHaveBeenCalledTimes(1);
    });
});
