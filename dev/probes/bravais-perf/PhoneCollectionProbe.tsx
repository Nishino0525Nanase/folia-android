import React, { useMemo, useState } from 'react';
import BravaisStageRouter from '../../../src/library/suites/bravais/BravaisStageRouter';
import { useBravaisLayerRegistration } from '../../../src/library/suites/bravais/useBravaisLayerRegistration';
import { DEFAULT_THEME } from '../../../src/services/baseThemes';
import { buildCollectionLayers } from './perfLayers';

// Exercise the actual stage router with thousands of tracks, without external media or account requests.
const noop = () => {};
export default function PhoneCollectionProbe() {
    const [played, setPlayed] = useState(0);
    const [enqueued, setEnqueued] = useState(0);
    const [back, setBack] = useState(0);
    const [action, setAction] = useState('');
    const layer = useMemo(() => {
        const base = buildCollectionLayers(5000, []).all;
        return { ...base, seam: { ...base.seam, title: '好听的歌', meta: '5000 首',
            onPlayScope: () => setPlayed(value => value + 1), onEnqueueScope: () => setEnqueued(value => value + 1),
            collection: { moreLabel: 'More', sync: { label: '120 / 141 · Resume', title: 'Incomplete collection', onResume: () => setAction('resume') },
                menu: [{ id: 'reload', label: 'Refresh', run: () => setAction('reload') }] } },
            onPlayItem: () => setPlayed(value => value + 1), onEnqueueItem: () => setEnqueued(value => value + 1),
            onDone: () => setBack(value => value + 1),
            entries: { hasPanel: true, panelTitle: 'Tracks', listCrumb: 'Tracks', hasQuery: false, hasForm: false,
                menuFor: () => [{ id: 'add-to-playlist', label: 'Add to playlist' }], onMenuAction: (_key: string, id: string) => setAction(id) } };
    }, []);
    useBravaisLayerRegistration('top', layer);
    return <div style={{ position: 'fixed', inset: 0, '--bg-color': '#f5f5f7', '--text-primary': '#19191d' } as React.CSSProperties}>
        <BravaisStageRouter isInteractive isDaylight theme={DEFAULT_THEME} navigation={{ depth: 1, origin: 'home', activeType: 'playlist' }} reportPlayerOcclusion={noop} reportPlayerBackdrop={noop} />
        <output hidden data-phone-stats data-played={played} data-enqueued={enqueued} data-back={back} data-action={action} />
    </div>;
}
