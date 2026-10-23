import { existsSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

// Opt-in real browser inference test. Supply pinned model files and the public-domain JFK sample.
const root = process.env.FOLIA_ALIGNMENT_MODEL_ROOT;
const sample = process.env.FOLIA_ALIGNMENT_SAMPLE;
test('loads bundled WASM in a worker and recognizes actual audio with word times', async ({ page, context }) => {
    test.skip(!root || !sample || !existsSync(sample), 'Set FOLIA_ALIGNMENT_MODEL_ROOT and FOLIA_ALIGNMENT_SAMPLE');
    test.setTimeout(300_000);
    await context.route('https://huggingface.co/**', async route => {
        const file = path.join(root!, new URL(route.request().url()).pathname);
        if (!existsSync(file)) throw new Error(`Missing pinned model asset: ${file}`);
        await route.fulfill({ path: file, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.route('**/__alignment_sample.wav', route => route.fulfill({ path: sample!, contentType: 'audio/wav' }));
    await page.goto('/dev-probe.html?probe=nativeDragGuard');
    const result = await page.evaluate(async () => {
        // @ts-expect-error Vite serves the actual worker graph for this browser-only check.
        const { inferAlignment } = await import('/src/services/lyricAlignment/alignmentService.ts');
        const bytes = await (await fetch('/__alignment_sample.wav')).arrayBuffer();
        const buffer = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes);
        const samples = buffer.getChannelData(0).slice();
        const started = performance.now();
        const result = await inferAlignment({ samples, lyrics: null, language: 'english' }, new AbortController().signal, () => {});
        return { ...result, elapsedMs: performance.now() - started, duration: buffer.duration };
    });
    expect(result.kind).toBe('transcribed');
    expect(result.lyrics.lines.map((line: { fullText: string }) => line.fullText).join(' ').toLowerCase()).toContain('country');
    expect(result.lyrics.lines.length).toBeGreaterThan(0);
    for (const line of result.lyrics.lines) {
        expect(line.startTime).toBeGreaterThanOrEqual(0);
        expect(line.endTime).toBeGreaterThan(line.startTime);
        expect(line.endTime).toBeLessThanOrEqual(result.duration + 0.5);
    }
    console.log(`Actual ASR: ${result.duration.toFixed(1)}s audio, ${result.lyrics.lines.length} lines, ${(result.elapsedMs / 1000).toFixed(1)}s inference`);
});
