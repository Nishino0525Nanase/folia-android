import React from 'react';
import type { LyricPreparationModel } from './useLyricPreparation';

// The same compact progress and controls are available in both collection layouts.
export const LyricPreparationProgress: React.FC<{ model?: LyricPreparationModel }> = ({ model }) => {
    if (!model) return null;
    return <div className="mt-2 min-w-0 text-xs leading-relaxed" data-lyric-preparation onClick={event => event.stopPropagation()}>
        <p>{model.label}</p>
        <progress className="h-1 w-full accent-current" value={model.done} max={model.total} aria-label={model.label} />
        <p className="opacity-65">{model.detail}</p>
        <div className="flex flex-wrap gap-2">
            {[model.toggle, model.retry].map(action => action && <button key={action.label} type="button"
                onClick={action.run} className="min-h-[44px] rounded-full border border-current/15 px-3">{action.label}</button>)}
        </div>
    </div>;
};
