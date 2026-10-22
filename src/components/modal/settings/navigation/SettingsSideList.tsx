import React, { useRef } from 'react';
import { CircleHelp, Search, X, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDragToScroll } from '../../../../hooks/useDragToScroll';
import type { SettingsNavGroup, SettingsSectionId } from './settingsNavModel';
// src/components/modal/settings/navigation/SettingsSideList.tsx
// The settings' side list: a search field, then the categories under their group names, and Help at
// the foot. It lists categories only; what a page holds is in that page's header. Under 768px the
// same list is a search field over one strip of category names that scrolls sideways.

type SettingsSideListProps = {
    groups: SettingsNavGroup[];
    /** The category on screen, 'help', or null while search results are shown. */
    activeId: SettingsSectionId | 'help' | null;
    onSelectSection: (sectionId: SettingsSectionId) => void;
    onSelectHelp: () => void;
    query: string;
    onQueryChange: (query: string) => void;
    /** Enter in the search field. */
    onSubmitQuery: () => void;
    isWide: boolean;
};

export const SettingsSideList: React.FC<SettingsSideListProps> = ({
    groups,
    activeId,
    onSelectSection,
    onSelectHelp,
    query,
    onQueryChange,
    onSubmitQuery,
    isWide,
}) => {
    const { t } = useTranslation();
    const stripRef = useRef<HTMLDivElement>(null);
    // The strip scrolls sideways under a dragging mouse; the wide list has nothing to drag.
    const { isDragging, hasDragged, handlers } = useDragToScroll(stripRef);

    const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            onSubmitQuery();
            return;
        }
        // The first Escape clears the query; only an empty box lets it through to close the dialog.
        if (event.key === 'Escape' && query) {
            event.preventDefault();
            event.stopPropagation();
            onQueryChange('');
        }
    };

    const renderItem = (id: SettingsSectionId | 'help', Icon: LucideIcon, label: string, onSelect: () => void) => {
        const isActive = activeId === id;
        return (
            <button
                key={id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                    if (!isWide && hasDragged()) return;
                    onSelect();
                }}
                className={`flex h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-left text-[13px] transition-colors md:h-8 md:w-full md:px-2.5 ${isActive ? 'bg-[var(--st-fill2)] text-[color:var(--st-t1)]' : 'text-[color:var(--st-t2)] hover:bg-[var(--st-fill)]'}`}
            >
                <Icon size={16} className={`hidden shrink-0 md:block ${isActive ? '' : 'opacity-70'}`} />
                <span className="truncate">{label}</span>
            </button>
        );
    };

    return (
        <aside className="flex min-h-0 shrink-0 flex-col border-b border-[var(--st-line)] bg-[var(--st-side)] px-3 pb-2 pt-3 md:border-b-0 md:border-r md:px-2.5 md:pb-2.5 md:pt-3.5">
            <label className="flex h-11 shrink-0 items-center gap-2 rounded-lg border border-transparent bg-[var(--st-fill)] px-2.5 text-[color:var(--st-t3)] transition-colors focus-within:border-[var(--st-line2)] md:h-8">
                <Search size={14} className="shrink-0" />
                <input
                    type="search"
                    value={query}
                    onChange={event => onQueryChange(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder={t('options.settingsSearchPlaceholder')}
                    aria-label={t('options.settingsSearchPlaceholder')}
                    className="min-w-0 flex-1 bg-transparent text-base text-[color:var(--st-t1)] outline-none placeholder:text-[color:var(--st-t3)] md:text-[13px] [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => onQueryChange('')}
                        aria-label={t('options.settingsSearchClear')}
                        className="-mr-2 grid h-11 w-11 shrink-0 place-items-center transition-colors hover:text-[color:var(--st-t1)] md:mr-0 md:h-auto md:w-auto"
                    >
                        <X size={14} />
                    </button>
                )}
            </label>
            <nav
                ref={stripRef}
                {...(isWide ? {} : handlers)}
                className={`mt-2 flex min-h-0 touch-pan-x gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] md:mt-1 md:flex-1 md:touch-pan-y md:flex-col md:gap-0 md:overflow-y-auto md:overflow-x-hidden ${isDragging ? 'cursor-grabbing select-none' : ''}`}
            >
                {groups.map(group => (
                    <div key={group.id} className="contents md:flex md:flex-col md:gap-px">
                        <div className="hidden px-2.5 pb-1 pt-3.5 text-xs leading-[18px] text-[color:var(--st-t3)] md:block">
                            {group.label}
                        </div>
                        {group.items.map(section => renderItem(section.id, section.icon, section.label, () => onSelectSection(section.id)))}
                    </div>
                ))}
                <div className="contents md:mt-auto md:block md:pt-3">
                    {renderItem('help', CircleHelp, t('help.title'), onSelectHelp)}
                </div>
            </nav>
        </aside>
    );
};

export default SettingsSideList;
