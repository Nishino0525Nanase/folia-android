import { describe, expect, it } from 'vitest';
import { languageFromLogits } from '../../../src/services/lyricAlignment/languageDetection';

// A strong ordinary text token must not override the detected language token.
describe('audio language detection', () => {
    it('selects Japanese, English and Chinese from only valid language tokens', () => {
        const tokens = { '<|en|>': 1, '<|ja|>': 2, '<|zh|>': 3, '<|transcribe|>': 0 };
        expect(languageFromLogits([100, 2, 8, 4], tokens)).toBe('ja');
        expect(languageFromLogits([100, 8, 2, 4], tokens)).toBe('en');
        expect(languageFromLogits([100, 2, 4, 8], tokens)).toBe('zh');
    });
    it('rejects missing or corrupt scores instead of silently forcing English', () => {
        expect(() => languageFromLogits([], { '<|en|>': 1 })).toThrow('language-detection-failed');
        expect(() => languageFromLogits([NaN, Infinity], { '<|en|>': 0, '<|ja|>': 1 })).toThrow();
    });
});
