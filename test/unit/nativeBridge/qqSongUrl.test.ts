import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleQQSongUrl } from '../../../src/nativeBridge/api/qq.js';

// test/unit/nativeBridge/qqSongUrl.test.ts
// Exercise the native bridge's real musicu requests without contacting QQ or reading a user's session.

const SONG_MID = '001SongIdentity';
const MEDIA_MID = '002MediaIdentity';
const SESSION = 'uin=12345678; qqmusic_key=test-session-key';

type VkeyParams = {
    filename: string[];
    songmid: string[];
    songtype: number[];
    uin: string;
};

const DISTINCT_FILES = [
    'RS01001SongIdentity002MediaIdentity.flac',
    'F000001SongIdentity002MediaIdentity.flac',
    'M800001SongIdentity002MediaIdentity.mp3',
    'M500001SongIdentity002MediaIdentity.mp3',
    'C400001SongIdentity002MediaIdentity.m4a',
    'RS01001SongIdentity001SongIdentity.flac',
    'F000001SongIdentity001SongIdentity.flac',
    'M800001SongIdentity001SongIdentity.mp3',
    'M500001SongIdentity001SongIdentity.mp3',
    'C400001SongIdentity001SongIdentity.m4a',
];

const SONG_ONLY_FILES = DISTINCT_FILES.slice(5);

/** A fake QQ server that understands song detail and CgiGetVkey; every other request fails closed. */
const installQqServer = ({ detailMediaId = MEDIA_MID as string | null }: { detailMediaId?: string | null } = {}) => {
    const vkeyRequests: VkeyParams[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        expect(url.origin + url.pathname).toBe('https://u.y.qq.com/cgi-bin/musicu.fcg');
        expect(init?.method).toBe('POST');
        const payload = JSON.parse(String(init?.body));
        if (payload.songinfo?.method === 'get_song_detail_yqq') {
            expect(payload.songinfo.param.song_mid).toBe(SONG_MID);
            return Response.json({
                code: 0,
                songinfo: {
                    data: {
                        track_info: {
                            mid: SONG_MID,
                            name: 'Test track',
                            ...(detailMediaId === null ? {} : { file: { media_mid: detailMediaId } }),
                        },
                    },
                },
            });
        }
        expect(payload.req_0?.module).toBe('vkey.GetVkeyServer');
        expect(payload.req_0?.method).toBe('CgiGetVkey');
        const params = payload.req_0.param as VkeyParams;
        vkeyRequests.push(params);
        return Response.json({
            code: 0,
            req_0: {
                code: 0,
                data: {
                    sip: ['https://audio.example.invalid/'],
                    midurlinfo: [{
                        filename: params.filename[0],
                        purl: 'authorized-test-track.flac',
                    }],
                },
            },
        });
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, vkeyRequests };
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('native QQ song URL filenames', () => {
    it('includes the song identity before a distinct supplied media identity', async () => {
        const server = installQqServer({ detailMediaId: '003IgnoredDetail' });

        const result = await handleQQSongUrl(SONG_MID, MEDIA_MID, 'hires', SESSION);

        expect(server.vkeyRequests).toHaveLength(1);
        expect(server.vkeyRequests[0]).toMatchObject({
            filename: DISTINCT_FILES,
            songmid: Array(10).fill(SONG_MID),
            songtype: Array(10).fill(0),
            uin: '12345678',
        });
        expect(result).toMatchObject({
            playable: true,
            url: 'https://audio.example.invalid/authorized-test-track.flac',
            filename: DISTINCT_FILES[0],
            level: 'hires',
        });
        expect(server.fetchMock).toHaveBeenCalledTimes(2);
    });

    it('uses the song identity twice when detail has no media identity', async () => {
        const server = installQqServer({ detailMediaId: null });

        await handleQQSongUrl(SONG_MID, '', 'hires', SESSION);

        expect(server.vkeyRequests).toHaveLength(1);
        expect(server.vkeyRequests[0]).toMatchObject({
            filename: SONG_ONLY_FILES,
            songmid: Array(5).fill(SONG_MID),
            songtype: Array(5).fill(0),
        });
        expect(server.fetchMock).toHaveBeenCalledTimes(2);
    });

});
