import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from '../providerStorage';

// src/services/onlineMusic/bilibili/bilibiliSession.ts
// Only a sealed backend bearer is kept here. Platform cookies never enter the renderer.
const SESSION_KEY = 'sealed_session_v1';
let generation = 0;

export const getBilibiliSession = (): string => readProviderSessionValue('bilibili', SESSION_KEY) || '';
export const getBilibiliSessionGeneration = (): number => generation;
export const advanceBilibiliSessionGeneration = (): number => ++generation;

export const keepBilibiliSession = (token: string): void => {
    // The token is opaque. Reject header/control characters rather than depending on its seal format.
    if (!token || token.length > 65536 || /[^\x21-\x7e]/.test(token)) throw new Error('Invalid sealed session');
    writeProviderSessionValue('bilibili', SESSION_KEY, token);
};

export const clearBilibiliSession = (): void => {
    generation += 1;
    removeProviderSessionValue('bilibili', SESSION_KEY);
};

export const clearBilibiliSessionIfSent = (sent: string): void => {
    if (sent && getBilibiliSession() === sent) clearBilibiliSession();
};
