import type { SongResult } from '../../types';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';

// A durable, bounded-concurrency queue shared by imports and collection reads; no player state belongs here.
export type PreparationResult = 'ready' | 'review' | 'unmatched' | 'failed';
export type PreparationEntry = { key: string; song: SongResult; groups: string[];
    status: PreparationResult | 'pending' | 'running'; updatedAt: number };
export type PreparationSnapshot = { version: 1; paused: boolean; entries: PreparationEntry[] };
type Deps = {
    load: () => Promise<PreparationSnapshot | null>;
    save: (snapshot: PreparationSnapshot) => Promise<void>;
    prepare: (song: SongResult, isCurrent: () => boolean) => Promise<PreparationResult>;
    canRun: () => boolean;
    wait: () => Promise<void>;
};

export const createLyricPreparationQueue = (deps: Deps) => {
    let snapshot: PreparationSnapshot = { version: 1, paused: false, entries: [] };
    let initialized: Promise<void> | null = null;
    let writes = Promise.resolve();
    let active = 0;
    let generation = 0;
    const listeners = new Set<() => void>();
    const emit = () => {
        snapshot = { ...snapshot, entries: [...snapshot.entries] };
        const saved = snapshot;
        writes = writes.catch(() => {}).then(() => deps.save(saved)).catch(error => console.warn('[LyricPreparation] Queue persistence failed', error));
        listeners.forEach(listener => listener());
    };
    const update = (key: string, status: PreparationEntry['status']) => {
        snapshot = { ...snapshot, entries: snapshot.entries.map(entry => entry.key === key ? { ...entry, status, updatedAt: Date.now() } : entry) };
        emit();
    };
    const pump = () => {
        if (snapshot.paused || !deps.canRun()) return;
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
                update(entry.key, current() ? result : 'pending');
                try { await deps.wait(); } catch (error) { console.warn('[LyricPreparation] Queue delay failed', error); }
                finally { active--; pump(); }
            })();
        }
    };
    const initialize = () => initialized ??= (async () => {
        const saved = await deps.load().catch(() => null);
        if (saved?.version === 1 && Array.isArray(saved.entries)) {
            snapshot = { version: 1, paused: saved.paused === true, entries: saved.entries.filter(entry =>
                entry && typeof entry.key === 'string' && entry.song?.sourceRef?.kind === 'online'
                && Array.isArray(entry.groups) && ['pending', 'running', 'ready', 'review', 'unmatched', 'failed'].includes(entry.status)
            ).map(entry => ({ ...entry, status: entry.status === 'running' ? 'pending' : entry.status })) };
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
        togglePause() { generation++; snapshot = { ...snapshot, paused: !snapshot.paused }; emit(); pump(); },
        retry(group: string) {
            snapshot = { ...snapshot, paused: false, entries: snapshot.entries.map(entry => entry.groups.includes(group)
                && ['unmatched', 'failed', 'review'].includes(entry.status) ? { ...entry, status: 'pending' } : entry) };
            emit(); pump();
        },
        wake: pump,
        flush: () => writes,
    };
};
