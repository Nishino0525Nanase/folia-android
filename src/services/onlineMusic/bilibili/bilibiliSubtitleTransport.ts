import type { SongResult } from '../../../types';
import type { MediaSubtitleStatus, ProviderLyricsResult } from '../../../types/onlineMusic';
import { nativeBilibili, usesNativeBilibili, record, BilibiliNativeError } from './bilibiliNative';
import { getBilibiliSession, getBilibiliSessionGeneration } from './bilibiliSession';
import { parseBilibiliMediaId } from './bilibiliNormalize';
import { getBilibiliLyricMatchTarget } from './bilibiliLyricMatch';
import { parseBilibiliSubtitles, selectBilibiliSubtitle } from './bilibiliSubtitles';

// Only small existing subtitle files are requested; no audio, video frames or inference model is downloaded.
const empty = (mediaSubtitleStatus: MediaSubtitleStatus = 'none'): ProviderLyricsResult => ({ lyrics: null, isPureMusic: false, chorusRanges: [], mediaSubtitleStatus });
const cache = new Map<string, { until: number; result: Promise<ProviderLyricsResult> }>();
let refusedUntil = 0;
let refusedGeneration = -1;

export const getBilibiliSubtitles = async (song: SongResult): Promise<ProviderLyricsResult> => {
    if (!usesNativeBilibili() || song.sourceRef?.kind !== 'online') return empty('unsupported');
    const identity = parseBilibiliMediaId(song.sourceRef.mediaId);
    if (!identity) return empty('invalid');
    const generation = getBilibiliSessionGeneration();
    // A provider-wide rejection should not fan out into a request for every imported video.
    if (generation === refusedGeneration && refusedUntil > Date.now()) return empty('refused');
    const session = getBilibiliSession();
    const account = session.startsWith('native:') ? session : '';
    const target = getBilibiliLyricMatchTarget(song);
    const language = /[\u3040-\u30ff]/u.test(`${target.title} ${target.artist}`) ? 'ja' : 'zh';
    const key = `${generation}:${account}:${song.sourceRef.mediaId}:${language}`;
    const existing = cache.get(key);
    if (existing && existing.until > Date.now()) return existing.result;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const entry = { until: Date.now() + 60_000, result: Promise.resolve(empty()) };
    entry.result = (async () => {
        try {
            let cid = String(identity.cid ?? '');
            if (identity.first) {
                const { data } = await nativeBilibili('parts', { bvid: identity.bvid }, account, controller.signal);
                cid = String(record(Array.isArray(data.pages) ? data.pages[0] : null).cid ?? '');
            }
            if (!/^[1-9]\d*$/.test(cid) || !Number.isSafeInteger(Number(cid))) return empty('invalid');
            const { data } = await nativeBilibili('subtitles', { bvid: identity.bvid, cid }, account, controller.signal);
            const track = selectBilibiliSubtitle(data.subtitle, language);
            if (!track) return empty(data.need_login_subtitle ? 'login-required' : 'none');
            const file = await nativeBilibili('subtitleBody', { url: track.url }, '', controller.signal);
            if (generation !== getBilibiliSessionGeneration() || session !== getBilibiliSession()) return empty('unavailable');
            const lyrics = parseBilibiliSubtitles(file.data, track);
            if (lyrics) entry.until = Date.now() + 15 * 60_000;
            return { lyrics, isPureMusic: false, chorusRanges: [], mediaSubtitleStatus: lyrics ? 'available' : 'invalid' };
        } catch (error) {
            // A missing/refused caption must never stop audio or expose a signed CDN URL in diagnostics.
            console.warn('[BilibiliSubtitles] Caption lookup unavailable', {
                code: error instanceof BilibiliNativeError ? error.code : 'subtitle-unavailable',
                status: error instanceof BilibiliNativeError ? error.status : 0,
            });
            const upstreamStatus = error instanceof BilibiliNativeError
                ? Number(/^subtitle-http-(\d{3})$/.exec(error.code)?.[1] ?? error.status) : 0;
            if ([403, 412, 429].includes(upstreamStatus)) {
                refusedGeneration = generation;
                refusedUntil = Date.now() + 5 * 60_000;
                return empty('refused');
            }
            return empty(upstreamStatus === 401 ? 'login-required' : 'unavailable');
        } finally { clearTimeout(timer); }
    })();
    cache.delete(key);
    cache.set(key, entry);
    if (cache.size > 128) cache.delete(cache.keys().next().value!);
    return entry.result;
};
