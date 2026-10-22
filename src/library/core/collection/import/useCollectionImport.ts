import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { omni } from '../../../../services/onlineMusic/omni';
import { onlineFailureOf } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { onlineFailureMessage } from '../../../../services/onlineMusic/failure/onlineFailureTexts';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';
import type { LibraryCollectionDescriptor } from '../collection.contract';
import { collectionKey } from '../collectionIdentity';
import { createCollectionImportRunner, toImportCollection, type CollectionImportTarget } from './collectionImport';

// The button and its command use one import action and the same synchronous duplicate-submit guard.
export const useCollectionImport = (descriptor: LibraryCollectionDescriptor | null | undefined, enabled = true) => {
    const { t } = useTranslation();
    const collection = toImportCollection(descriptor);
    const supported = Boolean(collection && omni.canImportCollection(collection));
    const key = descriptor ? collectionKey(descriptor) : '';
    const latest = useRef({ target: null as CollectionImportTarget | null, t });
    latest.current = { target: supported && enabled && collection ? { key, collection } : null, t };
    const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
    const runner = useMemo(() => createCollectionImportRunner({
        current: () => latest.current.target,
        request: target => omni.importCollectionSongs(target),
        pending: (targetKey, active) => setPendingKeys(current => {
            const next = new Set(current);
            if (active) next.add(targetKey); else next.delete(targetKey);
            return next;
        }),
        completed: count => setStatusMessage({ type: 'success', text: latest.current.t('importSource.collectionImported', { count }) }),
        failed: (error, target) => {
            const failure = onlineFailureOf({ operation: 'collection', providerId: target.providerId }, { error });
            const message = onlineFailureMessage(failure, latest.current.t);
            setStatusMessage({ type: 'error', text: message?.title || latest.current.t('importSource.collectionImportFailed') });
        },
    }), []);
    useEffect(() => { runner.activate(); return () => runner.dispose(); }, [runner]);
    const pending = pendingKeys.has(key);
    return { supported, pending, run: runner.run, enabled: supported && enabled && !pending };
};

export type CollectionImportAction = ReturnType<typeof useCollectionImport>;
