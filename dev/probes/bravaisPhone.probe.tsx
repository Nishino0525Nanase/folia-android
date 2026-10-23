import React, { Suspense } from 'react';
import type { ProbeDefinition } from './definition';

// Touch interaction fixture, loaded separately so its suite CSS cannot leak into other probes.
const Phone = React.lazy(() => import('./bravais-perf/PhoneCollectionProbe'));
const definition: ProbeDefinition = {
    id: 'bravaisPhone', title: 'Bravais phone collection', description: 'Virtual rows, single-tap playback and collection actions',
    Component: () => <Suspense fallback={null}><Phone /></Suspense>,
};
export default definition;
