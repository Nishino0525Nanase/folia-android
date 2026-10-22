// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackVisualizerBridge } from '@/components/app/playback/bridges/usePlaybackVisualizerBridge';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { audioBands, currentTime } from '@/stores/motionSignals';
import { PlayerState, type LyricData } from '@/types';

// Exercise the real bridge: synthetic clocks, hidden-page catch-up and spectrum publication contracts.

vi.mock('@/hooks/useBeatFxTrack', () => ({ useBeatFxTrack: () => false }));
vi.mock('@/services/beatFx/beatFxLive', () => ({ tickBeatFx: vi.fn() }));
vi.mock('@/services/automix/transitionCue', () => ({ getTransitionHandoffProgress: () => 0 }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let visibility: DocumentVisibilityState;

const makeProps = () => ({
    audioRef: { current: null as HTMLAudioElement | null },
    analyserRef: { current: null as AnalyserNode | null },
    animationFrameRef: { current: 0 },
    effectiveLoopMode: 'off' as const,
    isNowPlayingStageActive: false,
    isPlayerCapStageActive: false,
    stageActiveEntryKind: null as string | null,
    stageLyricsSession: null as unknown,
    stageLyricsClockRef: { current: { startTimeSec: 0, endTimeSec: 100, baseTimeSec: 0, startedAtMs: 1 } },
    getSyntheticStageLyricsTime: () => 3,
    syncStageLyricsClock: vi.fn(),
    getNowPlayingDisplayTime: () => 4,
    getPlayerCapDisplayTime: () => 5,
    syncNowPlayingClock: vi.fn(),
    lyricTimelineOffsetMs: 0,
    isTransitionAudible: () => false,
});
type Props = ReturnType<typeof makeProps>;
const Probe = ({ props }: { props: Props }) => { usePlaybackVisualizerBridge(props); return null; };
const render = (props: Props) => act(() => root.render(createElement(Probe, { props })));
const frame = () => act(() => {
    const [handle, callback] = frames.entries().next().value!;
    frames.delete(handle);
    callback(0);
});
const show = (next: DocumentVisibilityState) => act(() => {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
});

beforeEach(() => {
    vi.useFakeTimers();
    frames = new Map();
    nextFrame = 0;
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => { frames.delete(handle); });
    usePlaybackStore.setState({ playerState: PlayerState.PLAYING, activePlaybackContext: 'main', lyrics: null, duration: 100, transitionDisplay: null });
    currentTime.set(0);
    root = createRoot(document.createElement('div'));
});

afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('playback visual bridge activity', () => {
    it.each(['nowPlaying', 'playerCap', 'lyrics'] as const)('keeps %s synthetic playback at display rate without an audio element', kind => {
        const props = makeProps();
        if (kind === 'nowPlaying') props.isNowPlayingStageActive = true;
        if (kind === 'playerCap') props.isPlayerCapStageActive = true;
        if (kind === 'lyrics') {
            props.stageActiveEntryKind = 'lyrics';
            props.stageLyricsSession = {};
            usePlaybackStore.setState({ activePlaybackContext: 'stage', lyrics: { lines: [] } as unknown as LyricData });
        }
        render(props);
        frame();
        expect(currentTime.get()).toBe(kind === 'nowPlaying' ? 4 : kind === 'playerCap' ? 5 : 3);
        expect(frames.size).toBe(1);
        frame();
        expect(frames.size).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('slows a paused synthetic clock, then wakes immediately when its state becomes playing', () => {
        const props = makeProps();
        props.isNowPlayingStageActive = true;
        usePlaybackStore.setState({ playerState: PlayerState.PAUSED });
        render(props);
        frame();
        expect(frames.size).toBe(0);
        expect(vi.getTimerCount()).toBe(1);
        act(() => usePlaybackStore.setState({ playerState: PlayerState.PLAYING }));
        expect(frames.size).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
        frame();
        expect(frames.size).toBe(1);
    });

    it('stops visual work while hidden without pausing audio and catches up on the first visible frame', () => {
        const props = makeProps();
        const audio = { paused: false, ended: false, currentTime: 8 };
        props.audioRef.current = audio as HTMLAudioElement;
        render(props);
        frame();
        expect(currentTime.get()).toBe(8);
        show('hidden');
        expect(frames.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        audio.currentTime = 18;
        expect(audio.paused).toBe(false);
        expect(currentTime.get()).toBe(8);
        show('visible');
        frame();
        expect(currentTime.get()).toBe(18);
        expect(frames.size).toBe(1);
    });

    it('keeps fresh spectrum references for playing consumers and does not mutate their previous frame', () => {
        const props = makeProps();
        props.audioRef.current = { paused: false, ended: false, currentTime: 1 } as HTMLAudioElement;
        let amplitude = 10;
        props.analyserRef.current = {
            frequencyBinCount: 1024,
            getByteFrequencyData: (buffer: Uint8Array) => { buffer.fill(amplitude); },
        } as AnalyserNode;
        render(props);
        // Native keeps the analyser fallback at 33ms; each measured frame must cross that boundary.
        act(() => vi.advanceTimersByTime(34));
        frame();
        const first = audioBands.spectrum.get();
        amplitude = 20;
        act(() => vi.advanceTimersByTime(34));
        frame();
        const second = audioBands.spectrum.get();
        expect(second).not.toBe(first);
        expect(first[0]).toBe(10);
        expect(second[0]).toBe(20);
    });
});
