// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePlaybackPositionReaders } from '@/components/app/playback/bridges/usePlaybackPositionReaders';

// Native overlays must follow audible playback rather than the UI clock that freezes in background.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Options = Parameters<typeof usePlaybackPositionReaders>[0];
let readers: ReturnType<typeof usePlaybackPositionReaders>;
let root: Root;
let host: HTMLDivElement;
const Probe = (options: Options) => { readers = usePlaybackPositionReaders(options); return null; };
const render = (options: Options) => act(() => root.render(createElement(Probe, options)));

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

describe('live native playback position readers', () => {
    it('follows playback and seeks when the last rendered time is frozen', () => {
        const audio = document.createElement('audio');
        audio.currentTime = 12;
        render({ audioRef: { current: audio }, getFallbackTime: () => 12, lyricTimelineOffsetMs: 750 });
        audio.currentTime = 38;
        expect(readers.getMediaTime()).toBe(38);
        expect(readers.getLyricTime()).toBe(37.25);
        audio.currentTime = 4;
        expect(readers.getMediaTime()).toBe(4);
        expect(readers.getLyricTime()).toBe(3.25);
    });

    it('keeps callback identity through unrelated rerenders while following the latest display deck', () => {
        const active = document.createElement('audio');
        const outgoing = document.createElement('audio');
        active.currentTime = 7;
        outgoing.currentTime = 90;
        const options = { audioRef: { current: active }, getFallbackTime: () => 0, lyricTimelineOffsetMs: 0 };
        render({ ...options, getDisplayElement: () => outgoing });
        const previous = readers;
        expect(readers.getMediaTime()).toBe(90);
        render({ ...options, getDisplayElement: () => active });
        expect(readers.getMediaTime).toBe(previous.getMediaTime);
        expect(readers.getLyricTime).toBe(previous.getLyricTime);
        expect(readers.getMediaTime()).toBe(7);
        expect(readers.getLyricTime()).toBe(7);
        render({ ...options, getDisplayElement: () => active, lyricTimelineOffsetMs: -500 });
        expect(readers.getMediaTime).toBe(previous.getMediaTime);
        expect(readers.getLyricTime).not.toBe(previous.getLyricTime);
        expect(readers.getLyricTime()).toBe(7.5);
    });

    it('reads external clocks and falls back only when no media clock is available', () => {
        const audio = document.createElement('audio');
        audio.currentTime = 100;
        const options = { audioRef: { current: audio }, getFallbackTime: () => 15, lyricTimelineOffsetMs: 0 };
        let externalTime = 20;
        render({ ...options, getExternalTime: () => externalTime });
        externalTime = 24;
        expect(readers.getMediaTime()).toBe(24);
        expect(readers.getLyricTime()).toBe(24);
        render({ ...options, audioRef: { current: null } });
        expect(readers.getMediaTime()).toBe(15);
    });
});
