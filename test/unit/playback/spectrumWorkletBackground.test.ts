import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { SPECTRUM_WORKLET_SOURCE } from '@/services/spectrumWorkletSource';

// Exercise the actual worklet source: background audio must not pay for invisible FFT work.

type Processor = {
    port: { onmessage: (event: { data: string }) => void; postMessage: ReturnType<typeof vi.fn> };
    process: (inputs: Float32Array[][]) => boolean;
    analyse: () => void;
    ring: Float32Array;
    smoothed: Float32Array;
};

function createProcessor(paused = false): Processor {
    let ProcessorClass!: new (options: object) => Processor;
    runInNewContext(SPECTRUM_WORKLET_SOURCE, {
        AudioWorkletProcessor: class { port = { onmessage: null, postMessage: vi.fn() }; },
        sampleRate: 48000,
        registerProcessor: (_name: string, constructor: typeof ProcessorClass) => { ProcessorClass = constructor; },
    });
    return new ProcessorClass({ processorOptions: { paused } });
}

const input = [[new Float32Array(128).fill(0.1)]];
const processBlocks = (processor: Processor, count: number) => {
    for (let block = 0; block < count; block += 1) expect(processor.process(input)).toBe(true);
};

describe('spectrum worklet background lifecycle', () => {
    it('does no FFT or messages while paused, and can resume without restarting audio', () => {
        const processor = createProcessor();
        const analyse = vi.spyOn(processor, 'analyse');
        processBlocks(processor, 8);
        expect(analyse).toHaveBeenCalledTimes(1);
        expect(processor.port.postMessage).toHaveBeenCalledTimes(1);
        processor.port.onmessage({ data: 'pause' });
        processBlocks(processor, 100);
        expect(analyse).toHaveBeenCalledTimes(1);
        expect(processor.port.postMessage).toHaveBeenCalledTimes(1);
        processor.port.onmessage({ data: 'resume' });
        expect(Array.from(processor.ring).every(value => value === 0)).toBe(true);
        expect(Array.from(processor.smoothed).every(value => value === 0)).toBe(true);
        processBlocks(processor, 8);
        expect(analyse).toHaveBeenCalledTimes(2);
    });

    it('starts suspended when created in background and still honors permanent disposal', () => {
        const processor = createProcessor(true);
        const analyse = vi.spyOn(processor, 'analyse');
        processBlocks(processor, 100);
        expect(analyse).not.toHaveBeenCalled();
        expect(processor.port.postMessage).not.toHaveBeenCalled();
        processor.port.onmessage({ data: 'stop' });
        expect(processor.process(input)).toBe(false);
        processor.port.onmessage({ data: 'resume' });
        expect(processor.process(input)).toBe(false);
    });
});
