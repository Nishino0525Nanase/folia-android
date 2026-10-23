import type { SongResult } from '../../types';
import { readLocalTrackBytes, decodeAtRate, toMidSide } from '../analysis/trackAudio';
import { getPlaybackAnalysisTarget } from '../playbackRecovery/representationRegistry';

// Read the actual playback representation, then decode to 16 kHz; no catalogue substitute is used.
const MAX_BYTES = 64 * 1024 * 1024;
export const readAlignmentAudio = async (song: SongResult, audioUrl: string | null, signal: AbortSignal): Promise<Float32Array> => {
    signal.throwIfAborted();
    const { representation } = getPlaybackAnalysisTarget(song);
    const local = await readLocalTrackBytes(song, { representation, audioUrl });
    signal.throwIfAborted();
    let bytes: ArrayBuffer;
    if (local && 'bytes' in local) bytes = local.bytes;
    else {
        if (local?.skipped || !audioUrl) throw new Error('audio-unavailable');
        const response = await fetch(audioUrl, { signal });
        if (!response.ok || !response.body) throw new Error('audio-unavailable');
        if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body.cancel(); throw new Error('audio-too-large'); }
        const reader = response.body.getReader();
        const parts: Uint8Array[] = [];
        let size = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.length;
                if (size > MAX_BYTES) throw new Error('audio-too-large');
                parts.push(value);
            }
        } finally { await reader.cancel().catch(() => {}); }
        const joined = new Uint8Array(size);
        let cursor = 0;
        for (const part of parts) { joined.set(part, cursor); cursor += part.length; }
        bytes = joined.buffer;
    }
    if (bytes.byteLength > MAX_BYTES) throw new Error('audio-too-large');
    const buffer = await decodeAtRate(bytes, 16000);
    signal.throwIfAborted();
    if (!buffer || buffer.duration <= 0) throw new Error('audio-decode');
    if (buffer.duration > 900) throw new Error('audio-too-long');
    // Reject truncated caches; those timestamps cannot safely stand for the complete video.
    if (song.durationMs > 0 && Math.abs(buffer.duration - song.durationMs / 1000) > Math.max(10, song.durationMs / 1000 * 0.05)) throw new Error('audio-duration');
    return toMidSide(buffer).mid;
};
