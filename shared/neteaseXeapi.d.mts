// Browser-compatible NetEase XEAPI boundary shared by the Worker and native adapter.
export type XeapiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export class NeteaseXeapiError extends Error {
    status?: number;
    stage: string;
}
export function createNeteaseXeapi(options: {
    cryptoJs: any;
    fetch: XeapiFetch;
    getCookies: () => string;
    mergeCookies: (rawCookie: string) => void | Promise<void>;
    deviceId: string;
}): (path: string, data?: Record<string, any>) => Promise<Record<string, any>>;
