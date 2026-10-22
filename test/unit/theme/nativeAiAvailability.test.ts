// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeController } from '@/hooks/useThemeController';
import { DEFAULT_AI_SETTINGS, isAiConfigured, writeAiSettings } from '@/services/aiSettings';
import { updateFoliaCloudSettings } from '@/services/foliaCloud';
import { readStoredThemeGenerationSource } from '@/services/themePreferences';
import { FALLBACK_AI_DUAL_THEME } from '@/services/themeSanitizer';
import type { LyricData, SongResult } from '@/types';

// Native credentials must gate real generation without affecting cover themes or later configured use.
const effects = vi.hoisted(() => ({ generate: vi.fn(), status: vi.fn(), cloudRead: vi.fn() }));
vi.mock('@/platform/runtime', () => ({ isCapacitorAndroid: () => true }));
vi.mock('@/services/gemini', () => ({ generateThemeFromLyrics: effects.generate, isMissingAiApiKeyError: () => false }));
vi.mock('@/services/aiStage', () => ({ notifyStageResolved: vi.fn() }));
vi.mock('@/services/db', () => ({ saveToCache: async () => {}, getFromCache: async () => null }));
vi.mock('@/services/themeCache', () => ({ getLastDualTheme: async () => null, getLastLegacyTheme: async () => null }));
vi.mock('@/services/sync/syncRepository', () => ({ saveSyncedThemeForSong: async () => {} }));
vi.mock('@/services/aiThemeCloud', () => ({
    readCloudOnlyTheme: effects.cloudRead,
    pullAiThemeFromCloud: async () => null, pullCachedThemeByKey: async () => null,
    writeLocalAiThemeOverride: async () => {}, readLocalAiThemeOverride: async () => null,
}));
vi.mock('@/stores/useStatusMessageStore', () => ({ setStatusMessage: effects.status }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let controller: ReturnType<typeof useThemeController>;
const song = (id: number) => ({ id, name: 'Test song', artists: [{ name: 'Test artist' }] } as SongResult);
const lyrics = { lines: [{ fullText: 'Test lyric' }] } as LyricData;
function Harness() {
    controller = useThemeController({
        defaultTheme: FALLBACK_AI_DUAL_THEME.dark, daylightTheme: FALLBACK_AI_DUAL_THEME.light,
        isDaylight: false, setDaylightPreference: () => {}, t: key => key,
    });
    return null;
}
beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    updateFoliaCloudSettings({ enabled: false });
    effects.cloudRead.mockResolvedValue({ status: 'hit', theme: FALLBACK_AI_DUAL_THEME });
    effects.generate.mockResolvedValue({ theme: FALLBACK_AI_DUAL_THEME, source: 'generated' });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('native theme generation availability', () => {
    it('uses cover themes quietly with no key and enables AI after the selected provider is configured', async () => {
        localStorage.setItem('theme_generation_source', 'ai');
        expect(readStoredThemeGenerationSource()).toBe('cover');
        await act(async () => root.render(createElement(Harness)));
        expect(controller.themeGenerationSource).toBe('cover');
        await act(async () => { await controller.generateAITheme(null, song(1), { source: 'auto' }); });
        expect(effects.generate).not.toHaveBeenCalled();
        expect(effects.status).not.toHaveBeenCalled();

        await act(async () => { writeAiSettings({ provider: 'gemini', geminiApiKey: 'fixture-key' }); });
        await act(async () => controller.handleThemeGenerationSourceChange('ai'));
        expect(controller.themeGenerationSource).toBe('ai');
        effects.status.mockClear();
        await act(async () => { await controller.generateAITheme(lyrics, song(2), { source: 'auto' }); });
        expect(effects.generate).toHaveBeenCalledOnce();
        expect(effects.status).toHaveBeenCalledWith(expect.objectContaining({ text: 'status.generatingTheme' }));

        await act(async () => { writeAiSettings({ geminiApiKey: '  ' }); });
        expect(controller.themeGenerationSource).toBe('cover');
        effects.status.mockClear();
        await act(async () => { await controller.generateAITheme(null, song(3), { source: 'auto' }); });
        expect(effects.generate).toHaveBeenCalledOnce();
        expect(effects.status).not.toHaveBeenCalled();
    });

    it('reads an enabled cloud theme without a key or lyrics even for manual force', async () => {
        updateFoliaCloudSettings({ enabled: true });
        localStorage.setItem('theme_generation_source', 'ai');
        await act(async () => root.render(createElement(Harness)));
        expect(controller.themeGenerationSource).toBe('ai');
        await act(async () => { await controller.generateAITheme(null, { ...song(4), aiCloudThemeKey: 'a'.repeat(32) }, { source: 'manual', force: true }); });
        expect(effects.cloudRead).toHaveBeenCalledWith(expect.objectContaining({ require: 'theme', lines: [] }), 'a'.repeat(32));
        expect(effects.generate).not.toHaveBeenCalled();
        expect(effects.status).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'status.generatingTheme' }));
    });

    it.each(['miss', 'unavailable'] as const)('uses cover colours with accurate manual %s feedback and no model request', async status => {
        updateFoliaCloudSettings({ enabled: true });
        localStorage.setItem('theme_generation_source', 'ai');
        effects.cloudRead.mockResolvedValue({ status });
        await act(async () => root.render(createElement(Harness)));
        await act(async () => { await controller.generateAITheme(null, song(5), { source: 'manual' }); });
        expect(effects.generate).not.toHaveBeenCalled();
        expect(effects.status).toHaveBeenCalledWith({ type: 'info', text: status === 'miss' ? 'status.cloudThemeMissCover' : 'status.cloudThemeUnavailableCover' });
        effects.status.mockClear();
        await act(async () => { await controller.generateAITheme(null, song(6), { source: 'auto' }); });
        expect(effects.status).not.toHaveBeenCalled();
    });

    it('discards a cloud response if cloud consent changes while it is pending', async () => {
        updateFoliaCloudSettings({ enabled: true });
        localStorage.setItem('theme_generation_source', 'ai');
        let resolveCloud!: (value: unknown) => void;
        effects.cloudRead.mockImplementation(() => new Promise(resolve => { resolveCloud = resolve; }));
        await act(async () => root.render(createElement(Harness)));
        let pending!: ReturnType<typeof controller.generateAITheme>;
        await act(async () => { pending = controller.generateAITheme(null, song(7), { source: 'manual' }); });
        await act(async () => { updateFoliaCloudSettings({ enabled: false }); });
        let result: unknown;
        await act(async () => { resolveCloud({ status: 'hit', theme: FALLBACK_AI_DUAL_THEME }); result = await pending; });
        expect(result).toEqual({ status: 'generated', applied: false });
        expect(effects.generate).not.toHaveBeenCalled();
        expect(controller.themeGenerationSource).toBe('cover');
    });

    it('checks the selected provider rather than another saved key or a hosted deployment flag', () => {
        expect(isAiConfigured({ ...DEFAULT_AI_SETTINGS, provider: 'deepseek', geminiApiKey: 'unused', deepseekApiKey: ' ' })).toBe(false);
        expect(isAiConfigured({ ...DEFAULT_AI_SETTINGS, provider: 'deepseek', deepseekApiKey: ' fixture ' })).toBe(true);
        expect(isAiConfigured({ ...DEFAULT_AI_SETTINGS, provider: 'openai', openaiApiKey: ' fixture ' })).toBe(true);
    });
});
