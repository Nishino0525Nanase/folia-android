import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { parseBilibiliSubtitles, selectBilibiliSubtitle } from '@/services/onlineMusic/bilibili/bilibiliSubtitles';
import { getBilibiliSubtitles } from '@/services/onlineMusic/bilibili/bilibiliSubtitleTransport';

// Existing subtitle cues retain the video identity, account scope and original timestamps.
const mock = vi.hoisted(() => ({ request: vi.fn(), cancel: vi.fn(), generation: 0, session: 'native:fixture', native: true }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({ request: mock.request, cancel: mock.cancel }) }));
vi.mock('@/platform/runtime', () => ({ isCapacitorAndroid: () => mock.native }));
vi.mock('@/services/onlineMusic/bilibili/bilibiliSession', () => ({ getBilibiliSession: () => mock.session, getBilibiliSessionGeneration: () => mock.generation }));
const song = (mediaId = 'BV1FT6dBtEff:123'): SongResult => ({ id: mediaId, name: '夜鹿 - 晴る', artists: [], album: { id: 0, name: '' }, durationMs: 270000,
    sourceRef: { kind: 'online', providerId: 'bilibili', mediaId } });
const track = { url: '//aisubtitle.hdslb.com/bfs/subtitle/test.json', language: 'ja', automatic: false };
const metadata = { ok: true, data: { subtitle: { subtitles: [{ lan: 'ja', subtitle_url: track.url }] } } };
const body = { ok: true, data: { body: [{ from: 12.45, to: 16.32, content: '歌詞' }, { from: 23, to: 26, content: '続き' }] } };
beforeEach(() => { vi.resetAllMocks(); mock.generation++; mock.session = 'native:fixture'; mock.native = true; mock.cancel.mockResolvedValue(undefined); });
afterEach(() => vi.useRealTimers());

