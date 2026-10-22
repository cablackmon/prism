import { demoFiles, loadDemo, loadSynthetic, type Demo, type Action } from './burn4-harness';

const presets = [
  'button.filter(16:9 (1080p))',
  'button.filter(3:2 (Surface))',
  'button.filter(4:3 (iPad))',
] as const;
const orientation = 'button.filter(/Landscape|Portrait/)';
const ingredients = '[role="dialog"] >> ul.space-y-1 > li';
const maximize = 'button[title="Maximize"].or(button:has(svg.lucide-maximize2)).first';
const targets = (actions: Action[], kind: string) => actions.filter(action => action.kind === kind).map(action => action.target);
const waits = (actions: Action[]) => actions.filter(action => action.kind === 'wait').map(action => action.value);
const error = new Error('synthetic interaction failed');

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function until(actions: Action[], kind: string, target = '') {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (actions.some(action => action.kind === kind && action.target === target)) return;
    await Promise.resolve();
  }
  throw new Error(`Expected pending ${kind} action`);
}

async function drainMicrotasks() {
  // Let an accidentally unawaited operation advance through later fake calls.
  for (let index = 0; index < 30; index++) await Promise.resolve();
}

describe('actual demo registration and setup boundaries', () => {
  test.each(Object.keys(demoFiles) as Demo[])('%s propagates reset failure before authentication or navigation', async demo => {
    const run = loadDemo(demo, { faults: [{ kind: 'reset', error }] });
    await expect(run.run()).rejects.toBe(error);
    expect(run.actions).toEqual([{ kind: 'reset', target: '' }]);
  });

  test.each(Object.keys(demoFiles) as Demo[])('%s awaits authentication and stops after its rejection', async demo => {
    const run = loadDemo(demo, { faults: [{ kind: 'login', error }] });
    await expect(run.run()).rejects.toBe(error);
    expect(targets(run.actions, 'goto')).toEqual([]);
    expect(targets(run.actions, 'post')).toEqual([]);
    expect(run.actions.at(-1)).toEqual({ kind: 'login', target: '' });
  });

  test('authentication completion gates all dashboard navigation', async () => {
    const gate = deferred();
    const run = loadDemo('dashboard', { gates: [{ kind: 'login', wait: gate.promise }] });
    const pending = run.run();
    await until(run.actions, 'login');
    await drainMicrotasks();
    expect(targets(run.actions, 'goto')).toEqual([]);
    gate.release();
    await pending;
    expect(targets(run.actions, 'goto')).toEqual(['/']);
  });
});

describe('dashboard editor and theme callbacks', () => {
  test('dashboard visits, opens editor, exercises every available preset and closes it', async () => {
    const run = loadDemo('dashboard');
    await run.run();
    expect(run.actions.slice(0, 4)).toEqual([
      { kind: 'reset', target: '' }, { kind: 'login', target: '' },
      { kind: 'goto', target: '/' }, { kind: 'ready', target: 'networkidle' },
    ]);
    expect(targets(run.actions, 'hover')).toEqual(['aside']);
    expect(run.actions.find(action => action.kind === 'move')?.value).toEqual([640, 360]);
    expect(targets(run.actions, 'click')).toEqual([
      'button[aria-label="Edit layout"]', ...presets.map(preset => `${preset}.first`),
      `${orientation}.first`, `${orientation}.first`,
    ]);
    expect(targets(run.actions, 'key')).toEqual(['Escape']);
  });

  test.each(presets)('absent optional preset %s is never clicked', async preset => {
    const run = loadDemo('dashboard', { counts: { [preset]: [0] } });
    await run.run();
    expect(targets(run.actions, 'click')).not.toContain(`${preset}.first`);
    expect(targets(run.actions, 'click')).toContain('button[aria-label="Edit layout"]');
    expect(targets(run.actions, 'key')).toEqual(['Escape']);
  });

  test.each([[0, 0], [0, 1], [1, 0], [1, 1]])('orientation availability %j is checked independently', async (first, second) => {
    const run = loadDemo('dashboard', { counts: { [orientation]: [first, second] } });
    await run.run();
    expect(targets(run.actions, 'click').filter(path => path === `${orientation}.first`)).toHaveLength(first + second);
    expect(targets(run.actions, 'count').filter(path => path === orientation)).toHaveLength(2);
  });

  test('editor failure propagates without pressing Escape', async () => {
    const run = loadDemo('dashboard', { faults: [{ kind: 'click', target: 'button[aria-label="Edit layout"]', error }] });
    await expect(run.run()).rejects.toBe(error);
    expect(targets(run.actions, 'count')).toEqual([]);
    expect(targets(run.actions, 'key')).toEqual([]);
  });

  test('theme switching waits for the display settings page and chooses Dark then Light', async () => {
    const run = loadDemo('theme');
    await run.run();
    expect(targets(run.actions, 'goto')).toEqual(['/settings?section=display']);
    expect(targets(run.actions, 'ready')).toEqual(['networkidle']);
    expect(targets(run.actions, 'click')).toEqual(['button:has-text("Dark")', 'button:has-text("Light")']);
  });

  test('an unresolved Dark click blocks Light and its display pause', async () => {
    const gate = deferred();
    const run = loadDemo('theme', { gates: [{ kind: 'click', target: 'button:has-text("Dark")', wait: gate.promise }] });
    const pending = run.run();
    await until(run.actions, 'click', 'button:has-text("Dark")');
    await drainMicrotasks();
    expect(targets(run.actions, 'click')).toEqual(['button:has-text("Dark")']);
    expect(waits(run.actions)).toEqual([1500]);
    gate.release();
    await pending;
    expect(targets(run.actions, 'click').at(-1)).toBe('button:has-text("Light")');
  });

  test.each(['goto', 'click'])('theme %s failure stops remaining controls', async kind => {
    const run = loadDemo('theme', { faults: [{ kind, error }] });
    await expect(run.run()).rejects.toBe(error);
    expect(targets(run.actions, 'click')).not.toContain('button:has-text("Light")');
  });
});

