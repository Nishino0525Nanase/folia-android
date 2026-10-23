import type { Line, LyricData } from '../../types';

// Align known lyric text to recognized words in order. Only acoustically anchored lines are returned.
export type TimedWord = { text: string; start: number; end: number };
export type AlignmentResult = { lyrics: LyricData; matchedLines: number; totalLines: number; coverage: number; kind: 'aligned' | 'transcribed' };
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const cleanWords = (words: TimedWord[], duration: number) => words.filter(word => word.text.trim()
    && Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= 0 && word.end > word.start
    && word.end <= duration + 0.5).sort((a, b) => a.start - b.start);
const timedLine = (line: Line, start: number, end: number): Line => ({
    fullText: line.fullText, translation: line.translation, romanization: line.romanization,
    id: line.id, startTime: start, endTime: end,
    words: [{ text: line.fullText, startTime: start, endTime: end }],
});

export const alignLyricsToWords = (lyrics: LyricData, input: TimedWord[], duration: number): AlignmentResult => {
    const words = cleanWords(input, duration);
    const target: { char: string; line: number }[] = [];
    const lengths = lyrics.lines.map((line, index) => {
        const chars = Array.from(normalize(line.fullText));
        chars.forEach(char => target.push({ char, line: index }));
        return chars.length;
    });
    const heard = words.flatMap((word, index) => Array.from(normalize(word.text)).map(char => ({ char, word: index })));
    const n = target.length, m = heard.length;
    if (!n || !m || n > 8000 || m > 12000 || n * m > 40_000_000) throw new Error('alignment-size');
    // Weighted monotonic sequence alignment: insertion/deletion handles intros, repeats and recognition errors.
    const width = m + 1;
    const trace = new Uint8Array((n + 1) * width);
    let previous = new Float32Array(width), current = new Float32Array(width);
    for (let i = 1; i <= n; i++) {
        current[0] = -i;
        for (let j = 1; j <= m; j++) {
            const same = target[i - 1].char === heard[j - 1].char;
            const diagonal = previous[j - 1] + (same ? 3 : -2);
            const skipTarget = previous[j] - 1, skipHeard = current[j - 1] - 1;
            const direction = diagonal >= skipTarget && diagonal >= skipHeard ? 1 : skipTarget >= skipHeard ? 2 : 3;
            current[j] = direction === 1 ? diagonal : direction === 2 ? skipTarget : skipHeard;
            trace[i * width + j] = direction;
        }
        [previous, current] = [current, previous];
    }
    let j = 0;
    for (let k = 1; k <= m; k++) if (previous[k] > previous[j]) j = k;
    let i = n;
    const matches: { targetIndex: number; word: number }[][] = lyrics.lines.map(() => []);
    while (i > 0 && j > 0) {
        const direction = trace[i * width + j];
        if (direction === 1) {
            if (target[i - 1].char === heard[j - 1].char) matches[target[i - 1].line].push({ targetIndex: i - 1, word: heard[j - 1].word });
            i--; j--;
        } else if (direction === 2) i--; else j--;
    }
    let offset = 0, lastEnd = 0;
    const lines = lyrics.lines.flatMap((line, index) => {
        const hits = matches[index].reverse(), length = lengths[index], base = offset;
        offset += length;
        if (length < 3 || hits.length < Math.max(3, Math.ceil(length * 0.75))) return [];
        // A partial middle phrase does not establish either boundary of a whole lyric line.
        if (hits[0].targetIndex - base > Math.floor(length * 0.15)
            || base + length - 1 - hits.at(-1)!.targetIndex > Math.floor(length * 0.15)) return [];
        const start = words[hits[0].word].start, end = words[hits.at(-1)!.word].end;
        if (start < lastEnd - 0.15 || end - start > 30 || end - start < 0.1) return [];
        lastEnd = end;
        return [timedLine(line, start, end)];
    });
    const totalLines = lengths.filter(length => length >= 3).length;
    return { lyrics: { title: lyrics.title, artist: lyrics.artist, isWordByWord: false, lines },
        matchedLines: lines.length, totalLines, coverage: totalLines ? lines.length / totalLines : 0, kind: 'aligned' };
};

export const wordsToSubtitle = (input: TimedWord[], duration: number): AlignmentResult => {
    const words = cleanWords(input, duration);
    const lines: Line[] = [];
    let group: TimedWord[] = [];
    const flush = () => {
        if (!group.length) return;
        const text = group.map(word => word.text).join('').trim();
        if (normalize(text).length >= 2) lines.push({ fullText: text, startTime: group[0].start, endTime: group.at(-1)!.end,
            words: group.map(word => ({ text: word.text, startTime: word.start, endTime: word.end })) });
        group = [];
    };
    for (const word of words) {
        if (group.length && (word.start - group.at(-1)!.end > 0.7 || word.end - group[0].start > 7)) flush();
        group.push(word);
    }
    flush();
    return { lyrics: { lines, isWordByWord: true }, matchedLines: lines.length, totalLines: lines.length, coverage: 0, kind: 'transcribed' };
};
