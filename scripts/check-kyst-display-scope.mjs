/** Local-only editor/measurement/contain-mode regression; never saves settings.
 * Usage: node scripts/check-kyst-display-scope.mjs <nox-loopback-url> <proof-directory>
 * KYST_SCOPE_BASELINE=1 records the pre-fix behavior without scope assertions.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { widgets, fixtures } from './fixtures/kyst-viewport.mjs';
const [url, out] = process.argv.slice(2);
assert(url && out && ['localhost', '127.0.0.1'].includes(new URL(url).hostname));
await mkdir(out, { recursive: true });
const baseline = process.env.KYST_SCOPE_BASELINE === '1';
const browser = await chromium.launch();
const results = [], mutations = [], errors = [];
const parent = { id: 'fixture-parent', name: 'Preview Parent', role: 'parent', color: '#35c7ff' };
const data = { ...fixtures, '/api/auth/me': { authenticated: true, user: parent }, '/api/family': { members: [parent] } };
try {
  for (const scale of [100, 150]) {
    const context = await browser.newContext({ viewport: { width: 2560, height: 1440 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const r = route.request(), u = new URL(r.url());
      if (u.hostname !== new URL(url).hostname) return route.abort();
      if (r.method() !== 'GET') {
        mutations.push({ path: u.pathname, method: r.method() });
        return route.fulfill({ status: 403, json: { error: 'No writes permitted' } });
      }
      if (!u.pathname.startsWith('/api/')) return route.continue();
      return route.fulfill({ status: data[u.pathname] ? 200 : 503, json: data[u.pathname] ?? { error: 'Optional fixture missing' } });
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.locator('.widget-cell[data-widget="clock"]').waitFor();
    await page.evaluate(scale => {
      document.getElementById('ssr-placeholder').nextElementSibling.style.zoom = String(scale / 100);
      window.dispatchEvent(new Event('resize'));
    }, scale);
    const inspect = async state => {
      await page.waitForTimeout(1700);
      const info = await page.evaluate(() => {
        const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        const clock = document.querySelector('.kyst-widget[data-widget="Clock"]');
        const grid = document.querySelector('.kyst-grid-display');
        const exit = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Exit Preview');
        return {
          viewport: [innerWidth, innerHeight], shellPosition: getComputedStyle(document.querySelector('.kyst-board')).position,
          grid: grid && { ...rect(grid), mode: grid.dataset.fit, heightStyle: getComputedStyle(grid).height, displayMarker: grid.classList.contains('kyst-board-display-grid'), measureMarker: grid.classList.contains('kyst-board-measure-grid') },
          clock: clock && { ...rect(clock), containment: getComputedStyle(clock).containerType, timeSize: getComputedStyle(clock.querySelector('time')).fontSize, times: [...clock.querySelectorAll('time')].map(rect) },
          cards: [...document.querySelectorAll('.widget-cell')].map(e => ({ id: e.dataset.widget, area: e.style.gridArea, ...rect(e) })),
          exit: exit && { ...rect(exit), name: exit.textContent.trim(), visible: document.elementFromPoint(...(() => { const r = exit.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()) === exit },
        };
      });
      await sharp(await page.screenshot({ type: 'jpeg', quality: 85 })).resize({ width: Math.min(1280, (await page.viewportSize()).width) }).toFile(path.join(out, `${scale}-${state}.jpg`));
      results.push({ scale, state, ...info });
      await writeFile(path.join(out, 'results.json'), JSON.stringify({ results, mutations, errors }, null, 2));
      return info;
    };
    const activate = async name => {
      const button = page.getByRole('button', { name, exact: true });
      await button.focus();
      assert(await button.evaluate(e => e === document.activeElement));
      await page.keyboard.press('Enter');
    };
    await inspect('board');
    await activate('Edit layout');
    await page.getByRole('button', { name: 'Preview', exact: true }).waitFor();
    const editor = await inspect('editor');
    await activate('Preview');
    for (const [state, toggle] of [['measure-hidden', 'Show Nav'], ['measure-visible', 'Hide Nav'], ['measure-hidden-again', null]]) {
      const info = await inspect(state);
      assert(info.grid && info.grid.width > 100 && info.grid.height > 100, 'Preview grid must not collapse');
      assert(info.clock && info.clock.width > 30 && info.clock.height > 30, 'Preview clock must have a usable slot');
      if (!baseline) for (const t of info.clock.times) assert(t.x >= info.clock.x - 1 && t.right <= info.clock.right + 1 && t.y >= info.clock.y - 1 && t.bottom <= info.clock.bottom + 1, 'Preview time/date inside clock');
      assert(info.exit?.visible, 'Exit Preview must be visible and unobscured');
      if (!baseline) {
        assert.equal(info.shellPosition, 'fixed');
        assert.equal(info.grid.measureMarker, true);
        assert(info.grid.bottom <= info.viewport[1] + 1, 'Preview grid fits its visible viewport');
        for (const c of info.cards) assert(c.x >= 0 && c.y >= 0 && c.right <= info.viewport[0] + 1 && c.bottom <= info.viewport[1] + 1, 'Preview cards fit');
        assert.equal(info.grid.displayMarker, false);
        assert.equal(info.clock.containment, 'size');
      }
      if (!baseline) {
        const contrast = [];
        for (const name of ['Exit Preview', state === 'measure-visible' ? 'Hide Nav' : 'Show Nav']) {
          const control = page.getByRole('button', { name, exact: true });
          const box = await control.evaluate(e => { const range = document.createRange(); range.selectNodeContents(e); const r = range.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
          const color = await control.evaluate(e => { const color = getComputedStyle(e).color; e.style.transition = 'none'; e.style.color = 'transparent'; return color; });
          const { data: pixels, info: imageInfo } = await sharp(await page.screenshot({ clip: box })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          await control.evaluate(e => { e.style.color = ''; e.style.transition = '';  });
          const lum = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
          const foreground = lum(color.match(/[\d.]+/g).slice(0, 3).map(Number));
          let minimum = Infinity;
          for (let i = 0; i < pixels.length; i += imageInfo.channels) {
            const background = lum([...pixels.subarray(i, i + 3)]);
            minimum = Math.min(minimum, (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05));
          }
          contrast.push({ name, ratio: minimum });
          assert(minimum >= 4.5, `${name} contrast ${minimum}`);
        }
        results.at(-1).controlsContrast = contrast;
        await writeFile(path.join(out, 'results.json'), JSON.stringify({ results, mutations, errors }, null, 2));
      }
      if (toggle) await activate(toggle);
    }
    await activate('Exit Preview');
    await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
    const returnedEditor = await inspect('returned-editor');
    if (!baseline) {
      assert.equal(returnedEditor.shellPosition, 'relative');
      assert.equal(returnedEditor.clock.containment, 'normal');
    }
    await activate('Cancel');
    await page.getByRole('button', { name: 'Preview', exact: true }).waitFor({ state: 'detached' });
    const returned = await inspect('returned-board');
    for (const widget of widgets) assert.equal(returned.cards.find(c => c.id === widget.i).area,
      `${widget.y + 1} / ${widget.x + 1} / span ${widget.h} / span ${widget.w}`);
    await page.setViewportSize({ width: 2160, height: 3840 });
    const contain = await inspect('portrait-contain');
    assert.equal(contain.grid.mode, 'contain');
    assert.equal(contain.cards.length, 7);
    if (!baseline) for (const t of contain.clock.times) assert(t.x >= contain.clock.x - 1 && t.right <= contain.clock.right + 1 && t.y >= contain.clock.y - 1 && t.bottom <= contain.clock.bottom + 1, 'Contain-mode time/date inside clock');
    if (!baseline) {
      assert.equal(editor.shellPosition, 'relative');
      assert.equal(editor.clock.containment, 'normal');
      assert.equal(contain.shellPosition, 'relative');
      assert.equal(contain.clock.containment, 'normal');
      assert.equal(contain.grid.displayMarker, true);
    }
    await context.close();
  }
  assert.deepEqual(mutations, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: results.length, total: 16, mutations: mutations.length, errors: errors.length, baseline }));
} finally { await browser.close(); }
