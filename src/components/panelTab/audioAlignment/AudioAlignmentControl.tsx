import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioLines, RotateCcw, Square } from 'lucide-react';
import type { SongResult } from '../../../types';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { CustomSelect } from '../../shared/CustomSelect';
import { PanelButton } from '../shell/PanelButton';
import { audioAlignment } from '../../../services/lyricAlignment/alignmentService';
import { applyAudioAlignment, canApplyAlignment, hasAlignmentBackup, restoreAudioAlignment } from '../../../services/lyricAlignment/alignmentPersistence';
import type { AlignmentLanguage } from '../../../services/lyricAlignment/protocol';

// Recognition is explicit because it downloads a model and reads full audio; results remain reviewable before application.
export const AudioAlignmentControl: React.FC<{
    song: SongResult; isDaylight: boolean; offset: number;
    onOffsetChange: (offset: number) => void; onSourceChange: (source: 'online' | 'imported') => void;
}> = ({ song, isDaylight, offset, onOffsetChange, onSourceChange }) => {
    const { t } = useTranslation();
    const lyrics = usePlaybackStore(state => state.lyrics);
    const job = useSyncExternalStore(audioAlignment.subscribe, audioAlignment.getSnapshot);
    const [language, setLanguage] = useState<AlignmentLanguage>(() => /[ぁ-ヿ]/u.test(lyrics?.lines.map(line => line.fullText).join('') ?? '') ? 'japanese' : 'auto');
    const [backup, setBackup] = useState(false);
    const [message, setMessage] = useState('');
    const [saving, setSaving] = useState(false);
    const mounted = useRef(true);
    const key = getPlaybackSongKey(song);
    const isCurrent = () => {
        const playing = usePlaybackStore.getState().currentSong;
        return mounted.current && Boolean(playing && getPlaybackSongKey(playing) === key);
    };
    useEffect(() => {
        mounted.current = true;
        void hasAlignmentBackup(song).then(value => { if (mounted.current) setBackup(value); });
        return () => { mounted.current = false; };
    }, [key]);
    const own = job?.key === key ? job : null;
    const running = job?.status === 'running';
    const result = own?.status === 'ready' ? own.result : undefined;
    const apply = async () => {
        if (!own || saving) return;
        setSaving(true);
        try {
            if (!await applyAudioAlignment(own, t('audioAlignment.filename'), isCurrent)) { setMessage(t('audioAlignment.changed')); return; }
            if (!isCurrent()) return;
            await onSourceChange('imported');
            if (isCurrent()) { onOffsetChange(0); setBackup(true); setMessage(t('audioAlignment.applied')); }
        } catch (error) { console.warn('[AudioAlignment] Could not save alignment', error); setMessage(t('audioAlignment.failed')); }
        finally { if (mounted.current) setSaving(false); }
    };
    const restore = async () => {
        setSaving(true);
        try {
            const restored = await restoreAudioAlignment(song, isCurrent);
            if (!restored) { setMessage(t('audioAlignment.changed')); return; }
            if (!isCurrent()) return;
            await onSourceChange(restored.source);
            if (isCurrent()) { onOffsetChange(restored.offset); setMessage(t('audioAlignment.restored')); setBackup(false); }
        } catch (error) { console.warn('[AudioAlignment] Could not restore lyrics', error); setMessage(t('audioAlignment.failed')); }
        finally { if (mounted.current) setSaving(false); }
    };
    return <section className="my-3 rounded-xl border border-current/10 p-3 text-xs leading-relaxed [&_button]:min-h-11" data-audio-alignment>
        <p className="mb-1 text-sm">{t('audioAlignment.title')}</p>
        <p className="mb-3 opacity-65">{t(import.meta.env.FOLIA_ALIGNMENT_BUNDLED ? 'audioAlignment.descriptionBundled' : 'audioAlignment.description')}</p>
        <CustomSelect value={language} onChange={value => setLanguage(value as AlignmentLanguage)} disabled={running}
            isDaylight={isDaylight} size="compact" ariaLabel={t('audioAlignment.language')}
            options={(['auto', 'japanese', 'chinese', 'english', 'korean'] as const).map(value => ({ value, label: t(`audioAlignment.${value}`) }))} />
        <div className="mt-3 flex flex-wrap gap-2">
            <PanelButton icon={AudioLines} disabled={running || saving} onClick={() => {
                setMessage(''); void audioAlignment.start(song, lyrics, usePlaybackStore.getState().audioSrc, language, offset);
            }}>{t(lyrics?.lines.length ? 'audioAlignment.start' : 'audioAlignment.transcribe')}</PanelButton>
            {!!lyrics?.lines.length && <PanelButton disabled={running || saving} onClick={() => {
                setMessage(''); void audioAlignment.start(song, lyrics, usePlaybackStore.getState().audioSrc, language, offset, 'transcribe');
            }}>{t('audioAlignment.transcribe')}</PanelButton>}
            {running && <PanelButton icon={Square} onClick={audioAlignment.cancel}>{t('audioAlignment.cancel')}</PanelButton>}
            {backup && <PanelButton icon={RotateCcw} disabled={running || saving} onClick={() => void restore()}>{t('audioAlignment.restore')}</PanelButton>}
        </div>
        {running && <p className="mt-2" role="status">{own ? t(`audioAlignment.${own.progress.phase}`) : t('audioAlignment.otherSong')}
            {own?.progress.progress !== undefined ? ` ${Math.round(own.progress.progress)}%` : ''}</p>}
        {own?.status === 'cancelled' && <p className="mt-2">{t('audioAlignment.cancelled')}</p>}
        {own?.status === 'error' && <p className="mt-2" role="alert">{t('audioAlignment.failed')}</p>}
        {result && <div className="mt-3">
            <p>{result.kind === 'aligned' ? t('audioAlignment.result', { count: result.matchedLines, total: result.totalLines }) : t('audioAlignment.machineResult')}</p>
            {own && !canApplyAlignment(own) && <p className="opacity-65">{t('audioAlignment.lowConfidence')}</p>}
            <div className="my-2 max-h-40 overflow-y-auto opacity-80">
                {result.lyrics.lines.slice(0, 12).map((line, index) => <p key={index}>{Math.floor(line.startTime / 60)}:{String(Math.floor(line.startTime % 60)).padStart(2, '0')} {line.fullText}</p>)}
            </div>
            <PanelButton disabled={!own || !canApplyAlignment(own) || saving} onClick={() => void apply()}>{t('audioAlignment.apply')}</PanelButton>
        </div>}
        {message && <p className="mt-2" role="status">{message}</p>}
    </section>;
};
