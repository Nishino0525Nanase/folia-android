// Schedules playback visuals at display rate while active, with no hidden work and a light idle breath.

export const PLAYBACK_VISUALIZER_IDLE_INTERVAL_MS = 1000 / 15;

type PlaybackVisualizerFrameLoopOptions = {
    /** Updates clocks/bands and reports whether audio or a synthetic playback clock is running. */
    update: () => boolean;
    isHidden: () => boolean;
    requestFrame: (callback: FrameRequestCallback) => number;
    cancelFrame: (handle: number) => void;
    delay: (callback: () => void, milliseconds: number) => number;
    cancelDelay: (handle: number) => void;
    onFrameHandle: (handle: number) => void;
};

/** Hidden pages own no pending work; waking always reads the live clock on the next display frame. */
export const createPlaybackVisualizerFrameLoop = ({
    update, isHidden, requestFrame, cancelFrame, delay, cancelDelay, onFrameHandle,
}: PlaybackVisualizerFrameLoopOptions) => {
    let frame: number | null = null;
    let timer: number | null = null;
    let disposed = false;

    const cancelPending = () => {
        if (frame !== null) cancelFrame(frame);
        if (timer !== null) cancelDelay(timer);
        frame = null;
        timer = null;
        onFrameHandle(0);
    };
    const request = () => {
        if (disposed || isHidden() || frame !== null) return;
        frame = requestFrame(tick);
        onFrameHandle(frame);
    };
    const tick = () => {
        frame = null;
        onFrameHandle(0);
        if (disposed || isHidden()) return;
        const active = update();
        if (disposed || isHidden()) return;
        if (active) {
            request();
        } else {
            timer = delay(() => {
                timer = null;
                request();
            }, PLAYBACK_VISUALIZER_IDLE_INTERVAL_MS);
        }
    };
    const wake = () => {
        cancelPending();
        request();
    };

    wake();
    return {
        wake,
        dispose: () => {
            disposed = true;
            cancelPending();
        },
    };
};
