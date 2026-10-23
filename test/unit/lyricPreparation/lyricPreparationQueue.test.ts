import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { createLyricPreparationQueue, type PreparationOutcome, type PreparationResult, type PreparationSnapshot } from '@/services/lyricPreparation/lyricPreparationQueue';

// Real queue scheduling with controlled I/O verifies restart and pause races without timers or network.
const song = (id: number): SongResult => ({ id, name: `Song ${id}`, artists: [], album: { id: 0, name: '' }, durationMs: 200_000,
    sourceRef: { kind: 'online', providerId: 'video', mediaId: String(id) } });
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());
const harness = (saved: PreparationSnapshot | null = null) => {
    const pending: { resolve: (value: PreparationResult) => void; current: () => boolean }[] = [];
    const deps = { load: vi.fn(async () => saved), save: vi.fn(async (_value: PreparationSnapshot) => {}),
        prepare: vi.fn(async (_song: SongResult, current: () => boolean) => { const job = deferred<PreparationResult>(); pending.push({ ...job, current }); return job.promise; }),
        canRun: () => true, wait: async () => {} };
    const queue = createLyricPreparationQueue(deps);
    return { queue, deps, pending };
};

describe('durable lyric preparation', () => {
    it('migrates queued and interrupted speech jobs to text search when recognition has been removed', async () => {
        const h = harness({ version: 2, paused: true, entries: ['audio-pending', 'recognizing', 'ready'].map((status, i) => ({
            key: String(i), song: song(i), groups: ['a'], status: status as PreparationSnapshot['entries'][number]['status'], updatedAt: 0, audioProgress: 55,
        })) });
        await h.queue.initialize();
        expect(h.queue.getSnapshot().entries.map(entry => entry.status)).toEqual(['pending', 'pending', 'ready']);
        expect(h.queue.getSnapshot().entries.every(entry => entry.audioProgress === undefined)).toBe(true);
        h.queue.togglePause();
        h.pending[0].resolve('unmatched'); h.pending[1].resolve('review'); await settle();
        expect(h.queue.getSnapshot().entries.map(entry => entry.status)).toEqual(['unmatched', 'review', 'ready']);
    });
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

describe('automatic audio fallback', () => {
    const audioHarness = (saved: PreparationSnapshot | null = null) => {
        const audio: { resolve: (result: PreparationResult) => void; signal: AbortSignal; current: () => boolean; progress: (n: number) => void }[] = [];
        const deps = { load: async () => saved, save: vi.fn(async (_s: PreparationSnapshot) => {}),
            prepare: vi.fn(async (): Promise<PreparationResult> => 'unmatched'),
            recognize: vi.fn(async (_song: SongResult, current: () => boolean, signal: AbortSignal, progress: (n: number) => void) => {
                const task = deferred<PreparationResult>(); audio.push({ ...task, signal, current, progress }); return task.promise;
            }), canRun: () => true, wait: async () => {} };
        return { queue: createLyricPreparationQueue(deps), deps, audio };
    };
    it('automatically recognizes missing lyrics serially while text preparation continues', async () => {
        const h = audioHarness(); await h.queue.enqueue([song(1), song(2), song(3)], 'a'); await settle();
        expect(h.deps.prepare).toHaveBeenCalledTimes(3);
        expect(h.deps.recognize).toHaveBeenCalledTimes(1);
        expect(h.queue.getSnapshot().entries.map(e => e.status)).toEqual(['recognizing', 'audio-pending', 'audio-pending']);
        await h.queue.flush(); const saves = h.deps.save.mock.calls.length;
        h.audio[0].progress(35); expect(h.queue.getSnapshot().entries[0].audioProgress).toBe(35);
        await h.queue.flush(); expect(h.deps.save).toHaveBeenCalledTimes(saves);
        h.audio[0].resolve('ready'); await settle(); expect(h.deps.recognize).toHaveBeenCalledTimes(2);
        h.audio[1].resolve('unmatched'); await settle(); h.audio[2].resolve('ready'); await settle();
        expect(h.queue.getSnapshot().entries.map(e => e.status)).toEqual(['ready', 'unmatched', 'ready']);
    });
    it('automatically upgrades old unresolved imports, without repeating completed or failed audio jobs', async () => {
        const saved: PreparationSnapshot = { version: 1, paused: false, entries: ['ready', 'review', 'unmatched'].map((status, i) =>
            ({ key: String(i), song: song(i), groups: ['a'], updatedAt: 0, status: status as PreparationResult })) };
        const h = audioHarness(saved); await h.queue.initialize();
        expect(h.deps.prepare).not.toHaveBeenCalled(); expect(h.deps.recognize.mock.calls[0][0].id).toBe(1);
        h.audio[0].resolve('failed'); await settle(); h.audio[1].resolve('ready'); await settle(); await h.queue.flush();
        const restart = audioHarness(structuredClone(h.deps.save.mock.calls.at(-1)![0])); await restart.queue.initialize();
        expect(restart.deps.recognize).not.toHaveBeenCalled();
    });
    it('aborts on pause or offline and resumes unfinished recognition without another search', async () => {
        const h = audioHarness(); await h.queue.enqueue([song(1)], 'a'); await settle();
        h.queue.togglePause(); expect(h.audio[0].signal.aborted).toBe(true); expect(h.audio[0].current()).toBe(false);
        h.audio[0].resolve('ready'); await settle(); expect(h.queue.getSnapshot().entries[0].status).toBe('audio-pending');
        h.queue.togglePause(); expect(h.deps.recognize).toHaveBeenCalledTimes(2);
        h.deps.canRun = () => false; h.queue.wake(); expect(h.audio[1].signal.aborted).toBe(true);
        h.audio[1].resolve('ready'); await settle(); h.deps.canRun = () => true; h.queue.wake();
        expect(h.deps.recognize).toHaveBeenCalledTimes(3); expect(h.deps.prepare).toHaveBeenCalledOnce();
    });
});

it('rechecks old unresolved video imports once for the newly available subtitle capability', async () => {
    const saved: PreparationSnapshot = { version: 2, paused: false, entries: ['ready', 'unmatched', 'review', 'failed'].map((status, i) =>
        ({ key: String(i), song: song(i), groups: ['a'], status: status as PreparationResult, updatedAt: 0 })) };
    const prepare = vi.fn(async (): Promise<PreparationResult> => 'unmatched');
    const deps = { load: async () => saved, save: vi.fn(async (_snapshot: PreparationSnapshot) => {}), prepare,
        retryUnresolved: () => true, canRun: () => true, wait: async () => {} };
    const queue = createLyricPreparationQueue(deps); await queue.initialize(); await settle(); await queue.flush();
    expect(prepare).toHaveBeenCalledTimes(3); expect(queue.getSnapshot().entries[0].status).toBe('ready');
    const snapshot = structuredClone(queue.getSnapshot()); expect(snapshot.version).toBe(5);
    prepare.mockClear();
    const restart = createLyricPreparationQueue({ ...deps, load: async () => snapshot });
    await restart.initialize(); await settle(); expect(prepare).not.toHaveBeenCalled();
});

it('rechecks version-four misses once under the new search policy without reviving old retry timers', async () => {
    const prepare = vi.fn(async (): Promise<PreparationResult> => 'unmatched');
    const saved: PreparationSnapshot = { version: 4, paused: true, entries: ['ready', 'unmatched', 'review'].map((status, index) => ({
        key: String(index), song: song(index), groups: ['a'], status: status as PreparationResult, updatedAt: 0,
        ...(index ? { retryAt: Date.now() + 60_000, retryCount: 3 } : {}),
    })) };
    const deps = { load: async () => saved, save: async (_snapshot: PreparationSnapshot) => {}, prepare,
        retryUnresolved: () => true, canRun: () => true, wait: async () => {} };
    const queue = createLyricPreparationQueue(deps);
    await queue.initialize();
    expect(prepare).not.toHaveBeenCalled();
    expect(queue.getSnapshot().entries.map(entry => entry.status)).toEqual(['ready', 'pending', 'pending']);
    expect(queue.getSnapshot().entries[1].retryAt).toBeUndefined();
    queue.togglePause(); await settle();
    expect(prepare).toHaveBeenCalledTimes(2);
    const snapshot = structuredClone(queue.getSnapshot()); prepare.mockClear();
    const restart = createLyricPreparationQueue({ ...deps, load: async () => snapshot });
    await restart.initialize(); await settle();
    expect(prepare).not.toHaveBeenCalled();
});

it('keeps native caption jobs eligible when other automatic matching is disabled', async () => {
    const prepare = vi.fn(async (_song: SongResult): Promise<PreparationResult> => 'ready');
    let enabled = false;
    const queue = createLyricPreparationQueue({ load: async () => null, save: async () => {}, prepare,
        canRun: () => true, canRunSong: song => song.id === 1 || enabled, wait: async () => {} });
    await queue.enqueue([song(1), song(2)], 'a'); await settle();
    expect(prepare.mock.calls.map(call => call[0].id)).toEqual([1]);
    expect(queue.getSnapshot().entries.map(entry => entry.status)).toEqual(['ready', 'pending']);
    enabled = true; queue.wake(); await settle();
    expect(prepare.mock.calls.map(call => call[0].id)).toEqual([1, 2]);
});
it('retries transient subtitle failures twice, preserves fallback lyrics, and pauses timers in the background', async () => {
    vi.useFakeTimers(); let foreground = true;
    const prepare = vi.fn(async (): Promise<PreparationOutcome> => ({ status: 'ready', mediaSubtitleStatus: 'unavailable' }));
    const queue = createLyricPreparationQueue({ load: async () => null, save: async () => {}, prepare,
        canRun: () => foreground, wait: async () => {} });
    await queue.enqueue([song(1)], 'a'); await settle();
    expect(queue.getSnapshot().entries[0]).toMatchObject({ status: 'ready', retryCount: 1 });
    foreground = false; queue.wake(); await vi.advanceTimersByTimeAsync(60_000);
    expect(prepare).toHaveBeenCalledOnce();
    foreground = true; queue.wake(); await settle(); expect(prepare).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300_000); expect(prepare).toHaveBeenCalledTimes(3);
    expect(queue.getSnapshot().entries[0].retryAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000); expect(prepare).toHaveBeenCalledTimes(3);
    queue.retry('a'); await settle(); expect(prepare).toHaveBeenCalledTimes(4);
    queue.togglePause();
});
it('does not repeatedly probe absent, login-required or refused captions; sign-in wakes only the failed provider', async () => {
    vi.useFakeTimers();
    const statuses = ['none', 'login-required', 'refused'] as const;
    const prepare = vi.fn(async (item: SongResult): Promise<PreparationOutcome> => ({ status: 'unmatched', mediaSubtitleStatus: statuses[Number(item.id) - 1] }));
    const queue = createLyricPreparationQueue({ load: async () => null, save: async () => {}, prepare,
        canRun: () => true, wait: async () => {} });
    await queue.enqueue([song(1), song(2), song(3)], 'a'); await settle();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000); expect(prepare).toHaveBeenCalledTimes(3);
    queue.retrySubtitleLookups('another'); await settle(); expect(prepare).toHaveBeenCalledTimes(3);
    queue.retrySubtitleLookups('video'); await settle(); expect(prepare).toHaveBeenCalledTimes(5);
    expect(prepare.mock.calls.slice(3).map(call => call[0].id)).toEqual([2, 3]);
    expect(queue.getSnapshot().entries.every(entry => entry.retryAt === undefined)).toBe(true);
});
