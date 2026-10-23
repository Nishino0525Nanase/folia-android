import { useCallback, useRef, type RefObject } from 'react';

// Native playback and lyric overlays need a live clock even while the UI frame loop is suspended.

type PlaybackPositionReadersOptions = {
    audioRef: RefObject<HTMLAudioElement | null>;
    getDisplayElement?: () => HTMLAudioElement | null;
    getFallbackTime: () => number;
    getExternalTime?: (() => number) | null;
    lyricTimelineOffsetMs: number;
};

export function usePlaybackPositionReaders(options: PlaybackPositionReadersOptions) {
    const latest = useRef(options);
    latest.current = options;

    const getMediaTime = useCallback(() => {
        const current = latest.current;
        if (current.getExternalTime) return current.getExternalTime();
        const element = current.getDisplayElement?.() ?? current.audioRef.current;
        const time = element?.currentTime;
        return typeof time === 'number' && Number.isFinite(time) ? time : current.getFallbackTime();
    }, []);

    // Only a deliberate offset edit changes this callback: overlays then re-anchor immediately,
    // without resending their whole timeline on unrelated App renders or shifting media controls.
    const getLyricTime = useCallback(
        () => getMediaTime() - options.lyricTimelineOffsetMs / 1000,
        [getMediaTime, options.lyricTimelineOffsetMs],
    );

    return { getMediaTime, getLyricTime };
}
