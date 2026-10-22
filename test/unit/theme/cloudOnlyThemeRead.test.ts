// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pullAiThemeFromCloud, pullCachedThemeByKey, readCloudOnlyTheme } from '@/services/aiThemeCloud';
import { canResolveSongTheme } from '@/services/runtimeConfig';
import type { SongResult } from '@/types';

// Existing cloud themes are opt-in reads, never substitutes for a model generation request.
const state = vi.hoisted(() => ({ enabled: true, entry: vi.fn(), pull: vi.fn(), local: vi.fn(), stage: vi.fn() }));
vi.mock('@/services/foliaCloud', () => ({ isFoliaCloudCacheEnabled: () => state.enabled }));
vi.mock('@/services/aiCloudCache', () => ({ fetchEntry: state.entry, pullAiCloudCache: state.pull, pushAiCloudCache: vi.fn(), fingerprintLyricSource: () => 'b'.repeat(32) }));
vi.mock('@/services/db', () => ({ getFromCache: state.local, saveToCache: vi.fn() }));
vi.mock('@/services/aiStage', () => ({ matchStageResult: state.stage }));
const theme = { light: { backgroundColor: '#ffffff', primaryColor: '#111111' }, dark: { backgroundColor: '#111111', primaryColor: '#ffffff' } };
const request = { song: { title: 'Cloud song', artist: 'Artist', album: null }, require: 'theme' as const, force: true };
beforeEach(() => {
    vi.clearAllMocks(); state.enabled = true;
    state.entry.mockResolvedValue(null); state.local.mockResolvedValue(null);
    state.pull.mockResolvedValue({ status: 'miss' }); state.stage.mockResolvedValue({ status: 'miss' });
});
describe('cloud-only theme reads', () => {
    it('does not read known keys or claim cloud capability while disabled', async () => {
        state.enabled = false;
        expect(await pullCachedThemeByKey('a'.repeat(32))).toBeNull();
        expect(await readCloudOnlyTheme(request)).toEqual({ status: 'unavailable' });
        expect(state.entry).not.toHaveBeenCalled(); expect(state.stage).not.toHaveBeenCalled();
        expect(canResolveSongTheme({ name: 'Title' } as SongResult, null, 'ai')).toBe(false);
    });
    it.each([null, {}, { light: {}, dark: {} }])('does not sanitize malformed hits into a generated-looking default: %j', async payload => {
        state.pull.mockResolvedValue({ status: 'hit', payload });
        expect(await pullAiThemeFromCloud({ title: 'Song' })).toBeNull();
    });
    it('reads a catalogue stage theme by its key without lyrics or a model key', async () => {
        state.entry.mockImplementation(async (kind: string) => kind === 'stage' ? { theme } : null);
        const result = await readCloudOnlyTheme(request, 'a'.repeat(32));
        expect(result.status).toBe('hit'); expect(state.stage).not.toHaveBeenCalled();
        expect(canResolveSongTheme({ name: '', aiCloudThemeKey: 'a'.repeat(32) } as SongResult, null, 'ai')).toBe(true);
    });
    it('keeps local edits ahead of cloud reads and removes manual force for a cache-only lookup', async () => {
        state.local.mockResolvedValue(theme);
        expect((await readCloudOnlyTheme(request, 'a'.repeat(32))).status).toBe('hit');
        expect(state.entry).not.toHaveBeenCalled();
        state.local.mockResolvedValue(null);
        await readCloudOnlyTheme(request);
        expect(state.stage).toHaveBeenCalledWith(expect.objectContaining({ force: false, require: 'theme' }), { backfill: false });
    });
    it('preserves a known-key connection failure without pretending it is a miss', async () => {
        state.entry.mockImplementation(async (_kind: string, _key: string, unavailable: () => void) => { unavailable(); return null; });
        expect(await readCloudOnlyTheme(request, 'a'.repeat(32))).toEqual({ status: 'unavailable' });
        expect(state.stage).not.toHaveBeenCalled(); expect(state.pull).not.toHaveBeenCalled();
    });
});
