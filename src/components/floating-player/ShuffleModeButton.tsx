import React from 'react';
import { Shuffle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import type { StageLoopMode } from '../../types';

/** A persistent playback mode, separate from the queue's one-time reshuffle action. */
const ShuffleModeButton: React.FC<{
    loopMode: StageLoopMode;
    disabled?: boolean;
    showLabel?: boolean;
    className?: string;
}> = ({ loopMode, disabled, showLabel = false, className = '' }) => {
    const { t } = useTranslation();
    const active = loopMode === 'shuffle';
    const label = t('player.loopShuffle');
    return (
        <button
            type="button"
            data-folia-shuffle-mode
            aria-label={label}
            aria-pressed={active}
            title={label}
            disabled={disabled}
            className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl transition-colors disabled:opacity-35 ${showLabel ? 'flex-col gap-0.5 px-2 py-1' : 'h-11 w-11'} ${active ? 'bg-(--text-primary) text-(--bg-color)' : 'opacity-70 hover:opacity-100 active:bg-white/10'} ${className}`}
            onClick={event => {
                event.stopPropagation();
                useAudioSettingsStore.getState().handleSetLoopMode(active ? 'off' : 'shuffle');
            }}
        >
            <Shuffle size={19} aria-hidden />
            {showLabel && <span className="text-[10px] leading-tight">{label}</span>}
        </button>
    );
};

export default ShuffleModeButton;
