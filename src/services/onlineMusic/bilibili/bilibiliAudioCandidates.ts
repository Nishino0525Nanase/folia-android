import { BilibiliNativeError, record } from './bilibiliNative';

// Keep the signed media URLs intact, including official CDN ports and backup routes.
export const bilibiliAudioCandidates = (raw: unknown, now: number): URL[] => {
    if (!Array.isArray(raw) || !raw.length) throw new BilibiliNativeError(422, 'no-audio');
    const streams = raw.map(record).filter(item => (item.mimeType || item.mime_type) === 'audio/mp4')
        .sort((a, b) => Number(b.bandwidth || 0) - Number(a.bandwidth || 0));
    if (!streams.length) throw new BilibiliNativeError(422, 'no-audio');
    const urls: URL[] = [];
    let expired = false;
    for (const stream of streams) {
        const backups = stream.backupUrl || stream.backup_url;
        const candidates: URL[] = [];
        for (const value of [stream.baseUrl || stream.base_url, ...(Array.isArray(backups) ? backups : [])]) {
            if (typeof value !== 'string') continue;
            let url: URL;
            try { url = new URL(value); } catch { continue; }
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
                || !['bilivideo.com', 'bilivideo.cn', 'bilivideo.net'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) continue;
            const deadline = url.searchParams.get('deadline');
            if (deadline !== null && (!/^\d+$/.test(deadline) || Number(deadline) * 1000 <= now)) { expired = true; continue; }
            candidates.push(url);
        }
        // Conventional HTTPS CDN routes are preferable to nonstandard-port and HTTP routes.
        const rank = (url: URL) => (url.protocol === 'https:' ? 0 : 2) + (url.port ? 1 : 0);
        candidates.sort((a, b) => rank(a) - rank(b));
        for (const url of candidates) if (!urls.some(kept => kept.href === url.href)) urls.push(url);
    }
    if (!urls.length) throw new BilibiliNativeError(502, expired ? 'audio-expired' : 'invalid-audio-host');
    return urls;
};
