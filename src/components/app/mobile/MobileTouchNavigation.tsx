import React, { useEffect, useMemo } from 'react';
import { Library, Search, AudioLines, ListMusic, Ellipsis, Settings, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppViewStore, openCommandPalette } from '../../../stores/useAppViewStore';
import { useAppChromeStore } from '../../../stores/useAppChromeStore';
import { useSearchNavigationStore, type SearchSource } from '../../../stores/useSearchNavigationStore';
import { useSettingsModalStore } from '../../../stores/useSettingsModalStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import Sheet from '../../shared/Sheet';
import { createMobileNavigationActions } from './mobileNavigationActions';
import { useMobileTouchLayout } from '../../../hooks/useMobileTouchLayout';
import { closeMobileNavigation, useMobileNavigationStore } from './mobileNavigationStore';
import './MobileTouchNavigation.css';

// On-demand actions in Folia's own sheet, with no permanent navigation strip or canvas reservation.
type MobileTouchNavigationProps = {
    onHome: () => void;
    onPlayer: () => void;
    onSearch: (request: { query: string; sourceTab: SearchSource; returnView: 'home' | 'player' }) => void;
};

const MobileTouchNavigation: React.FC<MobileTouchNavigationProps> = ({ onHome, onPlayer, onSearch }) => {
    const { t } = useTranslation();
    const isMobileTouch = useMobileTouchLayout();
    const view = useAppViewStore(state => state.view);
    const isPanelOpen = useAppViewStore(state => state.isPanelOpen);
    const panelTab = useAppViewStore(state => state.panelTab);
    const isSearchOpen = useSearchNavigationStore(state => state.isSearchOpen);
    const isOpen = useMobileNavigationStore(state => state.isOpen);
    const hasOnlineSong = usePlaybackStore(state => Boolean(state.currentSong
        && getPlaybackSourceRef(state.currentSong).kind === 'online'));
    useEffect(() => {
        if (!isMobileTouch) closeMobileNavigation();
    }, [isMobileTouch]);
    const actions = useMemo(() => createMobileNavigationActions({
        navigateHome: onHome,
        navigatePlayer: onPlayer,
        navigateSearch: onSearch,
        readSearch: () => {
            const state = useSearchNavigationStore.getState();
            return {
                query: state.searchQuery,
                sourceTab: state.searchSourceTab,
                returnView: useAppViewStore.getState().view === 'player' ? 'player' : 'home',
            };
        },
        hideSearch: () => useSearchNavigationStore.getState().hideSearchOverlay(),
        closePanel: () => useAppViewStore.getState().setIsPanelOpen(false),
        openQueue: () => {
            useAppViewStore.getState().setPanelTab('queue');
            useAppViewStore.getState().setIsPanelOpen(true);
        },
        openManualLyrics: () => {
            const song = usePlaybackStore.getState().currentSong;
            if (!song || getPlaybackSourceRef(song).kind !== 'online') return;
            useAppViewStore.getState().setPanelTab('onlineLyrics');
            useAppViewStore.getState().setIsPanelOpen(true);
        },
        revealPlayer: () => useAppChromeStore.getState().setIsPlayerChromeHidden(false),
        openSettings: () => useSettingsModalStore.getState().openSettings('options'),
        openCommands: openCommandPalette,
    }), [onHome, onPlayer, onSearch]);

    if (!isMobileTouch) return null;

    const items = [
        { id: 'library', icon: Library, active: view === 'home' && !isSearchOpen },
        { id: 'search', icon: Search, active: isSearchOpen },
        { id: 'lyrics', icon: AudioLines, active: view === 'player' && !(isPanelOpen && (panelTab === 'queue' || panelTab === 'onlineLyrics')) },
        { id: 'queue', icon: ListMusic, active: view === 'player' && isPanelOpen && panelTab === 'queue' },
        ...(hasOnlineSong ? [{ id: 'manualLyrics' as const, icon: FileText, active: view === 'player' && isPanelOpen && panelTab === 'onlineLyrics' }] : []),
        { id: 'more', icon: Ellipsis, active: false },
        { id: 'settings', icon: Settings, active: false },
    ] as const;

    return (
        <Sheet
            isOpen={isOpen}
            onClose={closeMobileNavigation}
            title={t('mobileTouch.more')}
            size="s"
        >
            <nav className="folia-touch-menu" aria-label={t('mobileTouch.navigation')}>
            {items.map(({ id, icon: Icon, active }) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => {
                        closeMobileNavigation();
                        actions[id]();
                    }}
                    aria-current={active ? 'page' : undefined}
                    className="folia-touch-menu-button"
                    aria-label={id === 'more' ? t('commandPalette.destination') : t(`mobileTouch.${id}`)}
                >
                    <Icon size={21} strokeWidth={active ? 2.3 : 1.8} aria-hidden />
                    <span>{id === 'more' ? t('commandPalette.destination') : t(`mobileTouch.${id}`)}</span>
                </button>
            ))}
            </nav>
        </Sheet>
    );
};

export default React.memo(MobileTouchNavigation);
