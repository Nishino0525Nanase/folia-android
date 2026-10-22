import React, { useState } from 'react';
import { FolderOpen, LayoutGrid, Plug, Search, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer } from './bravaisLayer';
import { switchLibrarySuite } from '../../app/switchLibrarySuite';
import './BravaisHomeEmptyState.css';

// A phone's empty wall explains its real sources while leaving the original populated wall intact.
const BravaisHomeEmptyState: React.FC<{ layer: BravaisLayer }> = ({ layer }) => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const home = layer.seam.home;
    const account = home?.account;
    if (!home) return null;
    const isLocal = layer.key === 'home:local';
    const settings = home.tools.find(tool => tool.id === 'settings');
    const local = layer.seam.tabs?.find(tab => tab.key === 'local' && !tab.disabled);
    const guest = Boolean(account && (account.accountView === 'guest' || (!account.accountView && account.guest)));
    const imports = isLocal ? home.menu?.filter(item => !item.disabled
        && ['home-import-folder', 'home-import-playlist', 'home-scan-device-music'].includes(item.id)) ?? [] : [];
    return (
        <section className="bravais-home-welcome" data-bravais-home-welcome-content aria-label={t('libraryBravais.homeTitle')}>
            <header className="bravais-home-welcome-header">
                <span className="bravais-home-welcome-brand">Folia</span>
                {settings && <button type="button" className="bravais-home-welcome-settings" onClick={settings.run}
                    aria-label={settings.label} title={settings.label} disabled={settings.disabled}>
                    <Settings size={20} aria-hidden />
                </button>}
            </header>
            <nav className="bravais-home-welcome-tabs" aria-label={t('libraryBravais.homeTitle')}>
                {layer.seam.tabs?.map(tab => <button key={tab.key} type="button" disabled={tab.disabled}
                    aria-current={tab.active ? 'page' : undefined} onClick={() => layer.seam.onSelectTab?.(tab.key)}>
                    {tab.label}
                </button>)}
            </nav>
            <div className="bravais-home-welcome-scroll">
                <div className="bravais-home-welcome-body">
                    <span className="bravais-home-welcome-eyebrow">{account?.providerLabel ?? layer.seam.meta}</span>
                    <h1>{isLocal ? t('mobileHome.localEmptyTitle') : guest && layer.seam.status ? layer.seam.status : t('home.guestTitle')}</h1>
                    <p>{isLocal ? t('mobileHome.localEmptyHint') : guest ? t('home.guestPrompt') : t('mobileHome.accountlessHint')}</p>
                    {!isLocal && <form className="bravais-home-welcome-search" onPointerDown={event => event.stopPropagation()}
                        onKeyDown={event => event.stopPropagation()} onSubmit={event => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (query.trim()) home.search.onSubmit(query.trim());
                        }}>
                        <label className="sr-only" htmlFor="bravais-home-welcome-query">{home.search.title}</label>
                        <input id="bravais-home-welcome-query" type="search" enterKeyHint="search" value={query}
                            placeholder={home.search.placeholder} onChange={event => setQuery(event.target.value)} />
                        <button type="submit" disabled={!query.trim()} aria-label={home.search.submitLabel}>
                            <Search size={20} aria-hidden />
                        </button>
                    </form>}
                    <div className="bravais-home-welcome-actions">
                        {imports.map((item, index) => <button key={item.id} type="button" className={index === 0 ? 'is-primary' : undefined} onClick={item.run}>
                            <FolderOpen size={19} aria-hidden />{item.label}
                        </button>)}
                        {guest && account && <button type="button" onClick={event => account.onOpen(event.currentTarget)}>
                            <Plug size={19} aria-hidden />{account.connectLabel}
                        </button>}
                        {!isLocal && local && <button type="button" onClick={() => layer.seam.onSelectTab?.(local.key)}>
                            <FolderOpen size={19} aria-hidden />{t('mobileHome.localAction')}
                        </button>}
                    </div>
                    <button type="button" className="bravais-home-welcome-grid" onClick={() => switchLibrarySuite('home', 'grid')}>
                        <LayoutGrid size={17} aria-hidden />{t('mobileHome.gridAction')}
                    </button>
                </div>
            </div>
        </section>
    );
};

export default BravaisHomeEmptyState;
