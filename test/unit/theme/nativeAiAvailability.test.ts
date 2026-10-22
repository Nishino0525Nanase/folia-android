// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeController } from '@/hooks/useThemeController';
import { DEFAULT_AI_SETTINGS, isAiConfigured, writeAiSettings } from '@/services/aiSettings';
import { readStoredThemeGenerationSource } from '@/services/themePreferences';
import { FALLBACK_AI_DUAL_THEME } from '@/services/themeSanitizer';
import type { LyricData, SongResult } from '@/types';

// Native credentials must gate real generation without affecting cover themes or later configured use.
const effects = vi.hoisted(() => ({ generate: vi.fn(), status: vi.fn() }));
vi.mock('@/platform/runtime', () => ({ isCapacitorAndroid: () => true }));
vi.mock('@/services/gemini', () => ({ generateThemeFromLyrics: effects.generate, isMissingAiApiKeyError: () => false }));
vi.mock('@/services/aiStage', () => ({ notifyStageResolved: vi.fn() }));
vi.mock('@/services/db', () => ({ saveToCache: async () => {}, getFromCache: async () => null }));
vi.mock('@/services/themeCache', () => ({ getLastDualTheme: async () => null, getLastLegacyTheme: async () => null }));
vi.mock('@/services/sync/syncRepository', () => ({ saveSyncedThemeForSong: async () => {} }));
vi.mock('@/services/aiThemeCloud', () => ({
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

    it('checks the selected provider rather than another saved key or a hosted deployment flag', () => {
        expect(isAiConfigured({ ...DEFAULT_AI_SETTINGS, provider: 'deepseek', geminiApiKey: 'unused', deepseekApiKey: ' ' })).toBe(false);
        expect(isAiConfigured({ ...DEFAULT_AI_SETTINGS, provider: 'deepseek', deepseekApiKey: ' fixture ' })).toBe(true);
        expect(isAiConfigured({ ...DEFAULT_AI_SETTINGS, provider: 'openai', openaiApiKey: ' fixture ' })).toBe(true);
    });
});