it('prefers Japanese cues for a Japanese title and human cues over AI in that language', () => {
    const result = selectBilibiliSubtitle({ subtitles: [{ lan: 'zh-CN', subtitle_url: 'zh' },
        { lan: 'ai-ja', subtitle_url: 'ai' }, { lan: 'ja', subtitle_url: 'ja' }] }, 'ja');
    expect(result).toEqual({ language: 'ja', url: 'ja', automatic: false });
    expect(selectBilibiliSubtitle({ subtitles: [{ lan: 'ai-zh', subtitle_url: 'ai' }] }, 'zh')?.automatic).toBe(true);
});
it('retains cue start/end times, pauses and repeat lyrics without fabricating word boundaries', () => {
    const result = parseBilibiliSubtitles({ body: [...body.data.body, { from: 28, to: 32, content: '歌詞' }] }, track)!;
    expect(result.lines.map(l => [l.startTime, l.endTime])).toEqual([[12.45, 16.32], [23, 26], [28, 32]]);
    expect(result.isWordByWord).toBe(false); expect(result.lines[0].words).toHaveLength(1);
    expect(result.mediaSubtitle).toEqual({ language: 'ja', automatic: false });
});
it('rejects malformed, oversized or empty subtitle data and deduplicates identical cues', () => {
    const cue = body.data.body[0];
    expect(parseBilibiliSubtitles({ body: [cue, cue, { from: -1, to: 2, content: 'bad' }, { from: 2, to: 1, content: 'bad' },
        { from: 0, to: Infinity, content: 'bad' }, { from: 0, to: 1, content: '' }] }, track)?.lines).toHaveLength(1);
    expect(parseBilibiliSubtitles({ body: Array(10001).fill(cue) }, track)).toBeNull();
    expect(parseBilibiliSubtitles('<html>error</html>', track)).toBeNull();
});
it('uses the selected part and local login, never account cookies on subtitle CDN requests, and deduplicates lookup', async () => {
    mock.request.mockResolvedValueOnce(metadata).mockResolvedValueOnce(body);
    const [a, b] = await Promise.all([getBilibiliSubtitles(song()), getBilibiliSubtitles(song())]);
    expect(a.lyrics?.lines[0].startTime).toBe(12.45); expect(b).toEqual(a);
    expect(mock.request).toHaveBeenCalledTimes(2);
    expect(mock.request.mock.calls[0][0]).toMatchObject({ operation: 'subtitles', params: { bvid: 'BV1FT6dBtEff', cid: '123' }, session: 'native:fixture' });
    expect(mock.request.mock.calls[1][0]).toMatchObject({ operation: 'subtitleBody', session: '' });
});
it('resolves a favourite entry with first-part identity before reading its subtitles', async () => {
    mock.request.mockResolvedValueOnce({ ok: true, data: { pages: [{ cid: 987 }, { cid: 654 }] } }).mockResolvedValueOnce(metadata).mockResolvedValueOnce(body);
    expect((await getBilibiliSubtitles(song('BV1FT6dBtEff:first'))).lyrics).not.toBeNull();
    expect(mock.request.mock.calls[1][0].params).toEqual({ bvid: 'BV1FT6dBtEff', cid: '987' });
});
it('distinguishes login-required subtitles from a video with no independent caption track', async () => {
    mock.request.mockResolvedValueOnce({ ok: true, data: { subtitle: { subtitles: [] }, need_login_subtitle: true } });
    expect(await getBilibiliSubtitles(song())).toMatchObject({ lyrics: null, isPureMusic: false, mediaSubtitleStatus: 'login-required' });
    mock.request.mockResolvedValueOnce({ ok: true, data: { subtitle: { subtitles: [] } } });
    expect(await getBilibiliSubtitles(song('BV1FT6dBtEff:456'))).toMatchObject({ lyrics: null, isPureMusic: false, mediaSubtitleStatus: 'none' });
    expect(mock.request).toHaveBeenCalledTimes(2);
});
it('does not return a subtitle request from an account that was signed out while reading', async () => {
    mock.request.mockResolvedValueOnce(metadata).mockImplementationOnce(async () => { mock.generation++; mock.session = ''; return body; });
    expect((await getBilibiliSubtitles(song())).lyrics).toBeNull();
});
it('bounds native work and cancels a stalled lookup', async () => {
    vi.useFakeTimers(); mock.request.mockImplementation(() => new Promise(() => {}));
    const result = getBilibiliSubtitles(song());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toMatchObject({ lyrics: null, mediaSubtitleStatus: 'unavailable' }); expect(mock.cancel).toHaveBeenCalledOnce();
});
it('leaves unsupported web deployments on the existing text search path', async () => {
    mock.native = false; expect(await getBilibiliSubtitles(song())).toMatchObject({ lyrics: null, mediaSubtitleStatus: 'unsupported' }); expect(mock.request).not.toHaveBeenCalled();
});
it('reports malformed subtitle content separately from absent captions', async () => {
    mock.request.mockResolvedValueOnce(metadata).mockResolvedValueOnce({ ok: true, data: { body: [] } });
    expect(await getBilibiliSubtitles(song())).toMatchObject({ lyrics: null, mediaSubtitleStatus: 'invalid' });
});
it('backs off a provider-wide refusal instead of requesting every song, and clears the cooldown after login changes', async () => {
    mock.request.mockResolvedValueOnce({ ok: false, status: 403, code: 'upstream-http' });
    expect(await getBilibiliSubtitles(song())).toMatchObject({ mediaSubtitleStatus: 'refused' });
    expect(await getBilibiliSubtitles(song('BV1FT6dBtEff:456'))).toMatchObject({ mediaSubtitleStatus: 'refused' });
    expect(mock.request).toHaveBeenCalledOnce();
    mock.generation++; mock.request.mockResolvedValueOnce(metadata).mockResolvedValueOnce(body);
    expect(await getBilibiliSubtitles(song('BV1FT6dBtEff:456'))).toMatchObject({ mediaSubtitleStatus: 'available' });
});
it('recognizes subtitle CDN refusals wrapped by the native transport', async () => {
    mock.request.mockResolvedValueOnce(metadata).mockResolvedValueOnce({ ok: false, status: 502, code: 'subtitle-http-403' });
    expect(await getBilibiliSubtitles(song())).toMatchObject({ mediaSubtitleStatus: 'refused' });
});
