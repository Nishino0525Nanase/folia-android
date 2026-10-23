import { nativeBilibili, record } from './bilibiliNative';

// Missing folder artwork is optional metadata: keep list paging intact, and never cache failed lookups.
const imageUrl = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    try {
        const url = new URL(value.trim().replace(/^http:\/\//, 'https://').replace(/^\/\//, 'https://'));
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
};

export const fillNativeBilibiliFolderCovers = async (folders: Record<string, any>[], session: string): Promise<void> => {
    const missing = folders.filter(folder => !imageUrl(folder.cover) && folder.media_count > 0 && /^[1-9]\d{0,19}$/.test(String(folder.id)));
    if (!missing.length) return;
    const batch = new AbortController();
    const timeout = setTimeout(() => batch.abort(), 8000);
    let cursor = 0;
    let filled = 0;
    try {
        await Promise.all(Array.from({ length: Math.min(2, missing.length) }, async () => {
            while (!batch.signal.aborted && cursor < missing.length) {
                const folder = missing[cursor++];
                try {
                    // The native tracks operation verifies ownership before returning any data.
                    const { data } = await nativeBilibili('tracks', { media_id: String(folder.id), pn: '1', ps: '20' }, session, batch.signal);
                    const videos: unknown[] = Array.isArray(data.medias) ? data.medias : [];
                    const cover = imageUrl(record(data.info).cover)
                        || videos.map(item => imageUrl(record(item).cover)).find(Boolean) || '';
                    if (cover) { folder.cover = cover; filled++; }
                } catch {
                    // A cover failure cannot hide the folder or shorten its track count. A refresh retries it.
                }
            }
        }));
    } finally { clearTimeout(timeout); }
    console.info('[BilibiliLibrary] Folder artwork fallback', { missing: missing.length, filled, remaining: missing.length - filled });
};