describe('chore and grocery recording callbacks', () => {
  test('chore card becomes visible before click and full celebration playback', async () => {
    const run = loadDemo('chore');
    await run.run();
    const card = 'div.cursor-pointer.text(Empty dishwasher).first';
    expect(targets(run.actions, 'visible')).toEqual([card]);
    expect(targets(run.actions, 'click')).toEqual([card]);
    expect(run.actions.findIndex(action => action.kind === 'visible')).toBeLessThan(run.actions.findIndex(action => action.kind === 'click'));
    expect(targets(run.actions, 'selector')).toEqual(['.animate-plane-fly']);
    expect(waits(run.actions)).toEqual([2000, 1000, 6000]);
  });

  test('missing chore animation uses its documented shorter fallback', async () => {
    const run = loadDemo('chore', { faults: [{ kind: 'selector', error }] });
    await run.run();
    expect(waits(run.actions)).toEqual([2000, 1000, 4000]);
  });

  test('chore card readiness failure prevents completion and animation polling', async () => {
    const run = loadDemo('chore', { faults: [{ kind: 'visible', error }] });
    await expect(run.run()).rejects.toBe(error);
    expect(targets(run.actions, 'click')).toEqual([]);
    expect(targets(run.actions, 'selector')).toEqual([]);
  });

  test('a failed chore fallback pause propagates to the caller', async () => {
    const run = loadDemo('chore', { faults: [{ kind: 'selector', error }, { kind: 'wait', occurrence: 3, error }] });
    await expect(run.run()).rejects.toBe(error);
  });

  test('grocery callback opens its tab, awaits six rows and records the celebration', async () => {
    const run = loadDemo('grocery');
    await run.run();
    expect(targets(run.actions, 'goto')).toEqual(['/shopping']);
    expect(targets(run.actions, 'click')).toEqual([
      'button:has-text("Grocery")', 'text(Milk).first', 'text(Bread).first',
      'text(Apples).first', 'text(Chicken breast).first', 'text(Peaches).first', 'text(Yoghurt).first',
    ]);
    expect(targets(run.actions, 'visible')).toEqual(targets(run.actions, 'click'));
    expect(targets(run.actions, 'selector')).toEqual(['.animate-cart-ride']);
    expect(waits(run.actions).at(-1)).toBe(4000);
  });

  test('grocery row click completion gates the next row', async () => {
    const gate = deferred();
    const run = loadDemo('grocery', { gates: [{ kind: 'click', target: 'text(Milk).first', wait: gate.promise }] });
    const pending = run.run();
    await until(run.actions, 'click', 'text(Milk).first');
    await drainMicrotasks();
    expect(targets(run.actions, 'visible')).not.toContain('text(Bread).first');
    gate.release();
    await pending;
    expect(targets(run.actions, 'visible')).toContain('text(Bread).first');
  });

  test('a missing grocery row prevents later rows and celebration', async () => {
    const run = loadDemo('grocery', { faults: [{ kind: 'visible', target: 'text(Bread).first', error }] });
    await expect(run.run()).rejects.toBe(error);
    expect(targets(run.actions, 'click')).toEqual(['button:has-text("Grocery")', 'text(Milk).first']);
    expect(targets(run.actions, 'selector')).toEqual([]);
  });

  test('missing shopping animation follows its documented fallback', async () => {
    const run = loadDemo('grocery', { faults: [{ kind: 'selector', error }] });
    await run.run();
    expect(waits(run.actions).at(-1)).toBe(2000);
  });
});

