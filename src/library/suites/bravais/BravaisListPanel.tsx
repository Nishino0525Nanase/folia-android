import React, { useEffect, useMemo } from 'react';
import { ChevronLeft, ListPlus, MoreHorizontal, Play } from 'lucide-react';
import { List, useListRef, type RowComponentProps } from 'react-window';
import { useTranslation } from 'react-i18next';
import { useBravaisPhoneLocate } from './useBravaisPhoneLocate';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import type { BravaisItem, BravaisLayer } from './bravaisLayer';
import { BravaisSeamStatusLine } from './BravaisSeamCollection';
import BravaisSeamFilterField from './BravaisSeamFilterField';
import { setBravaisLinkedKey, useBravaisUiStore } from './bravaisUiStore';
import BravaisSeamCrumbs from './BravaisSeamCrumbs';
import { TrackSortDirectionButton, TrackSortMenu } from '../../../components/shared/TrackSortMenu';

// src/library/suites/bravais/BravaisListPanel.tsx
// 列表面板（设计稿 §5「面板」「歌曲列表」）：缝加宽到 min(420, 视口 − 52)，标题横排压在顶部，下面是工具行（本地文件夹的
// 排序）、可滚动列表（react-window 虚拟化）和底部的播放 / 入队。列表顺序 = 层的条目顺序，过滤时只列匹配项。
// 列表 ↔ 墙双向联动：悬停一行，墙上这一项的所有可见副本高亮（is-linked）；单击一行，相机飞到离缝最近的那一份并聚焦它
// （歌曲直接展开聚焦卡）；双击播放；悬停墙上的磁贴，这一行高亮并滚到可见。面板是导航状态：返回（‹、Esc、浏览器后退）
// 先关它；面包屑多一级「列表」。

export const BRAVAIS_LIST_ROW_HEIGHT = 44;

export type BravaisPanelActions = {
    close: () => void;
    /** 定位到离缝最近的一份并聚焦（歌曲展开聚焦卡）。 */
    locate: (itemKey: string) => void;
    play: (itemKey: string) => void;
    fold: () => void;
    enqueue?: (itemKey: string) => void;
    more?: (itemKey: string) => void;
};

type RowProps = {
    touchMode: boolean;
    enqueueLabel: string;
    moreLabel: string;
    items: readonly BravaisItem[];
    highlightKey: string | null;
    nowPlayingKey: string | null;
    actions: BravaisPanelActions;
};

const ListRow = ({ index, style, items, highlightKey, nowPlayingKey, actions, touchMode, enqueueLabel, moreLabel }: RowComponentProps<RowProps>): React.ReactElement | null => {
    const item = items[index];
    if (!item) return null;
    const classes = [
        'bravais-list-row',
        item.key === highlightKey ? 'is-linked' : '',
        item.key === nowPlayingKey ? 'is-current' : '',
        item.unavailable ? 'is-unavailable' : '',
    ].filter(Boolean).join(' ');
    return (
        <div
            style={style}
            className={classes}
            role="option"
            aria-selected={item.key === highlightKey}
            data-bravais-list-row={item.key}
            tabIndex={touchMode ? 0 : undefined}
            aria-disabled={item.unavailable || undefined}
            onKeyDown={event => { if (touchMode && !item.unavailable && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); actions.play(item.key); } }}
            onMouseEnter={touchMode ? undefined : () => setBravaisLinkedKey(item.key)}
            onMouseLeave={touchMode ? undefined : () => setBravaisLinkedKey(null)}
            onClick={() => { if (touchMode) { if (!item.unavailable) actions.play(item.key); } else actions.locate(item.key); }}
            onDoubleClick={touchMode ? undefined : () => actions.play(item.key)}
        >
            <>{touchMode && item.coverUrl ? <img className="bravais-list-cover" src={getSizedCoverUrl(item.coverUrl, 128)} alt="" loading="lazy" decoding="async" /> : <span className="bravais-list-badge">{item.badge}</span>}</>
            <span className="bravais-list-text">
                <strong>{item.title}</strong>
                {item.subtitle && <small>{item.subtitle}</small>}
            </span>
            {touchMode && actions.enqueue ? <span className="bravais-list-row-actions"><button type="button" className="bravais-list-enqueue" aria-label={enqueueLabel} disabled={item.unavailable} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); actions.enqueue?.(item.key); }}><ListPlus aria-hidden /></button>{actions.more && <button type="button" className="bravais-list-enqueue" aria-label={moreLabel} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); actions.more?.(item.key); }}><MoreHorizontal aria-hidden /></button>}</span> : item.durationLabel && <span className="bravais-list-time">{item.durationLabel}</span>}
        </div>
    );
};

