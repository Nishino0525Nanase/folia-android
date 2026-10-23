import type { LyricData, SongResult } from '../../types';
import { toSafePlaybackUrl } from '../../utils/appPlaybackHelpers';
import { hasAuthoritativeOnlineLyricsSelection, loadOnlineLyricsState, savePreparedOnlineLyrics } from '../../utils/onlineLyricsState';
import { writeLyricOffset } from '../../utils/lyrics/lyricOffsetMemory';
import { omni } from '../onlineMusic/omni';
import { readAlignmentAudio } from '../lyricAlignment/alignmentAudio';
import { inferAlignment } from '../lyricAlignment/alignmentService';
import type { PreparationResult } from './lyricPreparationQueue';
import { AUTOMATIC_SUBTITLES_NAME } from '../../utils/lyrics/automaticSubtitleIdentity';
export { AUTOMATIC_SUBTITLES_NAME } from '../../utils/lyrics/automaticSubtitleIdentity';

// Import fallback reads the original media, creates timed subtitles, and commits only to an unset lyric selection.
export const usableAutomaticSubtitles = (lyrics: LyricData, duration: number): boolean => {
    const lines = lyrics.lines;
    if (lines.length < 2 || !Number.isFinite(duration) || duration <= 0) return false;
    let end = 0;
    for (const line of lines) {
        if (!Number.isFinite(line.startTime) || !Number.isFinite(line.endTime) || line.startTime < end - 0.15
            || line.startTime < 0 || line.endTime <= line.startTime || line.endTime > duration + 0.5 || line.endTime - line.startTime > 30) return false;
        end = line.endTime;
    }
    const texts = lines.map(line => line.fullText.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase());
    return texts.join('').length >= 12 && new Set(texts.filter(Boolean)).size >= 2
        && end - lines[0].startTime >= Math.min(5, duration * 0.05);
};

export const recognizeMissingLyrics = async (song: SongResult, isCurrent: () => boolean, signal: AbortSignal, progress: (percent: number) => void): Promise<PreparationResult> => {
    if (hasAuthoritativeOnlineLyricsSelection(await loadOnlineLyricsState(song))) return 'ready';
    if (!isCurrent() || signal.aborted) return 'failed';
    if (song.durationMs > 900_000) return 'unmatched';
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 20 * 60_000);
    let closed = false;
    const current = () => !closed && !controller.signal.aborted && isCurrent();
    const work = async (): Promise<PreparationResult> => {
        const source = await omni.getAudioSource(song, 'standard', { signal: controller.signal });
        if (!current() || !source?.url || source.preview) return 'failed';
        const url = toSafePlaybackUrl(source.url);
        if (!url) return 'failed';
        const samples = await readAlignmentAudio(song, url, controller.signal);
        if (!current()) return 'failed';
        const duration = samples.length / 16000;
        const result = await inferAlignment({ samples, lyrics: null, language: 'auto' }, controller.signal,
            value => { if (value.phase === 'recognizing' && value.progress !== undefined) progress(value.progress); });
        if (!current() || !usableAutomaticSubtitles(result.lyrics, duration)) return 'unmatched';
        const saved = await savePreparedOnlineLyrics(song, { lyricsSource: 'imported', importedLyrics: result.lyrics,
            importedLyricsName: AUTOMATIC_SUBTITLES_NAME }, current);
        // These timestamps come from this recording; a correction saved for an older lyric file must not shift them.
        if (saved) writeLyricOffset(song.id, 0);
        return saved || hasAuthoritativeOnlineLyricsSelection(await loadOnlineLyricsState(song)) ? 'ready' : 'failed';
    };
    let aborted = () => {};
    try {
        const cancelled = new Promise<PreparationResult>(resolve => {
            aborted = () => resolve('failed');
            controller.signal.addEventListener('abort', aborted, { once: true });
        });
        return await Promise.race([work(), cancelled]);
    } finally {
        closed = true; clearTimeout(timeout); signal.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', aborted);
    }
};
