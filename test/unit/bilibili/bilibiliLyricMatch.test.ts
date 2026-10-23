import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { getBilibiliLyricMatchTarget } from '@/services/onlineMusic/bilibili/bilibiliLyricMatch';
import { calculateMatchScoreDetails } from '@/utils/lyrics/matchScore';
import { buildLyricSearchQuery } from '@/utils/lyrics/searchQuery';

// Video credits must be searchable without replacing the original video identity or uploader.
const video = (name: string): SongResult => ({ name, id: 'BV0000000001:first', durationMs: 255_000,
    artists: [{ id: 123, name: '字幕搬运UP' }], album: { id: 'video', name, coverUrl: 'https://i0.hdslb.com/video.jpg' },
    sourceRef: { kind: 'online', providerId: 'bilibili', mediaId: 'BV0000000001:first' } });
const candidate = (name = '晴る', artist = 'Yorushika'): SongResult => ({ id: 1, name,
    artists: [{ id: 1, name: artist }], album: { id: 1, name: '晴る' }, durationMs: 240_000 });

describe('video lyric search hints', () => {
    it.each([
        ['【4K】【中日字幕】ヨルシカ - 晴る (Official Video)', '晴る', 'ヨルシカ'],
        ['【夜鹿】晴る【中字】', '晴る', 'ヨルシカ'],
        ['夜鹿《花に亡霊》', '花に亡霊', 'ヨルシカ'],
        ['【Hi-Res无损】梁静茹《暖暖》', '暖暖', '梁静茹'],
        ['晴る - Yorushika', '晴る', 'ヨルシカ'],
        ['【米津玄師】Lemon【中日字幕】', 'Lemon', '米津玄師'],
        ['【4K】【中日字幕】晴る-Yorushika', '晴る', 'ヨルシカ'],
        ['ヨルシカ-晴る', '晴る', 'ヨルシカ'],
        ['春泥棒 / 春日大盗 - Yorushika', '春泥棒', 'ヨルシカ'],
        ['ヨルシカ《放晴 / 晴る》', '晴る', 'ヨルシカ'],
        ['Lemon-Kenshi Yonezu', 'Lemon', '米津玄師'],
        ['【中日字幕】Ｋｅｎｓｈｉ　Ｙｏｎｅｚｕ - Lemon', 'Lemon', '米津玄師'],
        ['【爱缪】マリーゴールド【中字】', 'マリーゴールド', 'あいみょん'],
        ['【ずとまよ】秒針を噛む【中日字幕】', '秒針を噛む', 'ずっと真夜中でいいのに。'],
        ['First Love - Hikaru Utada', 'First Love', '宇多田ヒカル'],
        ['晴る Yorushika', '晴る', 'ヨルシカ'],
        ['YOASOBI-アイドル', 'アイドル', 'YOASOBI'],
    ])('extracts credits from %s', (name, title, artist) => {
        const song = video(name);
        const before = structuredClone(song);
        const target = getBilibiliLyricMatchTarget(song);
        expect(target).toMatchObject({ title, artist, album: '', autoMatch: true });
        expect(buildLyricSearchQuery(target.title, target.artist, target.album)).toBe(`${title} - ${artist}`);
        expect(song).toEqual(before);
    });

    it.each(['夜鹿 - 晴る (Live)', 'ヨルシカ - 晴る 翻唱', '好听的日语歌合集', '讲解《晴る》为什么好听'])('leaves ambiguous versions for manual matching: %s', name => {
        expect(getBilibiliLyricMatchTarget(video(name)).autoMatch).toBe(false);
    });

    it('does not use the uploader or video title as music artist/album', () => {
        expect(getBilibiliLyricMatchTarget(video('花に亡霊'))).toMatchObject({ title: '花に亡霊', artist: '', album: '', autoMatch: true, requireUniqueTitleMatch: true });
    });

    it('accepts exact music credits despite video padding, but rejects a different identity or long cut', () => {
        const target = getBilibiliLyricMatchTarget(video('夜鹿 - 晴る'));
        expect(calculateMatchScoreDetails(target, candidate()).score).toBeGreaterThanOrEqual(75);
        expect(calculateMatchScoreDetails({ ...target, durationToleranceMs: 0 }, candidate()).score).toBeLessThan(75);
        expect(calculateMatchScoreDetails(target, candidate('晴る', 'Other artist')).score).toBeLessThan(75);
        expect(calculateMatchScoreDetails({ ...target, durationMs: 400_000 }, candidate()).score).toBeLessThan(75);
    });

    it('recognizes a catalogue title alias and artist alias', () => {
        const target = { title: '晴る', artist: '夜鹿', durationMs: 240_000 };
        expect(calculateMatchScoreDetails(target, { ...candidate('Haru'), aliases: ['晴る'] }).score).toBe(100);
    });

    it('ranks the exact recording above a different cut still inside the video-padding tolerance', () => {
        const target = getBilibiliLyricMatchTarget(video('晴る-Yorushika'));
        expect(calculateMatchScoreDetails(target, { ...candidate(), durationMs: 255_000 }).score)
            .toBeGreaterThan(calculateMatchScoreDetails(target, { ...candidate(), durationMs: 271_000 }).score);
    });

    it('keeps unknown compact hyphens as part of the title', () => {
        expect(getBilibiliLyricMatchTarget(video('Rain-Man'))).toMatchObject({ title: 'Rain-Man', artist: '' });
    });
});
