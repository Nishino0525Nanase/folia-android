import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { OnlineLyricsState, ReplayGainMode, SongResult } from '../../types';
import { getOnlineLyricSourceLabel } from '../../utils/lyrics/lyricSourceLabels';
import { omni } from '../../services/onlineMusic/omni';
import { AudioAlignmentControl } from './audioAlignment/AudioAlignmentControl';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { AUTOMATIC_SUBTITLES_NAME } from '../../services/lyricPreparation/automaticAudioLyrics';
import SourceTab from './SourceTab';

// src/components/panelTab/OnlineLyricsTab.tsx
// The song's tab for a song of an online platform: hands SourceTab what it shows for it.

interface OnlineLyricsTabProps {
    song: SongResult;
    onlineLyricsState: OnlineLyricsState | null;
    onImportLyrics: (content: string, fileName: string) => void;
    onChangeLyricsSource: (source: 'online' | 'imported') => void;
    onMatchOnlineLyrics: () => void;
    onClearOnlineLyricsState: () => void;
    lyricTimelineOffsetMs: number;
    onLyricTimelineOffsetChange: (offsetMs: number) => void;
    replayGainMode: ReplayGainMode;
    onChangeReplayGainMode: (mode: ReplayGainMode) => void;
    isDaylight: boolean;
}

const OnlineLyricsTab: React.FC<OnlineLyricsTabProps> = ({
    song,
    onlineLyricsState,
    onImportLyrics,
    onChangeLyricsSource,
    onMatchOnlineLyrics,
    onClearOnlineLyricsState,
    lyricTimelineOffsetMs,
    onLyricTimelineOffsetChange,
    replayGainMode,
    onChangeReplayGainMode,
    isDaylight,
}) => {
    const { t } = useTranslation();

    const hasImportedLyrics = Boolean(onlineLyricsState?.importedLyrics);
    const hasOverride = Boolean(onlineLyricsState?.hasOnlineOverride || onlineLyricsState?.importedLyrics);
    const activeSource = onlineLyricsState?.lyricsSource === 'imported' && hasImportedLyrics ? 'imported' : 'online';

    const onlineSourceLabel = useMemo(() => {
        const providerId = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : undefined;
        return getOnlineLyricSourceLabel(song, onlineLyricsState, providerId ? omni.getProviderLabel(providerId) : '');
    }, [onlineLyricsState, song]);

    const availableSources = useMemo(
        () => (hasImportedLyrics
            ? [
                { key: 'online' as const, label: onlineSourceLabel },
                { key: 'imported' as const, label: t('localMusic.statusImported') },
            ]
            : [{ key: 'online' as const, label: onlineSourceLabel }]),
        [hasImportedLyrics, onlineSourceLabel, t],
    );

    return (
        <SourceTab
            key={song.id}
            lyricSources={availableSources}
            activeLyricSource={activeSource}
            onChangeLyricSource={onChangeLyricsSource}
            onClearLyrics={hasOverride ? onClearOnlineLyricsState : undefined}
            onMatchOnline={onMatchOnlineLyrics}
            onImportLyrics={onImportLyrics}
            gainValues={song.replayGain}
            replayGainMode={replayGainMode}
            onChangeReplayGainMode={onChangeReplayGainMode}
            lyricTimelineOffsetMs={lyricTimelineOffsetMs}
            onLyricTimelineOffsetChange={onLyricTimelineOffsetChange}
            isDaylight={isDaylight}
        >
            {activeSource === 'imported' && onlineLyricsState?.importedLyricsName === AUTOMATIC_SUBTITLES_NAME && <p className="mt-3 text-xs opacity-65">{t('lyricPreparation.automaticSubtitles')}</p>}
            <AudioAlignmentControl key={getPlaybackSongKey(song)} song={song} isDaylight={isDaylight} offset={lyricTimelineOffsetMs}
                onOffsetChange={onLyricTimelineOffsetChange} onSourceChange={onChangeLyricsSource} />
        </SourceTab>
    );
};

export default OnlineLyricsTab;
