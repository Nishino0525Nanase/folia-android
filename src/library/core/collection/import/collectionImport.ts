import type { ProviderCollection } from '../../../../types/onlineMusic';
import type { UnifiedSong } from '../../../../types';
import type { LibraryCollectionDescriptor } from '../collection.contract';

// Local reference imports keep collection ownership and source metadata behind the Omni contract.
export const toImportCollection = (collection: LibraryCollectionDescriptor | null | undefined): ProviderCollection | null => {
    if (collection?.source !== 'online' || collection.type !== 'playlist') return null;
    const { source: _source, raw: _raw, ...normalized } = collection;
    return normalized;
};

export type CollectionImportTarget = { key: string; collection: ProviderCollection };

type CollectionImportRunnerDeps = {
    current: () => CollectionImportTarget | null;
    request: (collection: ProviderCollection) => Promise<UnifiedSong[]>;
    pending: (key: string, active: boolean) => void;
    completed: (count: number) => void;
    failed: (error: unknown, collection: ProviderCollection) => void;
};

// One action per collection at a time; a late completion never speaks for a different page.
export const createCollectionImportRunner = (deps: CollectionImportRunnerDeps) => {
    const pending = new Set<string>();
    let disposed = false;
    return {
        async run(): Promise<void> {
            const target = deps.current();
            if (disposed || !target || pending.has(target.key)) return;
            pending.add(target.key);
            deps.pending(target.key, true);
            try {
                const songs = await deps.request(target.collection);
                if (!disposed && deps.current()?.key === target.key) deps.completed(songs.length);
            } catch (error) {
                if (!disposed && deps.current()?.key === target.key) deps.failed(error, target.collection);
            } finally {
                pending.delete(target.key);
                if (!disposed) deps.pending(target.key, false);
            }
        },
        activate() { disposed = false; },
        dispose() { disposed = true; },
    };
};
