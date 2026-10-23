import { BilibiliNativeError, nativeBilibili, record } from './bilibiliNative';

// Two bounded workers try CDN routes; the first playable response cancels the other probe.
export type BilibiliSelectedMedia = { url: URL; headers: Record<string, string> };
export const selectBilibiliAudio = async (candidates: URL[], bvid: string, parent?: AbortSignal): Promise<BilibiliSelectedMedia> => {
    parent?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    parent?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 8_000);
    let cursor = 0;
    let lastError: unknown = new BilibiliNativeError(502, 'audio-unreachable');
    const worker = async (): Promise<BilibiliSelectedMedia> => {
        while (cursor < Math.min(candidates.length, 8)) {
            controller.signal.throwIfAborted();
            const candidate = candidates[cursor++];
            try {
                const reply = await nativeBilibili('audioProbe', { url: candidate.href, bvid }, '', controller.signal);
                const raw = record(reply.data.headers);
                const headers: Record<string, string> = {};
                for (const name of ['User-Agent', 'Referer', 'Origin', 'Accept']) {
                    if (typeof raw[name] === 'string') headers[name] = raw[name];
                }
                if (!headers['User-Agent'] || headers.Referer !== `https://www.bilibili.com/video/${bvid}/`) {
                    throw new BilibiliNativeError(502, 'invalid-playback-headers');
                }
                return { url: typeof reply.data.url === 'string' ? new URL(reply.data.url) : candidate, headers };
            } catch (error) {
                controller.signal.throwIfAborted();
                lastError = error;
            }
        }
        throw lastError;
    };
    try {
        try { return await Promise.any([worker(), worker()]); }
        catch { parent?.throwIfAborted(); throw lastError; }
    } finally {
        clearTimeout(timer);
        controller.abort();
        parent?.removeEventListener('abort', abort);
    }
};
