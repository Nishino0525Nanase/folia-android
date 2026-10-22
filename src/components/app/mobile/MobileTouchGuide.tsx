import React from 'react';
import { AudioLines, Ellipsis, Navigation, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Touch instructions follow the original page controls and the on-demand player menu.
const GUIDE_ITEMS = [
    { id: 'navigation', icon: Navigation },
    { id: 'playback', icon: AudioLines },
    { id: 'search', icon: Search },
    { id: 'more', icon: Ellipsis },
] as const;

export const MobileTouchGuide: React.FC = () => {
    const { t } = useTranslation();
    return (
        <div className="mt-5 space-y-4 text-left">
            {GUIDE_ITEMS.map(({ id, icon: Icon }) => (
                <div key={id} className="flex gap-3">
                    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-current/5">
                        <Icon size={18} aria-hidden />
                    </span>
                    <div className="min-w-0">
                        <div className="text-sm font-medium">{t(`help.mobileGuide.${id}`)}</div>
                        <p className="mt-0.5 text-xs leading-5 opacity-60">{t(`help.mobileGuide.${id}Hint`)}</p>
                    </div>
                </div>
            ))}
        </div>
    );
};