describe('recipe interaction and ingredient boundaries', () => {
  test.each([0, 1, 4, 7])('only min(4,%i) dialog ingredients are checked', async count => {
    const run = loadDemo('recipe', { ingredientCount: count });
    await run.run();
    const ingredientClicks = run.actions.filter(action => action.kind === 'click' && action.target.startsWith(ingredients));
    expect(ingredientClicks).toEqual(Array.from({ length: Math.min(4, count) }, (_, index) => ({
      kind: 'click', target: `${ingredients}.nth(${index})`, value: { force: true },
    })));
    expect(targets(run.actions, 'scroll')).toEqual(['[role="dialog"] >> h4:has-text("Ingredients")']);
    expect(targets(run.actions, 'goto')).toEqual(['/recipes']);
  });

  test('the optional maximize failure still reaches ingredient selection', async () => {
    const run = loadDemo('recipe', { faults: [{ kind: 'click', target: maximize, error }], ingredientCount: 1 });
    await run.run();
    expect(targets(run.actions, 'click')).toContain(`${ingredients}.nth(0)`);
  });

  test('unresolved first ingredient click blocks the next ingredient', async () => {
    const gate = deferred();
    const run = loadDemo('recipe', { gates: [{ kind: 'click', target: `${ingredients}.nth(0)`, wait: gate.promise }] });
    const pending = run.run();
    await until(run.actions, 'click', `${ingredients}.nth(0)`);
    await drainMicrotasks();
    expect(targets(run.actions, 'click')).not.toContain(`${ingredients}.nth(1)`);
    gate.release();
    await pending;
    expect(targets(run.actions, 'click')).toContain(`${ingredients}.nth(1)`);
  });

  test.each(['scroll', 'count'])('recipe %s failure propagates without ingredient clicks', async kind => {
    const run = loadDemo('recipe', { faults: [{ kind, error }] });
    await expect(run.run()).rejects.toBe(error);
    expect(targets(run.actions, 'click').filter(path => path.startsWith(ingredients))).toEqual([]);
  });
});

describe.each(['away', 'babysitter'] as const)('%s mode request and real event callback', demo => {
  const path = `/api/${demo === 'away' ? 'away' : 'babysitter'}-mode`;
  const eventName = `prism:${demo === 'away' ? 'away' : 'babysitter'}-mode-change`;

  test('activation carries the synthetic member ID and dispatches the actual callback detail', async () => {
    const run = loadDemo(demo, { memberId: 'synthetic-identity-2' });
    await run.run();
    expect(run.actions.filter(action => action.kind === 'post')).toEqual([{
      kind: 'post', target: path,
      value: { enabled: true, enabledBy: 'synthetic-identity-2', ...(demo === 'away' ? { autoActivated: true } : {}) },
    }]);
    expect(run.actions.filter(action => action.kind === 'dispatch')).toEqual([{
      kind: 'dispatch', target: eventName, value: { enabled: true },
    }]);
    expect(run.actions.findIndex(action => action.kind === 'post')).toBeLessThan(run.actions.findIndex(action => action.kind === 'dispatch'));
    expect(waits(run.actions).at(-1)).toBe(5000);
  });

  test('an unresolved activation request cannot dispatch an event', async () => {
    const gate = deferred();
    const run = loadDemo(demo, { gates: [{ kind: 'post', wait: gate.promise }] });
    const pending = run.run();
    await until(run.actions, 'post', path);
    await drainMicrotasks();
    expect(targets(run.actions, 'evaluate')).toEqual([]);
    expect(targets(run.actions, 'dispatch')).toEqual([]);
    gate.release();
    await pending;
    expect(targets(run.actions, 'dispatch')).toEqual([eventName]);
  });

  test('request rejection stops the event and overlay display pause', async () => {
    const run = loadDemo(demo, { faults: [{ kind: 'post', error }] });
    await expect(run.run()).rejects.toBe(error);
    expect(targets(run.actions, 'dispatch')).toEqual([]);
    expect(waits(run.actions)).toEqual([2000]);
  });

  test('event evaluation failure propagates', async () => {
    const run = loadDemo(demo, { faults: [{ kind: 'evaluate', error }] });
    await expect(run.run()).rejects.toBe(error);
    expect(targets(run.actions, 'dispatch')).toEqual([]);
  });
});

