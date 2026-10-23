import { registerPlugin } from '@capacitor/core';
import { isCapacitorAndroid } from '../../../platform/runtime';

// The Android transport owns cookies; web deployments continue to use their configured backend.
type NativeReply = { ok: boolean; data?: unknown; session?: string; status?: number; code?: string };
const plugin = registerPlugin<{
    request(options: { operation: string; params: Record<string, string>; session: string; requestId?: string }): Promise<NativeReply>;
    cancel(options: { requestId: string }): Promise<void>;
}>('FoliaBilibili');

export const usesNativeBilibili = isCapacitorAndroid;
export const record = (value: unknown): Record<string, any> => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
);

export class BilibiliNativeError extends Error {
    constructor(readonly status: number, readonly code: string) { super(code); }
}

const requestPrefix = Date.now().toString(36) + Math.random().toString(36).slice(2);
let requestSequence = 0;
export const nativeBilibili = async (operation: string, params: Record<string, string> = {}, session = '', signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const requestId = `${requestPrefix}-${++requestSequence}`;
    let removeAbort = () => {};
    let reply: NativeReply;
    try {
        const pending = plugin.request({ operation, params, session, ...(signal ? { requestId } : {}) });
        reply = signal ? await new Promise<NativeReply>((resolve, reject) => {
            const abort = () => {
                void plugin.cancel({ requestId }).catch(() => {});
                reject(new DOMException('Request cancelled', 'AbortError'));
            };
            signal.addEventListener('abort', abort, { once: true });
            removeAbort = () => signal.removeEventListener('abort', abort);
            pending.then(resolve, reject);
            if (signal.aborted) abort();
        }) : await pending;
    } catch {
        signal?.throwIfAborted();
        throw new BilibiliNativeError(0, 'native-request-failed');
    } finally { removeAbort(); }
    signal?.throwIfAborted();
    if (!reply.ok) throw new BilibiliNativeError(reply.status || 0, reply.code || 'native-request-failed');
    return { data: record(reply.data), session: reply.session || null };
};

export const nativeBilibiliErrorResponse = (error: unknown): Response => {
    if (!(error instanceof BilibiliNativeError) || error.status === 0) throw error;
    return Response.json({ code: error.status === 403 || error.status === 412 ? 'upstream-restricted' : error.code,
        upstreamCode: error.code === 'upstream-http' ? String(error.status) : error.code }, { status: error.status });
};
