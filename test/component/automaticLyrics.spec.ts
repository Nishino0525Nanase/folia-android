import { existsSync } from 'node:fs';
import { test, expect } from './fixtures';

// Exercise the automatic path, not the manual panel. The opt-in case uses the actual bundled speech model.
const sample = process.env.FOLIA_ALIGNMENT_SAMPLE;
const silence = () => {
    const bytes = Buffer.alloc(44 + 11 * 32000);
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
    bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
    return bytes;
};
test('import automatically recognizes, selects and displays missing lyrics once, including after reload', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let audioReads = 0;
    await page.route('**/__automatic_audio.wav', route => { audioReads++; return route.fulfill({ body: silence(), contentType: 'audio/wav' }); });
    await page.addInitScript(() => {
        const Original = window.Worker;
        window.Worker = class extends Original {
            constructor(url: string | URL, options?: WorkerOptions) {
                if (!String(url).includes('alignment.worker')) { super(url, options); return; }
                const source = `onmessage = () => { postMessage({type:'progress',value:{phase:'recognizing',progress:50}});
                    setTimeout(()=>postMessage({type:'result',value:{kind:'transcribed',lyrics:{lines:['The morning is blue','We follow the road','The day has begun']
                    .map((fullText,i)=>({fullText,startTime:i*3,endTime:i*3+2,words:[]}))}}}),800); };`;
                const blob = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); super(blob, options); URL.revokeObjectURL(blob);
            }
        };
    });
    await page.goto('/dev-probe.html?probe=automaticLyrics');
    await expect(page.locator('[data-import-returned]')).toHaveText('true');
    await expect(page.locator('[data-automatic-lyrics]')).toContainText('We follow the road');
    await expect(page.locator('[data-saved-source]')).toHaveText('folia-auto-subtitles.lrc');
    expect(audioReads).toBe(1);
    await page.reload();
    await expect(page.locator('[data-automatic-lyrics]')).toContainText('We follow the road');
    expect(audioReads).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('automatically imports actual audio and saves real recognized subtitles without user interaction', async ({ page }) => {
    test.skip(!sample || !existsSync(sample) || !process.env.FOLIA_ALIGNMENT_MODEL_ROOT, 'Supply the pinned bundled model and public-domain JFK audio');
    test.setTimeout(180_000);
    const languageWarnings: string[] = [];
    page.on('console', message => { if (message.text().includes('defaulting to English')) languageWarnings.push(message.text()); });
    await page.route('**/__automatic_audio.wav', route => route.fulfill({ path: sample!, contentType: 'audio/wav' }));
    await page.goto('/dev-probe.html?probe=automaticLyrics');
    await expect(page.locator('[data-import-returned]')).toHaveText('true');
    await expect(page.locator('[data-automatic-lyrics]')).toContainText('country', { timeout: 120_000 });
    await expect(page.locator('[data-saved-source]')).toHaveText('folia-auto-subtitles.lrc');
    expect(languageWarnings).toEqual([]);
});
