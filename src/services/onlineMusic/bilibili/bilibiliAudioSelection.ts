import { BilibiliNativeError, nativeBilibili } from './bilibiliNative';

// Two bounded workers try CDN routes; the first playable response cancels the other probe.
export const selectBilibiliAudio = async (candidates: URL[], parent?: AbortSignal): Promise<URL> => {
    parent?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort();
    parent?.addEventListener('abort', abort, { once: true });
    let cursor = 0;
    let lastError: unknown = new BilibiliNativeError(502, 'audio-unreachable');
    const worker = async (): Promise<URL> => {
        while (cursor < Math.min(candidates.length, 8)) {
            controller.signal.throwIfAborted();
            const candidate = candidates[cursor++];
            try {
                const reply = await nativeBilibili('audioProbe', { url: candidate.href }, '', controller.signal);
                return typeof reply.data.url === 'string' ? new URL(reply.data.url) : candidate;
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
        controller.abort();
        parent?.removeEventListener('abort', abort);
    }
};
