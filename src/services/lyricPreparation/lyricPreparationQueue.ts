import type { SongResult } from '../../types';
import type { MediaSubtitleStatus } from '../../types/onlineMusic';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';

// A durable, bounded-concurrency queue shared by imports and collection reads; no player state belongs here.
export type PreparationResult = 'ready' | 'review' | 'unmatched' | 'failed';
export type PreparationOutcome = PreparationResult | { status: PreparationResult; mediaSubtitleStatus?: MediaSubtitleStatus };
export type PreparationEntry = { key: string; song: SongResult; groups: string[];
    status: PreparationResult | 'pending' | 'running' | 'audio-pending' | 'recognizing'; updatedAt: number; audioProgress?: number; mediaSubtitleStatus?: MediaSubtitleStatus; retryAt?: number; retryCount?: number };
export type PreparationSnapshot = { version: 1 | 2 | 3 | 4; paused: boolean; entries: PreparationEntry[] };
type Deps = {
    load: () => Promise<PreparationSnapshot | null>;
    save: (snapshot: PreparationSnapshot) => Promise<void>;
    prepare: (song: SongResult, isCurrent: () => boolean) => Promise<PreparationOutcome>;
    retryUnresolved?: (song: SongResult) => boolean;
    recognize?: (song: SongResult, isCurrent: () => boolean, signal: AbortSignal, progress: (percent: number) => void) => Promise<PreparationResult>;
    canRun: () => boolean;
    canRunSong?: (song: SongResult) => boolean;
    wait: () => Promise<void>;
};

