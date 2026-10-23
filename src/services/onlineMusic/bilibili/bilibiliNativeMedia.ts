import i18n from '../../../i18n/config';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderAudioSource } from '../../../types/onlineMusic';
import { proxyNativeRemoteAudioUrl } from '../../nativeRemoteAudio';
import { bilibiliInputPageUrl } from './bilibiliInput';
import { nativeBilibili, BilibiliNativeError, record } from './bilibiliNative';
import { parseBilibiliMediaId, readBilibiliResolvedVideo } from './bilibiliNormalize';
import { getBilibiliSession, getBilibiliSessionGeneration } from './bilibiliSession';

// Android playback uses the same local account and existing loopback audio server, without cloud credentials.
export const nativeVideoParams = (input: string): Record<string, string> | null => {
    const page = bilibiliInputPageUrl(input);
    if (!page) return null;
    const url = new URL(page);
    const id = /\/video\/(BV[0-9A-Za-z]{10}|av\d+)\//.exec(url.pathname)?.[1];
    if (!id) return null;
    return { ...(id.startsWith('BV') ? { bvid: id } : { aid: id.slice(2) }),
        ...(url.searchParams.has('p') ? { selectedPage: url.searchParams.get('p')! } : {}) };
};

export const resolveNativeBilibiliVideo = async (params: Record<string, string>) => {
    const { data } = await nativeBilibili('view', params);
    const owner = record(data.owner);
    return readBilibiliResolvedVideo({ bvid: data.bvid, aid: data.aid, title: data.title, coverUrl: data.pic,
        owner: { id: owner.mid, name: owner.name },
        pages: Array.isArray(data.pages) ? data.pages.map((raw: unknown) => {
            const page = record(raw);
            return { cid: page.cid, page: page.page, title: page.part || data.title, durationSec: page.duration };
        }) : [], ...(params.selectedPage ? { selectedPage: Number(params.selectedPage) } : {}) });
};

export const nativeMediaError = (error: unknown): OnlineProviderError => {
    if (error instanceof OnlineProviderError) return error;
    const status = error instanceof BilibiliNativeError ? error.status : 0;
    const code = error instanceof BilibiliNativeError ? error.code : 'native-request-failed';
    return new OnlineProviderError(status === 401 ? 'auth-required' : status === 422 ? 'not-playable' : status ? 'unavailable' : 'network',
        i18n.t(status === 401 ? 'importSource.loginRequired' : status === 403 || status === 412 ? 'importSource.platformRestricted' : 'importSource.serviceUnavailable'),
        'bilibili', { code, upstreamCode: code === 'upstream-http' ? String(status) : code }, status || undefined);
};

export const getNativeBilibiliAudio = async (mediaId: string): Promise<ProviderAudioSource> => {
    const identity = parseBilibiliMediaId(mediaId);
    if (!identity) throw new BilibiliNativeError(400, 'invalid-video');
    const generation = getBilibiliSessionGeneration();
    const session = getBilibiliSession();
    const account = session.startsWith('native:') ? session : '';
    let cid = identity.cid;
    if (identity.first) {
        const { data } = await nativeBilibili('view', { bvid: identity.bvid }, account);
        cid = record(Array.isArray(data.pages) ? data.pages[0] : null).cid;
    }
    if (!Number.isSafeInteger(cid) || !cid || cid < 0) throw new BilibiliNativeError(502, 'invalid-video-part');
    const { data } = await nativeBilibili('playurl', { bvid: identity.bvid, cid: String(cid), fnval: '16', fnver: '0', fourk: '0' }, account);
    const audio = record(data.dash).audio;
    if (!Array.isArray(audio) || !audio.length) throw new BilibiliNativeError(422, 'no-audio');
    const stream = audio.map(record).filter(item => (item.mimeType || item.mime_type) === 'audio/mp4')
        .sort((a, b) => Number(b.bandwidth || 0) - Number(a.bandwidth || 0))[0];
    if (!stream) throw new BilibiliNativeError(422, 'no-audio');
    const url = new URL(String(stream.baseUrl || stream.base_url));
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !['bilivideo.com', 'bilivideo.cn', 'bilivideo.net'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
        throw new BilibiliNativeError(502, 'invalid-audio-host');
    }
    const now = Date.now();
    const deadline = Number(url.searchParams.get('deadline')) * 1000;
    if (deadline && deadline <= now) throw new BilibiliNativeError(502, 'audio-expired');
    const expiresAt = Math.min(deadline || now + 60_000, now + 6 * 60 * 60_000);
    const proxied = await proxyNativeRemoteAudioUrl(url.href, {
        allowAnyHost: true, headers: { Referer: 'https://www.bilibili.com/' },
    });
    if (generation !== getBilibiliSessionGeneration()) throw new BilibiliNativeError(401, 'session-changed');
    return { url: proxied, quality: 'high', fetchedAt: now, expiresAt };
};
