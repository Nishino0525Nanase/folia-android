import { expect, test } from './fixtures';

// Real touch routing: bounded rows, no wall, one tap, independent queue action, and retained scroll after details.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test('phone collections stay virtual and preserve actions without mounting the wall', async ({ page }) => {
    await page.goto('/dev-probe.html?probe=bravaisPhone');
    const root = page.locator('[data-bravais-phone-collection]');
    const rows = root.locator('[data-bravais-list-row]');
    const stats = page.locator('[data-phone-stats]');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThan(30);
    await expect(page.locator('.bravais-tile')).toHaveCount(0);
    await rows.first().locator('.bravais-list-text').tap();
    await expect(stats).toHaveAttribute('data-played', '1');
    await rows.first().getByRole('button', { name: 'Add to queue', exact: true }).tap();
    await expect(stats).toHaveAttribute('data-enqueued', '1');
    await expect(stats).toHaveAttribute('data-played', '1');
    await rows.first().getByRole('button', { name: 'More', exact: true }).tap();
    await root.locator('[data-bravais-phone-item-action="add-to-playlist"]').tap();
    await expect(stats).toHaveAttribute('data-action', 'add-to-playlist');
    await root.locator('[data-bravais-phone-back]').tap();
    const scroll = root.locator('.bravais-panel-list > div');
    await scroll.evaluate(node => { node.scrollTop = 7200; node.dispatchEvent(new Event('scroll')); });
    await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBe(7200);
    await root.locator('[data-bravais-seam-action="hide"]').tap();
    await page.screenshot({ path: '/tmp/folia-build/phone-details-14.png' });
    await root.locator('[data-bravais-phone-back]').tap();
    expect(await scroll.evaluate(node => node.scrollTop)).toBe(7200);
    expect(await rows.count()).toBeLessThan(30);
    await page.screenshot({ path: '/tmp/folia-build/phone-14.png' });
    await root.locator('[data-bravais-seam-action="close-list"]').tap();
    await expect(stats).toHaveAttribute('data-back', '1');
});