export const createLyricPreparationQueue = (deps: Deps) => {
    let snapshot: PreparationSnapshot = { version: 4, paused: false, entries: [] };
    let initialized: Promise<void> | null = null;
    let writes = Promise.resolve();
    let active = 0;
    let generation = 0;
    let recognition: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const canRunSong = (song: SongResult) => deps.canRunSong?.(song) ?? true;
    const listeners = new Set<() => void>();
    const emit = (persist = true) => {
        snapshot = { ...snapshot, entries: [...snapshot.entries] };
        const saved = snapshot;
        if (persist) writes = writes.catch(() => {}).then(() => deps.save(saved)).catch(error => console.warn('[LyricPreparation] Queue persistence failed', error));
        listeners.forEach(listener => listener());
    };
    const update = (key: string, outcome: PreparationOutcome | PreparationEntry['status']) => {
        const status = typeof outcome === 'string' ? outcome : outcome.status;
        const settled = ['ready', 'review', 'unmatched', 'failed'].includes(status);
        snapshot = { ...snapshot, entries: snapshot.entries.map(entry => {
            if (entry.key !== key) return entry;
            const mediaSubtitleStatus = typeof outcome === 'object' ? outcome.mediaSubtitleStatus : settled ? undefined : entry.mediaSubtitleStatus;
            // Login and provider denial wait for a meaningful event/user retry, never a timer loop.
            const retryable = mediaSubtitleStatus === 'unavailable';
            const retryCount = settled && retryable ? Math.min(3, (entry.retryCount ?? 0) + 1) : entry.retryCount;
            return { ...entry, status, updatedAt: Date.now(), mediaSubtitleStatus,
                retryCount, retryAt: settled ? retryable && (retryCount ?? 0) < 3 ? Date.now() + [60_000, 300_000][(retryCount ?? 1) - 1] : undefined : entry.retryAt,
                audioProgress: status === 'recognizing' ? 0 : entry.audioProgress };
        }) };
        emit();
    };
    const pump = () => {
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
        if (snapshot.paused || !deps.canRun()) { recognition?.abort(); return; }
        let changed = false;
        const entries = snapshot.entries.map(entry => {
            if (!entry.retryAt || entry.retryAt > Date.now() || !canRunSong(entry.song)) return entry;
            changed = true;
            return { ...entry, status: 'pending' as const, retryAt: undefined };
        });
        if (changed) { snapshot = { ...snapshot, entries }; emit(); }
        const nextRetry = snapshot.entries.filter(entry => entry.retryAt && canRunSong(entry.song)).reduce((next, entry) => Math.min(next, entry.retryAt!), Infinity);
        if (Number.isFinite(nextRetry)) retryTimer = setTimeout(pump, Math.max(1, nextRetry - Date.now()));
        // Audio work is a separate serial lane: a slow video cannot hold up text searches or imports.
        const audioEntry = !recognition && deps.recognize && snapshot.entries.find(item => item.status === 'audio-pending' && canRunSong(item.song));
        if (audioEntry) {
            const task = new AbortController(); recognition = task;
            const started = generation;
            const current = () => !task.signal.aborted && started === generation && !snapshot.paused && deps.canRun();
            update(audioEntry.key, 'recognizing');
            void (async () => {
                let result: PreparationResult = 'failed';
                try { result = await deps.recognize!(audioEntry.song, current, task.signal, percent => {
                    if (!current() || !Number.isFinite(percent)) return;
                    snapshot = { ...snapshot, entries: snapshot.entries.map(entry => entry.key === audioEntry.key
                        ? { ...entry, audioProgress: Math.max(0, Math.min(100, Math.round(percent))) } : entry) };
                    emit(false);
                }); } catch (error) { if (!task.signal.aborted) console.warn('[LyricPreparation] Audio recognition failed', error); }
                update(audioEntry.key, current() ? result : 'audio-pending');
                try { await deps.wait(); } catch (error) { console.warn('[LyricPreparation] Queue delay failed', error); }
                finally { recognition = null; pump(); }
            })();
        }
        while (active < 2) {
            const entry = snapshot.entries.find(item => item.status === 'pending' && canRunSong(item.song));
            if (!entry) return;
            const started = generation;
            active++;
            update(entry.key, 'running');
            const current = () => started === generation && !snapshot.paused && deps.canRun() && canRunSong(entry.song);
            void (async () => {
                let result: PreparationOutcome = 'failed';
                try { result = await deps.prepare(entry.song, current); }
                catch (error) { console.warn('[LyricPreparation] Song matching failed', error); }
                update(entry.key, current() ? deps.recognize && (typeof result === 'string' ? result : result.status) !== 'ready' ? 'audio-pending' : result : 'pending');
                pump();
                try { await deps.wait(); } catch (error) { console.warn('[LyricPreparation] Queue delay failed', error); }
                finally { active--; pump(); }
            })();
        }
    };
    const initialize = () => initialized ??= (async () => {
        const saved = await deps.load().catch(() => null);
        if ((saved?.version === 1 || saved?.version === 2 || saved?.version === 3 || saved?.version === 4) && Array.isArray(saved.entries)) {
            snapshot = { version: 4, paused: saved.paused === true, entries: saved.entries.filter(entry =>
                entry && typeof entry.key === 'string' && entry.song?.sourceRef?.kind === 'online'
                && Array.isArray(entry.groups) && ['pending', 'running', 'ready', 'review', 'unmatched', 'failed', 'audio-pending', 'recognizing'].includes(entry.status)
            ).map(entry => ({ ...entry, audioProgress: undefined, status: saved.version < 4 && deps.retryUnresolved?.(entry.song) && ['review', 'unmatched', 'failed'].includes(entry.status) ? 'pending'
                : entry.status === 'running' ? 'pending'
                : entry.status === 'recognizing' || entry.status === 'audio-pending' ? deps.recognize ? 'audio-pending' : 'pending'
                : saved.version === 1 && deps.recognize && ['review', 'unmatched', 'failed'].includes(entry.status) ? 'audio-pending' : entry.status })) };
        }
        emit();
        pump();
    })();
    return {
        initialize,
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        async enqueue(songs: SongResult[], group: string) {
            await initialize();
            const entries = new Map(snapshot.entries.map(entry => [entry.key, entry]));
            let changed = false;
            for (const song of songs) {
                if (song.sourceRef?.kind !== 'online') continue;
                const key = getPlaybackSongKey(song);
                const existing = entries.get(key);
                if (existing) {
                    if (!existing.groups.includes(group)) {
                        entries.set(key, { ...existing, groups: [...existing.groups, group] }); changed = true;
                    }
                    continue;
                }
                // Only display metadata and stable media identity are persisted, never temporary media URLs.
                const stored: SongResult = { id: song.id, name: song.name, artists: song.artists, album: song.album,
                    durationMs: song.durationMs, sourceRef: song.sourceRef };
                entries.set(key, { key, song: stored, groups: [group], status: 'pending', updatedAt: Date.now() });
                changed = true;
            }
            if (changed) { snapshot = { ...snapshot, entries: [...entries.values()] }; emit(); }
            pump();
        },
        togglePause() { generation++; recognition?.abort(); snapshot = { ...snapshot, paused: !snapshot.paused }; emit(); pump(); },
        retry(group: string) {
            snapshot = { ...snapshot, paused: false, entries: snapshot.entries.map(entry => entry.groups.includes(group)
                && (['unmatched', 'failed', 'review'].includes(entry.status) || ['login-required', 'unavailable', 'refused', 'invalid'].includes(entry.mediaSubtitleStatus ?? ''))
                && entry.status !== 'running' ? { ...entry, status: 'pending', retryAt: undefined, retryCount: 0 } : entry) };
            emit(); pump();
        },
        retrySubtitleLookups(providerId?: string) {
            let changed = false;
            const entries = snapshot.entries.map(entry => {
                if (entry.song.sourceRef?.kind !== 'online' || (providerId && entry.song.sourceRef.providerId !== providerId)
                    || !(providerId ? ['login-required', 'unavailable', 'refused'] : ['unavailable', 'refused']).includes(entry.mediaSubtitleStatus ?? '') || entry.status === 'running') return entry;
                changed = true;
                return { ...entry, status: 'pending' as const, retryAt: undefined, retryCount: 0 };
            });
            if (changed) { snapshot = { ...snapshot, entries }; emit(); }
            pump();
        },
        wake: pump,
        flush: () => writes,
    };
};
