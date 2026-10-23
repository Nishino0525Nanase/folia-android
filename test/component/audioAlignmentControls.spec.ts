import { test, expect } from './fixtures';

// Recognition is stubbed here; audioAlignmentRuntime separately exercises the real model and WASM.
test('phone controls preserve a running job across panel closure and restore original timing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
        const OriginalWorker = window.Worker;
        window.Worker = class extends OriginalWorker {
            constructor(url: string | URL, options?: WorkerOptions) {
                if (!String(url).includes('alignment.worker')) { super(url, options); return; }
                const source = `onmessage = ({data}) => { postMessage({type:'progress', value:{phase:'recognizing',progress:50}});
                    setTimeout(() => postMessage({type:'result',value:{kind:'aligned',matchedLines:3,totalLines:3,coverage:1,
                        lyrics:{lines:data.lyrics.lines.map(line=>({...line,startTime:line.startTime+5,endTime:line.endTime+5,words:[]}))}}}), 1500); };`;
                const blob = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
                super(blob, options); URL.revokeObjectURL(blob);
            }
        };
    });
    await page.goto('/dev-probe.html?probe=audioAlignment');
    const controls = page.locator('[data-audio-alignment]');
    await controls.getByRole('button', { name: 'Recognize and align vocals', exact: true }).click();
    await expect(controls.getByRole('button', { name: 'Cancel recognition' })).toBeVisible();
    await page.getByRole('button', { name: 'Toggle panel' }).click();
    await page.getByRole('button', { name: 'Toggle panel' }).click();
    await controls.getByRole('button', { name: 'Use this timeline' }).click();
    await expect(page.locator('[data-selection]')).toHaveText('imported:0:5');
    await controls.getByRole('button', { name: 'Restore original lyrics' }).click();
    await expect(page.locator('[data-selection]')).toHaveText('online:2000:0');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
