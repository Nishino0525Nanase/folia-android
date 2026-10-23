import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/utils/onlineLyricsState', () => ({ loadOnlineLyricsState: vi.fn() }));
vi.mock('@/services/lyricAlignment/alignmentAudio', () => ({ readAlignmentAudio: vi.fn() }));
import { inferAlignment } from '@/services/lyricAlignment/alignmentService';

// Worker lifetime is bounded on cancellation, failure and completion so a hidden panel cannot leak inference.
class WorkerStub {
    static latest: WorkerStub;
    onerror?: (event: { message: string }) => void;
    onmessage?: (event: { data: unknown }) => void;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() { WorkerStub.latest = this; }
}
afterEach(() => vi.unstubAllGlobals());
const request = () => ({ samples: new Float32Array(160), lyrics: null, language: 'auto' as const });
it('terminates inference immediately on cancellation', async () => {
    vi.stubGlobal('Worker', WorkerStub);
    const controller = new AbortController();
    const pending = inferAlignment(request(), controller.signal, () => {});
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(WorkerStub.latest.terminate).toHaveBeenCalledOnce();
});
it('delivers progress and disposes the worker after a result', async () => {
    vi.stubGlobal('Worker', WorkerStub);
    const progress = vi.fn();
    const pending = inferAlignment(request(), new AbortController().signal, progress);
    WorkerStub.latest.onmessage?.({ data: { type: 'progress', value: { phase: 'recognizing', progress: 50 } } });
    const result = { kind: 'transcribed', lyrics: { lines: [] }, matchedLines: 0, totalLines: 0, coverage: 0 };
    WorkerStub.latest.onmessage?.({ data: { type: 'result', value: result } });
    expect(await pending).toEqual(result);
    expect(progress).toHaveBeenCalledWith({ phase: 'recognizing', progress: 50 });
    expect(WorkerStub.latest.terminate).toHaveBeenCalledOnce();
});
it('does not leave a worker alive when initialization or messaging fails', async () => {
    vi.stubGlobal('Worker', WorkerStub);
    const pending = inferAlignment(request(), new AbortController().signal, () => {});
    WorkerStub.latest.onerror?.({ message: 'unavailable' });
    await expect(pending).rejects.toThrow('unavailable');
    expect(WorkerStub.latest.terminate).toHaveBeenCalledOnce();
    class BrokenWorker extends WorkerStub { postMessage = vi.fn(() => { throw new Error('clone-failed'); }); }
    vi.stubGlobal('Worker', BrokenWorker);
    await expect(inferAlignment(request(), new AbortController().signal, () => {})).rejects.toThrow('clone-failed');
    expect(WorkerStub.latest.terminate).toHaveBeenCalledOnce();
});
