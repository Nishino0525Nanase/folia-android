import type { SongResult } from '../../types';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';

// A durable, bounded-concurrency queue shared by imports and collection reads; no player state belongs here.
export type PreparationResult = 'ready' | 'review' | 'unmatched' | 'failed';
export type PreparationEntry = { key: string; song: SongResult; groups: string[];
    status: PreparationResult | 'pending' | 'running' | 'audio-pending' | 'recognizing'; updatedAt: number; audioProgress?: number };
export type PreparationSnapshot = { version: 1 | 2; paused: boolean; entries: PreparationEntry[] };
type Deps = {
    load: () => Promise<PreparationSnapshot | null>;
    save: (snapshot: PreparationSnapshot) => Promise<void>;
    prepare: (song: SongResult, isCurrent: () => boolean) => Promise<PreparationResult>;
    recognize?: (song: SongResult, isCurrent: () => boolean, signal: AbortSignal, progress: (percent: number) => void) => Promise<PreparationResult>;
    canRun: () => boolean;
    wait: () => Promise<void>;
};

export const createLyricPreparationQueue = (deps: Deps) => {
    let snapshot: PreparationSnapshot = { version: 2, paused: false, entries: [] };
    let initialized: Promise<void> | null = null;
    let writes = Promise.resolve();
    let active = 0;
    let generation = 0;
    let recognition: AbortController | null = null;
    const listeners = new Set<() => void>();
    const emit = (persist = true) => {
        snapshot = { ...snapshot, entries: [...snapshot.entries] };
        const saved = snapshot;
        if (persist) writes = writes.catch(() => {}).then(() => deps.save(saved)).catch(error => console.warn('[LyricPreparation] Queue persistence failed', error));
        listeners.forEach(listener => listener());
    };
    const update = (key: string, status: PreparationEntry['status']) => {
        snapshot = { ...snapshot, entries: snapshot.entries.map(entry => entry.key === key
            ? { ...entry, status, updatedAt: Date.now(), audioProgress: status === 'recognizing' ? 0 : entry.audioProgress } : entry) };
        emit();
    };
    const pump = () => {
        if (snapshot.paused || !deps.canRun()) { recognition?.abort(); return; }
        // Audio work is a separate serial lane: a slow video cannot hold up text searches or imports.
        const audioEntry = !recognition && deps.recognize && snapshot.entries.find(item => item.status === 'audio-pending');
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
            const entry = snapshot.entries.find(item => item.status === 'pending');
            if (!entry) return;
            const started = generation;
            active++;
            update(entry.key, 'running');
            const current = () => started === generation && !snapshot.paused && deps.canRun();
            void (async () => {
                let result: PreparationResult = 'failed';
                try { result = await deps.prepare(entry.song, current); }
                catch (error) { console.warn('[LyricPreparation] Song matching failed', error); }
                update(entry.key, current() ? deps.recognize && result !== 'ready' ? 'audio-pending' : result : 'pending');
                pump();
                try { await deps.wait(); } catch (error) { console.warn('[LyricPreparation] Queue delay failed', error); }
                finally { active--; pump(); }
            })();
        }
    };
    const initialize = () => initialized ??= (async () => {
        const saved = await deps.load().catch(() => null);
        if ((saved?.version === 1 || saved?.version === 2) && Array.isArray(saved.entries)) {
            snapshot = { version: 2, paused: saved.paused === true, entries: saved.entries.filter(entry =>
                entry && typeof entry.key === 'string' && entry.song?.sourceRef?.kind === 'online'
                && Array.isArray(entry.groups) && ['pending', 'running', 'ready', 'review', 'unmatched', 'failed', 'audio-pending', 'recognizing'].includes(entry.status)
            ).map(entry => ({ ...entry, audioProgress: undefined, status: entry.status === 'running' ? 'pending'
                : entry.status === 'recognizing' ? 'audio-pending'
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
                && ['unmatched', 'failed', 'review'].includes(entry.status) ? { ...entry, status: 'pending' } : entry) };
            emit(); pump();
        },
        wake: pump,
        flush: () => writes,
    };
};
