import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import type { SongResult } from '../../../types';
import { hasAlignmentBackup, restoreAudioAlignment } from '../../../services/lyricAlignment/alignmentPersistence';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { PanelButton } from '../shell/PanelButton';

// Keep access to old lyric backups on phones without loading the removed recognition controls or model.
export const RestoreAlignedLyricsControl: React.FC<{
    song: SongResult; onOffsetChange: (offset: number) => void; onSourceChange: (source: 'online' | 'imported') => void;
}> = ({ song, onOffsetChange, onSourceChange }) => {
    const { t } = useTranslation();
    const [backup, setBackup] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState('');
    const active = useRef(true);
    useEffect(() => {
        active.current = true;
        void hasAlignmentBackup(song).then(value => { if (active.current) setBackup(value); })
            .catch(error => console.warn('[AudioAlignment] Could not read lyric backup', error));
        return () => { active.current = false; };
    }, [song]);
    const current = () => {
        const playing = usePlaybackStore.getState().currentSong;
        return active.current && Boolean(playing && getPlaybackSongKey(playing) === getPlaybackSongKey(song));
    };
    const restore = async () => {
        setSaving(true);
        try {
            const restored = await restoreAudioAlignment(song, current);
            if (!current()) return;
            if (!restored) { setMessage(t('audioAlignment.changed')); return; }
            await onSourceChange(restored.source);
            if (current()) { onOffsetChange(restored.offset); setBackup(false); setMessage(t('audioAlignment.restored')); }
        } catch (error) {
            console.warn('[AudioAlignment] Could not restore lyrics', error);
            if (active.current) setMessage(t('audioAlignment.failed'));
        } finally { if (active.current) setSaving(false); }
    };
    return backup || message ? <div className="mt-3 text-xs">
        {backup && <PanelButton icon={RotateCcw} disabled={saving} onClick={() => void restore()}>{t('audioAlignment.restore')}</PanelButton>}
        {message && <p role="status">{message}</p>}
    </div> : null;
};
