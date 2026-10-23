import React, { useEffect, useState } from 'react';
import type { UnifiedSong } from '../../src/types';
import type { OnlineMusicProvider } from '../../src/types/onlineMusic';
import { registerOnlineMusicProvider } from '../../src/services/onlineMusic/providerRegistry';
import { omni } from '../../src/services/onlineMusic/omni';
import { setLyricsState, usePlaybackStore } from '../../src/stores/usePlaybackStore';
import { useLyricSettingsStore } from '../../src/stores/useLyricSettingsStore';
import { usePreparedLyricsPlayback } from '../../src/components/app/playback/start/usePreparedLyricsPlayback';
import { useLyricPreparation } from '../../src/library/core/collection/import/useLyricPreparation';
import { LyricPreparationProgress } from '../../src/library/core/collection/import/LyricPreparationProgress';
import type { ProbeDefinition } from './definition';

// A real Omni import exercises text matching, persistence and playback display without speech inference.
const id = 'probe-auto-lyrics';
const subtitles = new URLSearchParams(location.search).has('subtitles');
const match = new URLSearchParams(location.search).has('match');
useLyricSettingsStore.setState({ preferredAlternativeLyricSource: 'lrclib', autoUseBestLyric: true });
const song: UnifiedSong = { id: 'unidentified', name: 'Imported unidentified audio', artists: [], album: { id: 0, name: '' }, durationMs: 11000,
    sourceRef: { kind: 'online', providerId: id, mediaId: 'unidentified' } };
const provider: OnlineMusicProvider = {
    id, displayName: 'Automatic lyric probe',
    capabilities: { search: false, playback: true, lyrics: subtitles, auth: false, userLibrary: false, playlists: false, albums: false,
        artists: false, recommendations: false, mutations: false, wordByWordLyrics: false, explore: false },
    normalizeSong: raw => raw as UnifiedSong,
    songMetadata: {
        getSongMetadata: () => ({ artists: [], album: { id: 0, name: '' }, durationMs: 11000, aliases: [], translatedNames: [] }),
        getLyricMatchTarget: () => ({ title: 'Fixture song', artist: 'Fixture artist', album: 'Test', durationMs: 11000, autoMatch: match }),
    },
    ...(subtitles ? { lyrics: { mediaTimed: true, getLyrics: async () => {
        const response = await fetch('/__video_subtitles');
        return { lyrics: await response.json(), isPureMusic: false };
    } } } : {}),
    playback: { getSongDetail: async () => song, getAudioSource: async () => ({ url: new URL('/__automatic_audio.wav', location.href).href, quality: 'standard', fetchedAt: Date.now() }) },
    linkImport: { labelKey: 'probe', placeholderKey: 'probe', descriptionKey: 'probe', resolve: async () => [song] },
};
registerOnlineMusicProvider(provider);
const persist = async () => {};
const Probe = () => {
    const [imported, setImported] = useState(false);
    const playing = usePlaybackStore(state => state.currentSong);
    const lyrics = usePlaybackStore(state => state.lyrics);
    const progress = useLyricPreparation(`import:${id}`);
    usePreparedLyricsPlayback(playing, setLyricsState, persist);
    useEffect(() => {
        usePlaybackStore.setState({ currentSong: song, lyrics: null, playQueue: [song] });
        void omni.importProviderSongs(id, 'fixture').then(() => setImported(true));
    }, []);
    return <div className="mx-auto max-w-sm p-4">
        <p data-import-returned>{String(imported)}</p>
        <p data-preparation-complete>{String(Boolean(progress?.total && progress.done === progress.total))}</p>
        <LyricPreparationProgress model={progress} />
        <div data-automatic-lyrics>{lyrics?.lines.map((line, i) => <p key={i}>{line.startTime.toFixed(2)} {line.fullText}</p>)}</div>
        <output data-saved-source>{playing?.onlineLyricsState?.matchedLyricsSource ?? playing?.onlineLyricsState?.importedLyricsName ?? ''}</output>
    </div>;
};
export default { id: 'automaticLyrics', title: 'Automatic imported lyrics', description: 'No recognition or apply click is needed after import.', Component: Probe } satisfies ProbeDefinition;
