// src/services/onlineMusic/bilibili/bilibiliInput.ts
// Offers the original video even when metadata access fails, using only a local official-link check.
const VIDEO_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com']);
const VIDEO_ID = /^(BV[A-Za-z0-9]{10}|av[1-9]\d{0,15})$/;

export const bilibiliInputPageUrl = (input: string): string | null => {
    if (!input.trim() || input.length > 4096) return null;
    const text = input.trim();
    if (VIDEO_ID.test(text)) return `https://www.bilibili.com/video/${text}/`;
    const aid = /^av([1-9]\d{0,15})$/i.exec(text);
    if (aid) return `https://www.bilibili.com/video/av${aid[1]}/`;

    // A copied share message may contain one official link, never a second link or a bare ID in prose.
    const links = text.match(/https?:\/\/[^\s<>"'（）()【】《》，。；！？、]+/gi);
    if (links?.length !== 1) return null;
    const link = links[0];
    if (/[\x00-\x20\x7f\\]/.test(link)) return null;
    const authority = /^https:\/\/([^/?#]+)/i.exec(link)?.[1];
    if (!authority || /[:@%]/.test(authority)) return null;
    let url: URL;
    try { url = new URL(link); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || authority.toLowerCase() !== url.hostname) return null;

    const parts = url.searchParams.getAll('p');
    if (parts.length > 1 || (parts.length === 1 && (!/^[1-9]\d{0,4}$/.test(parts[0]) || Number(parts[0]) > 10000))) return null;
    const page = parts.length ? `?p=${Number(parts[0])}` : '';
    if (url.hostname === 'b23.tv') {
        return /^\/[A-Za-z0-9]+\/?$/.test(url.pathname)
            ? `https://b23.tv${url.pathname.replace(/\/$/, '')}${page}` : null;
    }
    if (!VIDEO_HOSTS.has(url.hostname)) return null;
    const video = /^\/video\/(BV[A-Za-z0-9]{10}|av[1-9]\d{0,15})\/?$/.exec(url.pathname);
    return video ? `https://www.bilibili.com/video/${video[1]}/${page}` : null;
};
