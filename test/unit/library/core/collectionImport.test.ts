import { describe, expect, it, vi } from 'vitest';
import { createCollectionImportRunner, toImportCollection, type CollectionImportTarget } from '@/library/core/collection/import/collectionImport';
import type { UnifiedSong } from '@/types';

// Collection import command and button share the same identity-aware asynchronous action.
const target = (id = '1', providerId = 'source-a'): CollectionImportTarget => ({
    key: `online:${providerId}:playlist:${id}`,
    collection: { id, providerId, type: 'playlist', name: 'Favorites' },
});
const deferred = () => {
    let resolve!: (songs: UnifiedSong[]) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<UnifiedSong[]>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const setup = () => {
    let current: CollectionImportTarget | null = target();
    const request = vi.fn(() => Promise.resolve([] as UnifiedSong[]));
    const pending = vi.fn();
    const completed = vi.fn();
    const failed = vi.fn();
    const runner = createCollectionImportRunner({ current: () => current, request, pending, completed, failed });
    return { runner, request, pending, completed, failed, move: (next: CollectionImportTarget | null) => { current = next; } };
};

describe('collection reference imports', () => {
    it('keeps provider metadata and rejects local or non-playlist collections', () => {
        const input = { source: 'online' as const, providerId: 'source-a', id: 9, name: 'My folder', type: 'playlist', providerData: { owner: 'me' }, raw: { unnormalized: true } };
        expect(toImportCollection(input)).toEqual({ providerId: 'source-a', id: 9, name: 'My folder', type: 'playlist', providerData: { owner: 'me' } });
        expect(toImportCollection({ ...input, type: 'album' })).toBeNull();
        expect(toImportCollection({ source: 'local', id: '9', name: 'Local', type: 'folder', songIds: [] })).toBeNull();
    });

    it('deduplicates a button and command invoked before the render can disable them', async () => {
        const s = setup();
        const work = deferred();
        s.request.mockReturnValue(work.promise);
        const first = s.runner.run();
        await s.runner.run();
        expect(s.request).toHaveBeenCalledTimes(1);
        work.resolve([{} as UnifiedSong, {} as UnifiedSong]);
        await first;
        expect(s.completed).toHaveBeenCalledWith(2);
        expect(s.pending.mock.calls).toEqual([[target().key, true], [target().key, false]]);
    });

    it('ignores a late completion and does not clear the next provider collection busy state', async () => {
        const s = setup();
        const first = deferred();
        const second = deferred();
        s.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const a = s.runner.run();
        s.move(target('1', 'source-b'));
        const b = s.runner.run();
        first.resolve([]);
        await a;
        expect(s.completed).not.toHaveBeenCalled();
        expect(s.pending.mock.calls).toEqual([
            [target().key, true], [target('1', 'source-b').key, true], [target().key, false],
        ]);
        second.resolve([{} as UnifiedSong]);
        await b;
        expect(s.completed).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('leaves failures visible for the same collection and permits an explicit retry', async () => {
        const s = setup();
        const error = new Error('platform request failed');
        s.request.mockRejectedValueOnce(error);
        await s.runner.run();
        expect(s.failed).toHaveBeenCalledWith(error, target().collection);
        expect(s.completed).not.toHaveBeenCalled();
        await s.runner.run();
        expect(s.request).toHaveBeenCalledTimes(2);
        expect(s.completed).toHaveBeenCalledWith(0);
    });

    it('suppresses disposed callbacks and remains usable after effect setup replays', async () => {
        const s = setup();
        const work = deferred();
        s.request.mockReturnValueOnce(work.promise);
        const pending = s.runner.run();
        s.runner.dispose();
        work.reject(new Error('late failure'));
        await pending;
        expect(s.failed).not.toHaveBeenCalled();
        await s.runner.run();
        expect(s.request).toHaveBeenCalledTimes(1);
        s.runner.activate();
        await s.runner.run();
        expect(s.request).toHaveBeenCalledTimes(2);
    });
});
