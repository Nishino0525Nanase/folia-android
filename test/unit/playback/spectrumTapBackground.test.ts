// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpectrumTap, disposeSpectrumTap, readLatestSpectrum } from '@/services/spectrumTap';

// Background analysis is a silent side branch; suspending it must leave the audible graph connected.

const background = vi.hoisted(() => ({ hidden: false, listeners: new Set<(hidden: boolean) => void>() }));
vi.mock('@/utils/backgroundRenderGate', () => ({
    isBackgroundRenderSuspended: () => background.hidden,
    subscribeBackgroundRenderSuspended: (listener: (hidden: boolean) => void) => {
        background.listeners.add(listener);
        return () => background.listeners.delete(listener);
    },
}));
vi.mock('@/utils/mediaDiagnostics', () => ({ noteSpectrumSource: vi.fn() }));

class WorkletNode {
    static instances: WorkletNode[] = [];
    port = { postMessage: vi.fn(), onmessage: null as ((event: MessageEvent) => void) | null };
    connect = vi.fn();
    disconnect = vi.fn();
    constructor(_context: unknown, _name: string, public options: AudioWorkletNodeOptions) {
        WorkletNode.instances.push(this);
    }
}

beforeEach(() => {
    background.hidden = false;
    background.listeners.clear();
    WorkletNode.instances = [];
    vi.stubGlobal('AudioWorkletNode', WorkletNode);
    vi.stubGlobal('URL', class extends URL {
        static createObjectURL = vi.fn(() => 'blob:worklet');
        static revokeObjectURL = vi.fn();
    });
});

afterEach(() => {
    disposeSpectrumTap();
    vi.unstubAllGlobals();
});

const setHidden = (hidden: boolean) => {
    background.hidden = hidden;
    for (const listener of background.listeners) listener(hidden);
};

function fixture() {
    const mute = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    const context = { audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
        createGain: () => mute, destination: {}, suspend: vi.fn() };
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const create = () => createSpectrumTap(context as unknown as AudioContext, source as unknown as AudioNode);
    return { source, context, mute, create };
}

describe('spectrum tap background bridge', () => {
    it('pauses analysis without suspending audio or disconnecting the source, and removes only its branch on dispose', async () => {
        const f = fixture();
        expect(await f.create()).toBe(true);
        const node = WorkletNode.instances[0];
        expect(f.mute.gain.value).toBe(0);
        const snapshot = new MessageEvent('message', { data: {
            spectrum: new Uint8Array([1, 2]).buffer, bands: new Float32Array([1, 2, 3, 4, 5]).buffer,
        } });
        node.port.onmessage!(snapshot);
        expect(readLatestSpectrum()?.bass).toBe(1);
        setHidden(true);
        expect(node.port.postMessage).toHaveBeenLastCalledWith('pause');
        expect(readLatestSpectrum()).toBeNull();
        node.port.onmessage!(snapshot);
        expect(readLatestSpectrum()).toBeNull();
        expect(f.context.suspend).not.toHaveBeenCalled();
        expect(f.source.disconnect).not.toHaveBeenCalled();
        setHidden(false);
        expect(node.port.postMessage).toHaveBeenLastCalledWith('resume');
        disposeSpectrumTap();
        expect(f.source.disconnect).toHaveBeenCalledExactlyOnceWith(node);
        expect(node.port.postMessage).toHaveBeenLastCalledWith('stop');
        expect(background.listeners.size).toBe(0);
    });

    it('starts paused if module loading finishes after backgrounding', async () => {
        const f = fixture();
        const creating = f.create();
        setHidden(true);
        expect(await creating).toBe(true);
        expect(WorkletNode.instances[0].options.processorOptions.paused).toBe(true);
        setHidden(false);
        expect(WorkletNode.instances[0].port.postMessage).toHaveBeenCalledWith('resume');
    });
});