test('babysitter seed is inert, ordered before login and stops all work on failure', async () => {
  const run = loadDemo('babysitter', { faults: [{ kind: 'seed', error }] });
  await expect(run.run()).rejects.toBe(error);
  expect(run.actions).toEqual([{ kind: 'reset', target: '' }, { kind: 'seed', target: '' }]);
});

describe('fake boundary fault detection', () => {
  test('the ordering oracle detects a deliberately unawaited row click', async () => {
    const gate = deferred();
    const run = loadDemo('grocery', { gates: [{ kind: 'click', target: 'text(Milk).first', wait: gate.promise }] },
      source => source.replace('await row.click();', 'void row.click();'));
    const pending = run.run();
    await until(run.actions, 'click', 'text(Milk).first');
    await drainMicrotasks();
    expect(targets(run.actions, 'visible')).toContain('text(Bread).first');
    gate.release();
    await pending;
  });

  test('only named own-property scenario sources can be read', () => {
    expect(() => loadDemo('toString' as Demo)).toThrow('Denied demo source');
    expect(() => loadDemo('unknown' as Demo)).toThrow('Denied demo source');
  });

  test('unknown imports are denied before any callback runs', () => {
    expect(() => loadSynthetic('import fs from "node:fs"; fs.writeFileSync("x", "x");')).toThrow('Denied import: node:fs');
  });

  test('unknown registration hooks and duplicate callbacks are denied', () => {
    expect(() => loadSynthetic('import { test } from "@playwright/test"; test.beforeEach(() => {});')).toThrow('Denied test hook: beforeEach');
    expect(() => loadSynthetic('import { test } from "@playwright/test"; test("a", async () => {}); test("b", async () => {});')).toThrow('Expected exactly one demo callback');
    expect(() => loadSynthetic('export const unused = 1;')).toThrow('Missing demo callback');
  });

  test('unknown page methods and service request paths are denied', async () => {
    const method = loadSynthetic('import { test } from "@playwright/test"; test("a", async ({page}) => { await page.screenshot(); });');
    await expect(method.run()).rejects.toThrow('Denied page property: screenshot');
    const request = loadSynthetic('import { test } from "@playwright/test"; test("a", async ({page}) => { await page.request.post("/api/unlisted", {data:{}}); });');
    await expect(request.run()).rejects.toThrow('Denied request path: /api/unlisted');
    expect(request.actions).toEqual([]);
  });

  test('the callback has no actual process, fetch or timer globals', async () => {
    const run = loadSynthetic('import { test } from "@playwright/test"; test("a", async ({page}) => { if (typeof process !== "undefined" || typeof fetch !== "undefined" || typeof setTimeout !== "undefined") throw new Error("unsafe globals"); await page.waitForTimeout(37); });');
    await run.run();
    expect(run.elapsed()).toBe(37);
  });

  test('the real evaluate callback determines dispatched values', async () => {
    const run = loadSynthetic('import { test } from "@playwright/test"; test("a", async ({page}) => { await page.evaluate(() => window.dispatchEvent(new CustomEvent("prism:away-mode-change", {detail:{enabled:false}}))); });');
    await run.run();
    expect(run.actions.at(-1)).toEqual({ kind: 'dispatch', target: 'prism:away-mode-change', value: { enabled: false } });
  });

  test('evaluate rejects unknown window methods and event types', async () => {
    const method = loadSynthetic('import { test } from "@playwright/test"; test("a", async ({page}) => { await page.evaluate(() => window.fetch("/unlisted")); });');
    await expect(method.run()).rejects.toThrow('Denied window property: fetch');
    const event = loadSynthetic('import { test } from "@playwright/test"; test("a", async ({page}) => { await page.evaluate(() => window.dispatchEvent(new CustomEvent("unlisted", {detail:{enabled:true}}))); });');
    await expect(event.run()).rejects.toThrow('Denied event type');
  });
});
