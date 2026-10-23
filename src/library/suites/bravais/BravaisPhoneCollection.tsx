import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWallHandoffStore } from '../../../stores/useWallHandoffStore';
import BravaisPhoneTrackActions from './BravaisPhoneTrackActions';
import type { LibrarySuiteStageProps } from '../../core/suite/suite.contract';
import { useBravaisStageStore } from './bravaisStageStore';
import BravaisListPanel from './BravaisListPanel';
import BravaisSeamContent from './BravaisSeamContent';
import './bravais.css';
import './bravaisCollection.css';
import './bravaisPhoneCollection.css';

// Keep the collection's existing actions, filters and forms; only its touch presentation changes.
export default function BravaisPhoneCollection({ navigation, isInteractive, isDaylight, reportPlayerOcclusion }: LibrarySuiteStageProps) {
    const { t } = useTranslation();
    const returningFromWall = useWallHandoffStore(state => state.session?.direction === 'from-lattice');
    // This surface has no wall tiles to acknowledge a flip handoff; use the normal view transition.
    useEffect(() => { if (returningFromWall) useWallHandoffStore.getState().abort(); }, [returningFromWall]);
    const [itemKey, setItemKey] = useState<string | null>(null);
    const layer = useBravaisStageStore(state => state.top?.layer ?? null);
    const [details, setDetails] = useState(false);
    useEffect(() => { setDetails(false); setItemKey(null); }, [layer?.key]);
    useEffect(() => {
        reportPlayerOcclusion(true);
        return () => reportPlayerOcclusion(false);
    }, [reportPlayerOcclusion]);
    const actions = useMemo(() => ({
        close: () => layer?.onDone?.(),
        locate: (key: string) => { setDetails(false); setItemKey(null); layer?.onFocusEntry?.(key); },
        play: (key: string) => layer?.onPlayItem?.(key),
        enqueue: (key: string) => layer?.onEnqueueItem?.(key),
        fold: () => setDetails(true),
        more: (key: string) => setItemKey(key),
    }), [layer]);
    const item = layer?.items.find(entry => entry.key === itemKey);
    const form = layer?.seam.collection?.form;
    const overlay = Boolean(details || item || form);
    const closeOverlay = () => { if (form) layer?.entries?.cancelForm?.(); setDetails(false); setItemKey(null); };
    return <section className={`bravais-root bravais-phone-collection${isDaylight ? ' is-daylight' : ''}`}
        data-bravais-phone-collection inert={!isInteractive}>
        {layer && <>
            <div className="bravais-phone-list" inert={overlay} style={{ visibility: overlay ? 'hidden' : 'visible' }}>
                <BravaisListPanel layer={layer} depth={navigation.depth} actions={actions} touchMode />
            </div>
            {overlay && <div className="bravais-phone-details">
                <button type="button" className="bravais-chrome-button" data-bravais-phone-back onClick={closeOverlay}><ChevronLeft aria-hidden />{t('libraryBravais.seamBack')}</button>
                {item && !form ? <BravaisPhoneTrackActions layer={layer} item={item} /> :
                    <BravaisSeamContent variant={form ? 'form' : 'full'} layer={{ ...layer, onDone: undefined, seam: { ...layer.seam, filter: undefined } }}
                        depth={navigation.depth} actions={{ setLevel: closeOverlay, openList: closeOverlay, panel: actions }} />}
            </div>}
        </>}
    </section>;
}
