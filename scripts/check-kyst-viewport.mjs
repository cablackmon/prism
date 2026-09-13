/**
 * Development regression for the seven-widget kiosk composition.
 * Run against loopback NOX and classic servers of the SAME production build:
 * node scripts/check-kyst-viewport.mjs http://127.0.0.1:3347 http://127.0.0.1:3348
 * Fixtures never write settings. The DOM zoom emulates the server-rendered
 * layout.fontScale wrapper, which is otherwise 100 with a disconnected DB.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const urls = process.argv.slice(2);
assert.equal(urls.length, 2, 'Supply NOX and classic preview URLs');
for (const url of urls) assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const widgets = [
  ['calendar', 0, 0, 30, 16], ['clock', 30, 0, 8, 4],
  ['weather', 38, 0, 10, 4], ['tasks', 30, 4, 18, 12],
  ['chores', 0, 16, 16, 11], ['points', 16, 16, 11, 11],
  ['messages', 27, 16, 21, 11],
].map(([i, x, y, w, h]) => ({ i, x, y, w, h, visible: true }));
const tasks = Array.from({ length: 25 }, (_, i) => ({
  id: `task-${i}`, title: `Task ${i + 1}: a long family reminder that must wrap inside its card`,
  completed: false, priority: 'medium', assignedTo: null, dueDate: null,
}));
const fixtures = {
  '/api/setup/status': { complete: true }, '/api/settings': { settings: {} },
  '/api/auth/session': { user: null }, '/api/auth/me': { authenticated: false, user: null },
  '/api/family': { members: [] }, '/api/tasks': { tasks },
  '/api/layouts': { layouts: [{ id: 'viewport-fixture', name: 'Board', isDefault: true,
    orientation: 'landscape', fontScale: 150, widgets, screensaverWidgets: [] }] },
  '/api/events': { events: [] }, '/api/calendars': { calendars: [] },
  '/api/calendar-groups': { groups: [] }, '/api/messages': { messages: [] },
  '/api/chores': { chores: [] }, '/api/goals': { goals: [], progress: [], children: [] },
  '/api/points': { points: [] }, '/api/photos': { photos: [] },
  '/api/shopping-lists': { lists: [] }, '/api/meals': { meals: [] },
  '/api/birthdays': { birthdays: [] }, '/api/task-lists': [],
  '/api/recipes': { recipes: [] }, '/api/away-mode': { enabled: false },
  '/api/babysitter-mode': { enabled: false }, '/api/babysitter-info': { items: [] },
};
const browser = await chromium.launch();
const results = [];
try {
  for (const [index, theme] of ['nox', 'classic'].entries()) {
    const context = await browser.newContext({ viewport: { width: 2560, height: 1440 }, serviceWorkers: 'block' });
    await context.route('**/api/**', route => {
      const request = route.request();
      assert.equal(request.method(), 'GET', 'Verification must never mutate data');
      const fixture = fixtures[new URL(request.url()).pathname];
      return route.fulfill({ status: fixture ? 200 : 503, json: fixture ?? { error: 'Optional fixture unavailable' } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(urls[index]);
    await page.locator('.widget-cell[data-widget="tasks"]').waitFor();
    for (const [width, height] of [[2560, 1440], [1920, 1080], [3840, 2160], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      for (const scale of [100, 150]) {
        await page.evaluate(scale => {
          document.getElementById('ssr-placeholder').nextElementSibling.style.zoom = String(scale / 100);
          window.dispatchEvent(new Event('resize'));
        }, scale);
        await page.waitForTimeout(1500);
        const bounds = await page.locator('.widget-cell').evaluateAll(elements => elements.map(e => {
          const r = e.getBoundingClientRect();
          return { id: e.dataset.widget, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, area: e.style.gridArea };
        }));
        assert.equal(bounds.length, 7);
        // Classic keeps its original sizing (including its inherited 150% overflow).
        // The NOX fix must fit the actual cards, not merely hide document overflow.
        if (theme === 'nox') {
          for (const b of bounds) assert(b.x >= 0 && b.y >= 0 && b.right <= width + 1 && b.bottom <= height + 1 && b.width > 0 && b.height > 0, JSON.stringify({ width, height, scale, b }));
          for (const widget of widgets) assert.equal(bounds.find(b => b.id === widget.i).area,
            `${widget.y + 1} / ${widget.x + 1} / span ${widget.h} / span ${widget.w}`);
          const clock = page.locator('.kyst-widget[data-widget="Clock"] time').first();
          // Worst-case 12-hour time including seconds. Restore the next real tick.
          await clock.evaluate(e => { e.textContent = '12:59:59 PM'; });
          const fits = await clock.evaluate(e => {
            const r = e.getBoundingClientRect(), p = e.closest('.kyst-widget').getBoundingClientRect();
            return r.left >= p.left && r.right <= p.right && r.top >= p.top && r.bottom <= p.bottom;
          });
          assert(fits, `Clock fits at ${width}×${height}/${scale}`);
        }
        results.push({ theme, width, height, scale, widgets: bounds.length });
      }
    }
    if (theme === 'nox') {
      await page.setViewportSize({ width: 2560, height: 1440 });
      const scroll = page.getByRole('region', { name: 'Tasks — scroll for more' });
      await scroll.focus();
      await page.keyboard.press('End');
      await page.waitForTimeout(400);
      assert(await scroll.evaluate(e => e.scrollTop > 0 && e.dataset.moreBelow === 'false'));
      await page.keyboard.press('Home');
      await page.waitForTimeout(400);
      assert(await scroll.evaluate(e => e.scrollTop === 0 && e.dataset.moreBelow === 'true'));
      for (const name of ['Calendar view', 'View options']) {
        const trigger = page.getByRole('button', { name, exact: true });
        await trigger.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name, exact: true });
        await dialog.waitFor();
        assert(await dialog.evaluate(e => e.contains(document.activeElement)));
        assert.equal(await trigger.getAttribute('aria-controls'), await dialog.getAttribute('id'));
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert(await trigger.evaluate(e => e === document.activeElement));
      }
      await page.getByRole('button', { name: 'Start screensaver', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.kystScreensaver === 'active');
      assert.equal(await page.locator('.kyst-stars').first().evaluate(e => getComputedStyle(e).animationPlayState), 'paused');
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(JSON.stringify({ passed: results.length, total: 16, results, scrollingAndScreensaver: 'passed' }));
} finally {
  await browser.close();
}
