import type { LyricData, OnlineLyricsState, SongResult } from '../../types';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { loadOnlineLyricsState } from '../../utils/onlineLyricsState';
import { readAlignmentAudio } from './alignmentAudio';
import type { AlignmentLanguage, AlignmentProgress, AlignmentReply, AlignmentRequest } from './protocol';
import type { AlignmentResult } from './alignment';

// One cancellable local job can outlive the lyrics panel. Closing the app ends inference; no audio is uploaded.
export type AlignmentJob = {
    key: string; song: SongResult; originalLyrics: LyricData | null; originalState: OnlineLyricsState | null;
    originalOffset: number; language: AlignmentLanguage; status: 'running' | 'ready' | 'error' | 'cancelled';
    progress: AlignmentProgress; result?: AlignmentResult; error?: string;
};
let job: AlignmentJob | null = null;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();
const update = (patch: Partial<AlignmentJob>) => { if (job) job = { ...job, ...patch }; listeners.forEach(fn => fn()); };

const inferInWorker = (request: AlignmentRequest, signal: AbortSignal, progress: (value: AlignmentProgress) => void): Promise<AlignmentResult> => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./alignment.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = error => { finish(); reject(new Error(error.message || 'model-failed')); };
    worker.onmessage = ({ data }: MessageEvent<AlignmentReply>) => {
        if (data.type === 'progress') progress(data.value);
        else if (data.type === 'result') { finish(); resolve(data.value); }
        else { finish(); reject(new Error(data.message)); }
    };
    try { worker.postMessage(request, [request.samples.buffer]); }
    catch (error) { finish(); reject(error); }
});

// Manual and import-driven recognition share one model slot, including cancelled tasks waiting for it.
let inferenceTail: Promise<unknown> = Promise.resolve();
export const inferAlignment = (request: AlignmentRequest, signal: AbortSignal, progress: (value: AlignmentProgress) => void): Promise<AlignmentResult> => {
    const pending = inferenceTail.then(() => inferInWorker(request, signal, progress));
    inferenceTail = pending.catch(() => {});
    let abort = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new DOMException('Cancelled', 'AbortError'));
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
    return Promise.race([pending, cancelled]).finally(() => signal.removeEventListener('abort', abort));
};

export const audioAlignment = {
    getSnapshot: () => job,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cancel() { controller?.abort(); },
    async start(song: SongResult, lyrics: LyricData | null, audioUrl: string | null, language: AlignmentLanguage, offset: number, mode: 'align' | 'transcribe' = 'align') {
        if (controller) return;
        const task = new AbortController(); controller = task;
        job = { key: getPlaybackSongKey(song), song, originalLyrics: lyrics, originalState: null, originalOffset: offset,
            language, status: 'running', progress: { phase: 'audio' } };
        update({});
        const timeout = setTimeout(() => task.abort(), 20 * 60_000);
        try {
            const originalState = await loadOnlineLyricsState(song);
            task.signal.throwIfAborted(); update({ originalState });
            const samples = await readAlignmentAudio(song, audioUrl, task.signal);
            update({ progress: { phase: 'model' } });
            const result = await inferAlignment({ samples, lyrics: mode === 'transcribe' ? null : lyrics, language }, task.signal, value => update({ progress: value }));
            task.signal.throwIfAborted();
            update({ result, status: 'ready' });
        } catch (error) {
            if (!task.signal.aborted) console.warn('[AudioAlignment] Local recognition failed', error);
            update({ status: task.signal.aborted ? 'cancelled' : 'error', error: error instanceof Error ? error.message : String(error) });
        } finally { clearTimeout(timeout); controller = null; }
    },
};
