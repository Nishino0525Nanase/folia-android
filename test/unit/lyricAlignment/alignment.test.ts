import { describe, expect, it } from 'vitest';
import type { LyricData } from '@/types';
import { alignLyricsToWords, wordsToSubtitle, type TimedWord } from '@/services/lyricAlignment/alignment';

// Real alignment invariants: timing comes from recognized audio, not the catalogue's old offsets.
const lyrics = (texts: string[]): LyricData => ({ isWordByWord: true, lines: texts.map((fullText, index) => ({
    fullText, startTime: index * 2, endTime: index * 2 + 1, translation: `translation ${index}`,
    words: [{ text: fullText, startTime: index * 2, endTime: index * 2 + 1 }],
})) });
const words = (texts: string[], starts: number[]): TimedWord[] => texts.map((text, index) => ({ text, start: starts[index], end: starts[index] + 2 }));
describe('audio-derived lyric alignment', () => {
    it('corrects a varying offset and preserves translations without retaining false word timestamps', () => {
        const text = ['春の風が吹いた', '遠い空を見上げた', '明日の夢を描こう'];
        const result = alignLyricsToWords(lyrics(text), words(text, [8, 25, 42]), 60);
        expect(result.coverage).toBe(1);
        expect(result.lyrics.lines.map(line => line.startTime)).toEqual([8, 25, 42]);
        expect(result.lyrics.lines[1].translation).toBe('translation 1');
        expect(result.lyrics.isWordByWord).toBe(false);
        expect(result.lyrics.lines[1].words).toEqual([{ text: text[1], startTime: 25, endTime: 27 }]);
    });
    it('keeps repeated choruses in performance order despite an unrelated spoken intro', () => {
        const text = ['朝の光が輝く', '君の声を聞いた', '朝の光が輝く'];
        const result = alignLyricsToWords(lyrics(text), words(['welcome everyone', ...text], [1, 10, 23, 41]), 60);
        expect(result.lyrics.lines.map(line => line.startTime)).toEqual([10, 23, 41]);
    });
    it('does not invent timing for missing lyrics or accept a middle-only phrase as a whole line', () => {
        const result = alignLyricsToWords(lyrics(['abcdef', 'missing words', 'uvwxyz']), words(['abcdef', 'uvwxyz'], [10, 40]), 60);
        expect(result.matchedLines).toBe(2);
        expect(result.totalLines).toBe(3);
        expect(result.lyrics.lines.map(line => line.startTime)).toEqual([10, 40]);
        expect(alignLyricsToWords(lyrics(['abcdefghij']), words(['bcdefghi'], [2]), 10).matchedLines).toBe(1);
        expect(alignLyricsToWords(lyrics(['abcdefghij']), words(['cdefghij'], [2]), 10).matchedLines).toBe(0);
    });
    it('rejects unrelated lyrics and invalid or out-of-range recognized words', () => {
        expect(alignLyricsToWords(lyrics(['雪の降る街を歩く']), words(['abcdefghi'], [2]), 10).coverage).toBe(0);
        const invalid = [{ text: 'hello', start: NaN, end: 2 }, { text: 'hello', start: 1, end: Infinity }, { text: 'hello', start: 9, end: 12 }];
        expect(wordsToSubtitle(invalid, 10).lyrics.lines).toEqual([]);
        expect(() => alignLyricsToWords(lyrics(['abc']), [], 10)).toThrow('alignment-size');
        expect(() => alignLyricsToWords(lyrics(['a'.repeat(8001)]), words(['abc'], [0]), 10)).toThrow('alignment-size');
    });
    it('generates explicitly machine-derived subtitles when no lyric text is available', () => {
        const result = wordsToSubtitle([{ text: 'Hello', start: 1, end: 1.5 }, { text: ' world', start: 1.5, end: 2 }, { text: 'Again', start: 5, end: 6 }], 10);
        expect(result.kind).toBe('transcribed');
        expect(result.lyrics.lines.map(line => [line.fullText, line.startTime])).toEqual([['Hello world', 1], ['Again', 5]]);
    });
});
