/**
 * Retry capture for a single page. Usage:
 *   npx tsx scripts/capture-one.ts <url-path> <output-name> [settle-ms] [theme]
 * Example:
 *   npx tsx scripts/capture-one.ts /tasks tasks 4000
 *   npx tsx scripts/capture-one.ts / dashboard-light 25000 light
 *
 * Note: on Git Bash / MSYS, prefix the URL path with "//" not "/" or it
 * gets re-interpreted as a Windows path. e.g. "//tasks" not "/tasks".
 */

import { chromium } from '@playwright/test';
import * as path from 'path';

const BASE_URL = process.env.PRISM_URL || 'http://localhost:3010';
const [, , urlPathRaw, outputName, settleArg, themeArg] = process.argv;

if (!urlPathRaw || !outputName) {
  console.error('Usage: tsx scripts/capture-one.ts <url-path> <output-name> [settle-ms] [theme]');
  process.exit(1);
}

// Strip the MSYS-escape leading slash so Playwright sees "/tasks" not "//tasks".
const urlPath = urlPathRaw.replace(/^\/{2,}/, '/');
const settleMs = settleArg ? Number(settleArg) : 5000;
const theme = themeArg === 'dark' || themeArg === 'light' ? themeArg : undefined;
const OUT_DIR = path.resolve(__dirname, '..', 'docs', 'demos');

async function loginAsAlex(page: any) {
  const resp = await page.request.get('/api/family');
  const json = await resp.json();
  const members = Array.isArray(json) ? json : json.members;
  const alex = members.find((m: any) => m.name === 'Alex');
  const data: any = { pin: '1234' };
  if (alex.id) data.userId = alex.id;
  else if (typeof alex.loginIndex === 'number') data.memberIndex = alex.loginIndex;
  await page.request.post('/api/auth/login', { data });
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  });
  const page = await context.newPage();

  // Pre-seed theme localStorage BEFORE first paint so the dashboard renders
  // in the chosen theme without a mid-load class swap (which can re-trigger
  // widget loading states and confuse the settle wait).
  if (theme) {
    await page.addInitScript((t: string) => {
      try {
        localStorage.setItem('theme', t);
      } catch {}
      // Set the class on <html> as early as possible so styles apply pre-mount.
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(t);
    }, theme);
  }

  await page.goto('/', { waitUntil: 'load', timeout: 60_000 });
  await loginAsAlex(page);
  await page.goto(urlPath, { waitUntil: 'load', timeout: 60_000 });

  // Wait for body content + no loading text
  await page.waitForFunction(
    () => {
      const text = document.body.innerText.trim();
      if (!text || text === 'KYST') return false;
      if (/Loading[\s\w]*\.\.\./i.test(text)) return false;
      return true;
    },
    { timeout: 30_000, polling: 250 },
  ).catch(() => {});

  await page.waitForTimeout(settleMs);

  await page.screenshot({ path: path.join(OUT_DIR, `${outputName}.png`), fullPage: false });
  console.log(`  ✓ ${outputName}.png`);

  await browser.close();
})();
