/**
 * Read-only root/hydration check against two processes running the SAME build.
 * Usage: node scripts/check-kyst-theme.mjs http://127.0.0.1:3317 http://127.0.0.1:3318
 * Start them with KYST_THEME=nox and KYST_THEME=classic respectively.
 * This checks rendering with API fixtures, not real-kiosk acceptance.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const [noxUrl, classicUrl] = process.argv.slice(2);
assert(noxUrl && classicUrl, 'Supply the NOX and classic preview URLs');
for (const url of [noxUrl, classicUrl]) {
  assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Use local previews only');
}
const browser = await chromium.launch();
try {
  for (const [theme, url] of [['nox', noxUrl], ['classic', classicUrl]]) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const fixtures = {
        '/api/family': { members: [] },
        '/api/setup/status': { complete: true },
        '/api/layouts': { layouts: [] },
        '/api/auth/session': { user: null },
        '/api/settings': { settings: {} },
      };
      await route.fulfill({ status: fixtures[path] ? 200 : 503, json: fixtures[path] || { error: 'No fixture for optional data' } });
    });
    const page = await context.newPage();
    await page.goto(url);
    const shell = page.locator(`[data-kyst-theme="${theme}"]`);
    await shell.waitFor();
    assert.equal(await page.getByText('Something went wrong', { exact: true }).count(), 0);
    assert.equal(await page.locator('.kyst-stars').count(), theme === 'nox' ? 2 : 0);
    if (theme === 'nox') {
      await page.getByRole('link', { name: 'KYST family board home', exact: true }).waitFor();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.kyst-stars').first().evaluate(el => getComputedStyle(el).animationName), 'none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.getByRole('button', { name: 'Start screensaver', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.kystScreensaver === 'active');
      assert.equal(await page.locator('.kyst-stars').first().evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
    }
    console.log(`${theme}: root hydrates, theme renders, motion policy checked`);
    await context.close();
  }
} finally {
  await browser.close();
}
