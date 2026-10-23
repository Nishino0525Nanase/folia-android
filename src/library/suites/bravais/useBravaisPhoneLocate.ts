import { useEffect, type RefObject } from 'react';
import type { ListImperativeAPI } from 'react-window';
import type { BravaisLayer } from './bravaisLayer';
import { usePlayingSongLocatorStore } from '../../../stores/usePlayingSongLocatorStore';
import { answerLocateRequest } from '../../../components/app/playing-song-locator/playingSongLocator';
import { resolveLocateStep } from '../../../components/app/playing-song-locator/resolveLocateStep';

// Use the common locator's wait/filter rules, scrolling to one virtual row instead of moving a camera.
export const useBravaisPhoneLocate = (layer: BravaisLayer, enabled: boolean, list: RefObject<ListImperativeAPI | null>, reveal: (key: string) => void) => {
    const request = usePlayingSongLocatorStore(state => state.request);
    useEffect(() => {
        const locate = layer.locate;
        if (!enabled || !layer.isInteractive || !request || !locate || request.collectionKey !== locate.pageKey) return;
        const index = layer.items.findIndex(item => item.playbackKey === request.songKey);
        const step = resolveLocateStep({ isHere: index >= 0, isFiltered: locate.isFiltered, waits: request.waits,
            cardsStillArriving: locate.cardsStillArriving, hasReadFailed: locate.hasReadFailed });
        if (step.kind === 'wait') return;
        if (step.kind === 'unfilter') { locate.clearFilter(); return; }
        if (index >= 0) {
            reveal(layer.items[index].key);
            list.current?.scrollToRow({ index, align: 'center', behavior: 'instant' });
        }
        answerLocateRequest(request.nonce, step.answer);
    }, [enabled, layer, list, request, reveal]);
};
