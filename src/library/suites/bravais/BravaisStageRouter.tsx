import React, { Suspense } from 'react';
import type { LibrarySuiteStageProps } from '../../core/suite/suite.contract';
import { useMediaQuery } from '../../../hooks/useMediaQuery';

// Touch collections use a virtual list without mounting the wall's camera, slots or animation loops.
const Wall = React.lazy(() => import('./BravaisStage'));
const PhoneCollection = React.lazy(() => import('./BravaisPhoneCollection'));

export default function BravaisStageRouter(props: LibrarySuiteStageProps) {
    const phone = useMediaQuery('(max-width: 767px) and (pointer: coarse)');
    const collection = phone && props.navigation.depth > 0 && props.navigation.activeType !== 'artist';
    return <Suspense fallback={null}>{collection ? <PhoneCollection {...props} /> : <Wall {...props} />}</Suspense>;
}
