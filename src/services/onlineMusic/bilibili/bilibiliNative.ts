import { registerPlugin } from '@capacitor/core';
import { isCapacitorAndroid } from '../../../platform/runtime';

// The Android transport owns cookies; web deployments continue to use their configured backend.
type NativeReply = { ok: boolean; data?: unknown; session?: string; status?: number; code?: string };
const plugin = registerPlugin<{
    request(options: { operation: string; params: Record<string, string>; session: string }): Promise<NativeReply>;
}>('FoliaBilibili');

export const usesNativeBilibili = isCapacitorAndroid;
export const record = (value: unknown): Record<string, any> => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
);

export class BilibiliNativeError extends Error {
    constructor(readonly status: number, readonly code: string) { super(code); }
}

export const nativeBilibili = async (operation: string, params: Record<string, string> = {}, session = '') => {
    let reply: NativeReply;
    try { reply = await plugin.request({ operation, params, session }); }
    catch { throw new BilibiliNativeError(0, 'native-request-failed'); }
    if (!reply.ok) throw new BilibiliNativeError(reply.status || 0, reply.code || 'native-request-failed');
    return { data: record(reply.data), session: reply.session || null };
};

export const nativeBilibiliErrorResponse = (error: unknown): Response => {
    if (!(error instanceof BilibiliNativeError) || error.status === 0) throw error;
    return Response.json({ code: error.status === 403 || error.status === 412 ? 'upstream-restricted' : error.code,
        upstreamCode: error.code === 'upstream-http' ? String(error.status) : error.code }, { status: error.status });
};
