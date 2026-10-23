// Whisper identifies language from the first decoder step, restricted to its language tokens.
export const languageFromLogits = (logits: ArrayLike<number>, tokens: Record<string, number>): string => {
    let best = -Infinity, language = '';
    for (const [token, index] of Object.entries(tokens)) {
        const match = /^<\|([a-z]{2,3})\|>$/.exec(token);
        const score = logits[index];
        if (match && Number.isFinite(score) && score > best) {
            best = score; language = match[1];
        }
    }
    if (!language) throw new Error('language-detection-failed');
    return language;
};
