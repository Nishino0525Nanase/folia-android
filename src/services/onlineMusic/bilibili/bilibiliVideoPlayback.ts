import { BilibiliNativeError, nativeBilibili, record } from './bilibiliNative';
import { bilibiliAudioCandidates, bilibiliProgressiveCandidates } from './bilibiliAudioCandidates';
import { selectBilibiliAudio } from './bilibiliAudioSelection';

// Listen to this exact video part, preferring its audio track and falling back to its complete MP4.
const canTryVideoStream = (error: unknown) => error instanceof BilibiliNativeError
    && /^(no-audio|audio-expired|audio-http-\d{3}|audio-unreachable|audio-redirect-limit|invalid-audio-content)$/.test(error.code);

export const selectNativeBilibiliVideo = async (bvid: string, cid: number, account: string, signal?: AbortSignal) => {
    const params = { bvid, cid: String(cid) };
    const { data } = await nativeBilibili('playurl', params, account, signal);
    const select = async (candidates: URL[], stream: string) => {
        const selected = await selectBilibiliAudio(candidates, bvid, signal);
        console.info('[BilibiliPlayback] Video audio ready', { bvid, cid, stream, host: selected.url.host });
        return selected;
    };
    // An API access denial ends above. Changing stream format must not change account or video rights.
    try {
        if (!data.dash && !data.durl) throw new BilibiliNativeError(422, 'no-audio');
        const candidates = data.dash
            ? bilibiliAudioCandidates(record(data.dash).audio, Date.now())
            : bilibiliProgressiveCandidates(data, Date.now());
        return await select(candidates, data.dash ? 'dash-audio' : 'video-mp4');
    } catch (error) {
        signal?.throwIfAborted();
        if (!canTryVideoStream(error)) throw error;
        console.warn('[BilibiliPlayback] Trying complete video MP4 after audio route failure', { bvid, cid }, error);
        try {
            const fallback = await nativeBilibili('playurl', { ...params, mode: 'progressive' }, account, signal);
            const candidates = bilibiliProgressiveCandidates(fallback.data, Date.now());
            return await select(candidates, 'video-mp4');
        } catch (fallbackError) {
            signal?.throwIfAborted();
            // Preserve a useful CDN error if the server does not offer a complete MP4 alternative.
            if (fallbackError instanceof BilibiliNativeError && fallbackError.code === 'no-complete-video-stream') throw error;
            throw fallbackError;
        }
    }
};
