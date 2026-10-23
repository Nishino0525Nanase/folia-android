import React from 'react';
import { ListPlus, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisItem, BravaisLayer } from './bravaisLayer';

// The same projected item actions as the wall's focus card, with touch-sized targets.
export default function BravaisPhoneTrackActions({ layer, item }: { layer: BravaisLayer; item: BravaisItem }) {
    const { t } = useTranslation();
    return <div className="bravais-phone-track-actions">
        <h2>{item.title}</h2>
        {item.artists?.map((name, index) => <button key={`${index}:${name}`} type="button"
            disabled={!layer.canOpenArtist?.(item.key, index)} onClick={() => layer.onOpenArtist?.(item.key, index)}>{name}</button>)}
        {item.album && <button type="button" disabled={!layer.canOpenAlbum?.(item.key)} onClick={() => layer.onOpenAlbum?.(item.key)}>{item.album}</button>}
        <div className="bravais-seam-actions">
            <button type="button" className="bravais-chrome-button is-primary" disabled={item.unavailable} onClick={() => layer.onPlayItem?.(item.key)}><Play aria-hidden />{t('libraryBravais.playNow')}</button>
            <button type="button" className="bravais-chrome-button" disabled={item.unavailable} onClick={() => layer.onEnqueueItem?.(item.key)}><ListPlus aria-hidden />{t('libraryBravais.addToQueue')}</button>
        </div>
        {layer.entries?.menuFor?.(item.key).map(action => <button key={action.id} type="button" data-bravais-phone-item-action={action.id}
            className={action.danger ? 'is-danger' : undefined} onClick={() => layer.entries?.onMenuAction?.(item.key, action.id)}>{action.label}</button>)}
    </div>;
}
