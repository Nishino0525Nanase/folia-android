import type { LyricData, OnlineLyricsState, SongResult } from '../../types';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { getOnlineLyricsStateCacheKey } from '../../utils/onlineLyricsState';
import { putCacheEntryIf, readCacheEntry } from '../repositories/cacheRepository';
import { migrateLyricDataRenderHints } from '../../utils/lyrics/renderHints';
import type { AlignmentJob } from './alignmentService';

// Explicit application keeps a recoverable original and rejects a changed lyric selection or a different song.
const keyOf = (song: SongResult) => `lyric_alignment_backup_${getPlaybackSongKey(song)}`;
const lyricIdentity = (lyrics: LyricData | null | undefined) => lyrics?.lines.map(line => [line.fullText, line.startTime, line.endTime, line.translation, line.romanization, line.words]) ?? null;
const identity = (state: OnlineLyricsState | null) => JSON.stringify([state?.lyricsSource ?? null, state?.hasOnlineOverride ?? false,
    lyricIdentity(state?.importedLyrics), lyricIdentity(state?.onlineOverrideLyrics), state?.matchedIsPureMusic ?? null]);
type Backup = { original: OnlineLyricsState; applied: string; offset: number };
export const canApplyAlignment = (job: AlignmentJob): boolean => Boolean(job.result?.lyrics.lines.length
    && (job.result.kind === 'transcribed' || job.result.matchedLines >= 3 && job.result.coverage >= 0.75));
export const applyAudioAlignment = async (job: AlignmentJob, name: string, isCurrent: () => boolean): Promise<boolean> => {
    if (!canApplyAlignment(job) || !isCurrent()) return false;
    const lyrics = migrateLyricDataRenderHints(job.result!.lyrics).value!;
    const next: OnlineLyricsState = { ...job.originalState, lyricsSource: 'imported', importedLyrics: lyrics, importedLyricsName: name };
    const original: OnlineLyricsState = job.originalState?.lyricsSource === 'imported' || job.originalState?.hasOnlineOverride
        ? job.originalState : { ...job.originalState, lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: job.originalLyrics };
    return putCacheEntryIf(getOnlineLyricsStateCacheKey(job.song), next,
        current => isCurrent() && identity(current) === identity(job.originalState),
        [{ key: keyOf(job.song), data: { original, offset: job.originalOffset, applied: identity(next) } satisfies Backup }]);
};
export const restoreAudioAlignment = async (song: SongResult, isCurrent: () => boolean): Promise<{ source: 'online' | 'imported'; offset: number } | null> => {
    const backup = await readCacheEntry<Backup>(keyOf(song));
    if (!backup || !isCurrent()) return null;
    const saved = await putCacheEntryIf(getOnlineLyricsStateCacheKey(song), backup.original,
        current => isCurrent() && identity(current) === backup.applied);
    return saved ? { source: backup.original.lyricsSource, offset: backup.offset } : null;
};
export const hasAlignmentBackup = async (song: SongResult): Promise<boolean> => {
    const [backup, state] = await Promise.all([readCacheEntry<Backup>(keyOf(song)), readCacheEntry<OnlineLyricsState>(getOnlineLyricsStateCacheKey(song))]);
    return Boolean(backup && identity(state) === backup.applied);
};