const BravaisListPanel: React.FC<{ layer: BravaisLayer; depth: number; actions: BravaisPanelActions; touchMode?: boolean }> = ({ layer, actions, touchMode = false }) => {
    const { t } = useTranslation();
    const listRef = useListRef(null);
    useBravaisPhoneLocate(layer, touchMode, listRef, actions.locate);
    const { seam, entries } = layer;
    const collection = seam.collection;
    const linkedKey = useBravaisUiStore(state => state.linkedKey);
    const wallHoverKey = useBravaisUiStore(state => state.wallHoverKey);
    const highlightKey = wallHoverKey ?? linkedKey;
    const items = layer.items;

    // 悬停墙上的磁贴：滚到对应的行（离散事件，不跟指针逐帧）。
    useEffect(() => {
        if (touchMode || !wallHoverKey) return;
        const index = items.findIndex(item => item.key === wallHoverKey);
        if (index >= 0) listRef.current?.scrollToRow({ index, align: 'smart', behavior: 'smooth' });
    }, [items, listRef, wallHoverKey, touchMode]);

    // 面板关掉时撤掉联动高亮。
    useEffect(() => () => {
        setBravaisLinkedKey(null);
        useBravaisUiStore.setState({ wallHoverKey: null });
    }, []);

    const rowProps = useMemo<RowProps>(() => ({
        touchMode,
        enqueueLabel: t('libraryBravais.addToQueue'),
        moreLabel: t('libraryBravaisCollection.more'),
        items,
        highlightKey,
        nowPlayingKey: layer.nowPlayingKey,
        actions,
    }), [actions, highlightKey, items, layer.nowPlayingKey, touchMode, t]);
    const sort = entries?.sort;

    return (
        <div className="bravais-seam-panel" data-bravais-list={layer.key}>
            <div className="bravais-seam-crumbs">
                <button type="button" className="bravais-seam-back" data-bravais-seam-action="close-list" onClick={actions.close}
                    aria-label={t('libraryBravais.seamBack')} title={t('libraryBravais.seamBack')}>
                    <ChevronLeft aria-hidden />
                </button>
                <BravaisSeamCrumbs layer={layer} panelLabel={entries?.listCrumb ?? ''} onClosePanel={actions.close} />
                <button type="button" className="bravais-seam-level" data-bravais-seam-action="hide" onClick={actions.fold}>
                    {touchMode ? collection?.moreLabel : t('libraryBravais.seamFold')}
                </button>
            </div>
            {layer.seam.filter && <BravaisSeamFilterField filter={layer.seam.filter} variant="panel" />}
            <h2 className="bravais-panel-title" data-bravais-seam-title>{seam.title}</h2>
            <div className="bravais-seam-meta">{seam.meta}</div>
            {sort && (
                <div className="bravais-panel-tools" data-bravais-list-sort>
                    {/* 与网格侧栏同一个控件：网页自己画菜单，不弹浏览器 / 系统那套 spinner 弹窗。 */}
                    <TrackSortMenu
                        variant="label"
                        presets={sort.presets}
                        field={sort.field}
                        direction={sort.direction}
                        onSelect={sort.selectPreset}
                    />
                    <TrackSortDirectionButton
                        className="bravais-seam-icon"
                        data-bravais-list-sort-direction={sort.direction}
                        direction={sort.direction}
                        disabled={sort.field === 'none'}
                        onDirectionChange={sort.toggleDirection}
                        aria-label={sort.directionLabel}
                        title={sort.directionLabel}
                    />
                </div>
            )}
            <div className="bravais-panel-list" role="listbox" aria-label={entries?.panelTitle}>
                {items.length > 0 ? (
                    <List
                        listRef={listRef}
                        rowCount={items.length}
                        rowHeight={touchMode ? 72 : BRAVAIS_LIST_ROW_HEIGHT}
                        rowComponent={ListRow}
                        rowProps={rowProps}
                        overscanCount={6}
                        className="custom-scrollbar"
                        style={{ height: '100%', width: '100%' }}
                    />
                ) : collection?.status && <BravaisSeamStatusLine status={collection.status} />}
            </div>
            <div className="bravais-seam-actions">
                {seam.onPlayScope && (
                    <button type="button" className="bravais-chrome-button is-primary" data-bravais-seam-action="play-scope" onClick={seam.onPlayScope}>
                        <Play aria-hidden />{seam.scopeLabels?.play ?? t('libraryBravais.playAll')}
                    </button>
                )}
                {seam.onEnqueueScope && (
                    <button type="button" className="bravais-chrome-button" data-bravais-seam-action="enqueue-scope" onClick={seam.onEnqueueScope}>
                        <ListPlus aria-hidden />{seam.scopeLabels?.enqueue ?? t('libraryBravais.enqueueAll')}
                    </button>
                )}
            </div>
        </div>
    );
};

export default BravaisListPanel;
