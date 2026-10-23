import React, { useEffect, useState } from 'react';
import { AudioAlignmentControl } from '../../src/components/panelTab/audioAlignment/AudioAlignmentControl';
import { usePlaybackStore } from '../../src/stores/usePlaybackStore';
import { loadOnlineLyricsState, resolveOnlineLyrics } from '../../src/utils/onlineLyricsState';
import type { SongResult } from '../../src/types';
import type { ProbeDefinition } from './definition';

// Mobile controls and real IndexedDB apply/restore, with inference supplied separately by the browser test.
const song: SongResult = { id: 'alignment-probe', name: 'Alignment fixture', artists: [], album: { id: 0, name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'video', mediaId: 'alignment-probe' } };
const original = { lines: ['The morning is blue', 'We follow the road', 'The day has begun'].map((fullText, i) => ({ fullText, words: [], startTime: i, endTime: i + 1 })) };
const Probe = () => {
    const [ready, setReady] = useState(false);
    const [offset, setOffset] = useState(2000);
    const [source, setSource] = useState('online');
    const [visible, setVisible] = useState(true);
    const lyrics = usePlaybackStore(state => state.lyrics);
    useEffect(() => {
        const bytes = new ArrayBuffer(32044), view = new DataView(bytes);
        const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
        text(0, 'RIFF'); view.setUint32(4, 32036, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
        view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        text(36, 'data'); view.setUint32(40, 32000, true);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        usePlaybackStore.setState({ currentSong: song, lyrics: original, audioSrc: url });
        setReady(true);
        return () => URL.revokeObjectURL(url);
    }, []);
    return <div className="mx-auto w-full max-w-sm p-2">
        <button onClick={() => setVisible(value => !value)}>Toggle panel</button>
        <output data-selection>{source}:{offset}:{lyrics?.lines[0]?.startTime}</output>
        {ready && visible && <AudioAlignmentControl song={song} isDaylight={true} offset={offset} onOffsetChange={setOffset}
            onSourceChange={async value => {
                usePlaybackStore.setState({ lyrics: resolveOnlineLyrics(await loadOnlineLyricsState(song), original) });
                setSource(value);
            }} />}
    </div>;
};
export default { id: 'audioAlignment', title: 'Audio alignment controls', description: 'Apply, restore and cancel recognition on a phone-sized panel.', Component: Probe } satisfies ProbeDefinition;
