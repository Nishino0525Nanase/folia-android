import type { LyricData, SongResult } from '../types';
import { isFoliaCloudCacheEnabled } from './foliaCloud';

// 当前文件：读取 Docker 注入的 Web 运行时配置，并兼容既有 Vite 构建变量。

export type WebAiProvider = 'gemini' | 'openai';

const normalizeAiProvider = (value: unknown): WebAiProvider => (
    value === 'openai' ? 'openai' : 'gemini'
);

export const getWebAiProvider = (): WebAiProvider => {
    if (typeof window !== 'undefined') {
        const runtimeValue = window.__FOLIA_RUNTIME_CONFIG__?.aiProvider;
        if (runtimeValue) return normalizeAiProvider(runtimeValue);
    }

    return normalizeAiProvider(import.meta.env.VITE_AI_PROVIDER);
};

/** Existing cloud themes can be selected by title or a catalogue key without lyrics. */
export const canResolveSongTheme = (song: SongResult | null, lyrics: LyricData | null, source: 'ai' | 'cover'): boolean => Boolean(
    (source === 'cover' && song) || lyrics?.lines.length || song?.isPureMusic
    || (isFoliaCloudCacheEnabled() && (song?.name?.trim() || song?.aiCloudThemeKey)),
);
