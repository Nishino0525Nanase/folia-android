import { test, expect } from './fixtures';

// Real import queues must never download full audio or launch speech inference, including after reload.
test('missing imported lyrics finish without audio downloads, speech workers or model requests', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const expensive: string[] = [];
    page.on('request', request => {
        if (/__automatic_audio|\/models\/|__folia_whisper|alignment\.worker/.test(request.url())) expensive.push(request.url());
    });
    page.on('worker', worker => { if (/alignment\.worker/.test(worker.url())) expensive.push(worker.url()); });
    await page.goto('/dev-probe.html?probe=automaticLyrics');
    await expect(page.locator('[data-import-returned]')).toHaveText('true');
    await expect(page.locator('[data-preparation-complete]')).toHaveText('true');
    await expect(page.locator('[data-automatic-lyrics]')).toBeEmpty();
    await page.reload();
    await expect(page.locator('[data-preparation-complete]')).toHaveText('true');
    expect(expensive).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('imports, matches and displays existing timed lyrics automatically and reuses them after restart', async ({ page }) => {
    let searches = 0;
    await page.route('https://lrclib.net/api/**', route => {
        searches++;
        return route.fulfill({ json: [{ id: 99, trackName: 'Fixture song', artistName: 'Fixture artist', albumName: 'Test', duration: 11,
            syncedLyrics: '[00:01.00]The morning is blue\n[00:04.00]We follow the road\n[00:08.00]The day has begun' }] });
    });
    await page.goto('/dev-probe.html?probe=automaticLyrics&match');
    await expect(page.locator('[data-import-returned]')).toHaveText('true');
    await expect(page.locator('[data-automatic-lyrics]')).toContainText('We follow the road');
    await expect(page.locator('[data-saved-source]')).toHaveText('lrclib');
    expect(searches).toBe(1);
    await page.reload();
    await expect(page.locator('[data-automatic-lyrics]')).toContainText('We follow the road');
    expect(searches).toBe(1);
});

test('reads existing video subtitles on import without searching a catalogue and reuses their exact timeline', async ({ page }) => {
    let requests = 0;
    const searches: string[] = [];
    page.on('request', request => { if (/https:\/\/lrclib\.net\/api|__automatic_audio|alignment\.worker|\/models\//.test(request.url())) searches.push(request.url()); });
    await page.route('**/__video_subtitles', route => {
        requests++;
        return route.fulfill({ json: { mediaSubtitle: { language: 'ja', automatic: false }, isWordByWord: false,
            lines: [{ startTime: 2.45, endTime: 5.12, fullText: 'Original caption', words: [{ text: 'Original caption', startTime: 2.45, endTime: 5.12 }] }] } });
    });
    await page.goto('/dev-probe.html?probe=automaticLyrics&subtitles');
    await expect(page.locator('[data-import-returned]')).toHaveText('true');
    await expect(page.locator('[data-automatic-lyrics]')).toContainText('2.45 Original caption');
    await page.reload();
    await expect(page.locator('[data-automatic-lyrics]')).toContainText('2.45 Original caption');
    expect(requests).toBe(1); expect(searches).toEqual([]);
});
