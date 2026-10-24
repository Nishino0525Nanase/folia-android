import { LyricPreparationProgress } from './LyricPreparationProgress';
import React from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CollectionImportAction } from '../../core/collection/import/useCollectionImport';

// A touch-sized action that saves media references rather than promising an audio download.
export const CollectionImportButton: React.FC<{ action: CollectionImportAction; className?: string }> = ({ action, className = '' }) => {
    const { t } = useTranslation();
    if (!action.supported) return null;
    return (
        <div><button type="button" disabled={!action.enabled} title={t('importSource.collectionImportHint')}
            aria-label={t('importSource.importCollection')}
            onClick={event => { event.stopPropagation(); void action.run(); }}
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full border border-current/15 px-3 text-xs disabled:opacity-45 ${className}`}>
            {action.pending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />}
            {t(action.pending ? 'importSource.importingCollection' : 'importSource.importCollection')}
        </button><LyricPreparationProgress model={action.lyrics} /></div>
    );
};
