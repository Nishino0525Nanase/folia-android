import { describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { createLyricPreparationQueue, type PreparationResult, type PreparationSnapshot } from '@/services/lyricPreparation/lyricPreparationQueue';

// Real queue scheduling with controlled I/O verifies restart and pause races without timers or network.
const song = (id: number): SongResult => ({ id, name: `Song ${id}`, artists: [], album: { id: 0, name: '' }, durationMs: 200_000,
    sourceRef: { kind: 'online', providerId: 'video', mediaId: String(id) } });
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const harness = (saved: PreparationSnapshot | null = null) => {
    const pending: { resolve: (value: PreparationResult) => void; current: () => boolean }[] = [];
    const deps = { load: vi.fn(async () => saved), save: vi.fn(async (_value: PreparationSnapshot) => {}),
        prepare: vi.fn(async (_song: SongResult, current: () => boolean) => { const job = deferred<PreparationResult>(); pending.push({ ...job, current }); return job.promise; }),
        canRun: () => true, wait: async () => {} };
    const queue = createLyricPreparationQueue(deps);
    return { queue, deps, pending };
};

describe('durable lyric preparation', () => {
    it('starts two jobs without blocking import and deduplicates repeated pages and collection memberships', async () => {
        const h = harness();
        await h.queue.enqueue([song(1), song(2), song(3)], 'a');
        await h.queue.enqueue([song(1), song(2)], 'b');
        expect(h.deps.prepare).toHaveBeenCalledTimes(2);
        expect(h.queue.getSnapshot().entries).toHaveLength(3);
        expect(h.queue.getSnapshot().entries[0].groups).toEqual(['a', 'b']);
        h.pending[0].resolve('ready'); await settle();
        expect(h.deps.prepare).toHaveBeenCalledTimes(3);
        h.pending[1].resolve('failed'); h.pending[2].resolve('unmatched'); await settle(); await h.queue.flush();
        expect(h.queue.getSnapshot().entries.map(entry => entry.status)).toEqual(['ready', 'failed', 'unmatched']);
        await h.queue.enqueue([song(1), song(2), song(3)], 'a');
        expect(h.deps.prepare).toHaveBeenCalledTimes(3);
    });

    it('invalidates in-flight saves when paused and resumes without losing unfinished jobs', async () => {
        const h = harness(); await h.queue.enqueue([song(1), song(2), song(3)], 'a');
        const before = h.queue.getSnapshot();
        h.queue.togglePause();
        expect(before.paused).toBe(false);
        expect(h.pending.every(job => !job.current())).toBe(true);
        h.pending[0].resolve('ready'); h.pending[1].resolve('ready'); await settle();
        expect(h.queue.getSnapshot().entries.every(entry => entry.status === 'pending')).toBe(true);
        expect(before.entries[0].status).toBe('running');
        h.queue.togglePause(); expect(h.deps.prepare).toHaveBeenCalledTimes(4);
    });

    it('resumes interrupted jobs after restart while preserving completed results and pause state', async () => {
        const first = harness(); await first.queue.enqueue([song(1), song(2)], 'a');
        first.pending[0].resolve('ready'); await settle(); first.queue.togglePause();
        await first.queue.flush();
        const saved = structuredClone(first.deps.save.mock.calls.at(-1)![0]);
        const next = harness(saved); await next.queue.initialize();
        expect(next.deps.prepare).not.toHaveBeenCalled();
        expect(next.queue.getSnapshot().entries.map(entry => entry.status)).toEqual(['ready', 'pending']);
        next.queue.togglePause(); expect(next.deps.prepare).toHaveBeenCalledTimes(1);
        expect(next.deps.prepare.mock.calls[0][0].id).toBe(2);
    });

    it('retries only unresolved songs of the selected collection', async () => {
        const h = harness(); await h.queue.enqueue([song(1), song(2)], 'a');
        h.pending[0].resolve('ready'); h.pending[1].resolve('unmatched'); await settle();
        h.queue.retry('b'); expect(h.deps.prepare).toHaveBeenCalledTimes(2);
        h.queue.retry('a'); expect(h.deps.prepare).toHaveBeenCalledTimes(3);
        expect(h.deps.prepare.mock.calls[2][0].id).toBe(2);
    });

    it('does not run while offline and resumes on wake', async () => {
        const h = harness(); let online = false; h.deps.canRun = () => online;
        await h.queue.enqueue([song(1)], 'a'); expect(h.deps.prepare).not.toHaveBeenCalled();
        online = true; h.queue.wake(); expect(h.deps.prepare).toHaveBeenCalledOnce();
    });
});
