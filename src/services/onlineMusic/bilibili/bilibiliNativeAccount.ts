import QRCode from 'qrcode';
import { BilibiliNativeError, nativeBilibili, nativeBilibiliErrorResponse, record } from './bilibiliNative';
import { fillNativeBilibiliFolderCovers } from './bilibiliNativeFolderCovers';

// Adapt local Android QR/account responses to the existing provider contract.
const invalid = (): never => { throw new BilibiliNativeError(502, 'invalid-response'); };
const user = (raw: Record<string, any>) => ({ id: raw.mid, nickname: raw.uname, avatarUrl: raw.face });
const pageSize = (value: string | null) => Math.min(20, Math.max(1, Number(value) || 20));
const favoriteFolder = (folder: Record<string, any>, ownerId: unknown) => ({
    id: folder.id, title: folder.title, coverUrl: folder.cover, description: folder.intro,
    trackCount: folder.media_count, owner: { id: ownerId, name: record(folder.upper).name || '' },
});

export const requestNativeBilibiliAccount = async (path: string, init: RequestInit, session: string): Promise<Response> => {
    try {
        const url = new URL(path, 'https://local.invalid');
        const body = typeof init.body === 'string' ? record(JSON.parse(init.body)) : {};
        const key = typeof body.key === 'string' ? body.key : '';
        if (url.pathname === '/login/qr/start') {
            const { data } = await nativeBilibili('qrStart');
            const qr = new URL(String(data.url));
            // The generate API is on passport, but current official QR links use account.
            if (qr.protocol !== 'https:' || !['passport.bilibili.com', 'account.bilibili.com'].includes(qr.hostname)
                || qr.port || qr.username || qr.password
                || !/^[a-fA-F0-9]{32}$/.test(data.qrcode_key) || qr.searchParams.get('qrcode_key') !== data.qrcode_key) invalid();
            return Response.json({ key: data.qrcode_key, expiresAt: data.expiresAt,
                imageUrl: await QRCode.toDataURL(qr.href, { width: 320, margin: 2, errorCorrectionLevel: 'M' }) });
        }
        if (url.pathname === '/login/qr/check') {
            let result;
            try { result = await nativeBilibili('qrPoll', { key }); }
            catch (error) {
                if (error instanceof BilibiliNativeError && error.status === 410) return Response.json({ state: 'expired' });
                throw error;
            }
            const state = ({ 0: 'confirmed', 86101: 'waiting', 86090: 'scanned', 86038: 'expired' } as Record<number, string>)[result.data.code];
            if (!state || state === 'confirmed' && !result.session?.startsWith('native:')) invalid();
            return Response.json({ state }, { headers: result.session ? { 'X-Bilibili-Session': result.session } : {} });
        }
        if (url.pathname === '/login/qr/cancel') {
            await nativeBilibili('qrCancel', { key });
            return Response.json({});
        }
        if (url.pathname === '/logout') {
            // A web bearer from an older APK is never sent to the platform or the native cookie store.
            if (session.startsWith('native:')) await nativeBilibili('logout', {}, session);
            return Response.json({});
        }
        if (!session.startsWith('native:')) return Response.json({ user: null }, { status: url.pathname === '/login/status' ? 200 : 401 });
        if (url.pathname === '/login/status') {
            const { data } = await nativeBilibili('nav', {}, session);
            return Response.json({ user: data.isLogin ? user(data) : null });
        }
        const limit = pageSize(url.searchParams.get('limit'));
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        if (url.pathname === '/favorites') {
            const { data } = await nativeBilibili('folders', { pn: String(Math.floor(offset / 20) + 1), ps: '20' }, session);
            const list = data.list;
            if (!Array.isArray(list) && list != null) invalid();
            const folders = (list || []).map((item: unknown) => record(item));
            const selected = folders.slice(offset % 20, offset % 20 + limit);
            await fillNativeBilibiliFolderCovers(selected, session);
            const items = selected.map((item: Record<string, any>) => favoriteFolder(item, data.ownerId));
            const nextOffset = offset + items.length;
            const hasTotal = Number.isSafeInteger(data.count) && data.count >= 0;
            const hasMore = offset % 20 + items.length < folders.length || Boolean(data.has_more)
                || (hasTotal ? nextOffset < data.count : data.has_more == null && folders.length === 20);
            if (hasMore && !items.length) invalid();
            return Response.json({ items, nextOffset, hasMore, ...(hasTotal ? { total: data.count } : {}) });
        }
        const detail = /^\/favorites\/([1-9]\d{0,19})$/.exec(url.pathname);
        if (detail) {
            const { data } = await nativeBilibili('folder', { media_id: detail[1] }, session);
            await fillNativeBilibiliFolderCovers([data], session);
            return Response.json(favoriteFolder(data, data.ownerId));
        }
        const folder = /^\/favorites\/([1-9]\d{0,19})\/tracks$/.exec(url.pathname);
        if (folder) {
            // Fixed upstream page size keeps offsets correct even when a caller asks for fewer items.
            const pn = Math.floor(offset / 20) + 1;
            const { data } = await nativeBilibili('tracks', { media_id: folder[1], pn: String(pn), ps: '20' }, session);
            if (!Array.isArray(data.medias) && data.medias != null) invalid();
            const all: unknown[] = data.medias || [];
            const consumed = all.slice(offset % 20, offset % 20 + limit);
            const items = consumed.map(record).filter(item => item.type === 2 && /^BV[0-9A-Za-z]{10}$/.test(item.bvid))
                .map(item => ({ bvid: item.bvid, aid: item.id, title: item.title, coverUrl: item.cover,
                    owner: { id: record(item.upper).mid, name: record(item.upper).name },
                    durationSec: item.duration, pageCount: item.page }));
            const nextOffset = offset + consumed.length;
            const total = record(data.info).media_count;
            const hasTotal = Number.isSafeInteger(total) && total >= 0;
            const hasMore = offset % 20 + consumed.length < all.length || Boolean(data.has_more) || hasTotal && nextOffset < total;
            if (hasMore && !consumed.length) invalid();
            console.info('[BilibiliLibrary] Favorite page read', { folderId: folder[1], offset, nextOffset,
                received: consumed.length, videos: items.length, skipped: consumed.length - items.length,
                hasMore, ...(hasTotal ? { total } : {}) });
            return Response.json({ items, nextOffset, hasMore, ...(hasTotal ? { total } : {}) });
        }
        throw new BilibiliNativeError(400, 'unsupported-operation');
    } catch (error) { return nativeBilibiliErrorResponse(error); }
};
