import {
  ARTIFACT_DIR,
  BOARD_PATH,
  REPORT_PATH,
  finding,
  renderBoard,
  report,
} from './burn4-board-harness';

function successfulBoard(input: Parameters<typeof renderBoard>[0] = {}) {
  const result = renderBoard(input);
  expect(result.error).toBeUndefined();
  expect(result.exitCode).toBeUndefined();
  expect(result.writes.size).toBe(1);
  expect(result.writes.has(BOARD_PATH)).toBe(true);
  expect(result.html).toBeDefined();
  return { ...result, html: result.html! };
}

describe('offline UI audit board renderer', () => {
  test('missing report exits before any reads or writes with the sweep instruction', () => {
    const result = renderBoard({ reportPresent: false });
    expect(result.exitCode).toBe(1);
    expect(result.error).toBeUndefined();
    expect(result.errors).toEqual([
      `No report at ${REPORT_PATH}. Run the sweep first: npm run test:ui-audit`,
    ]);
    expect(result.existenceChecks).toEqual([REPORT_PATH]);
    expect(result.reads).toEqual([]);
    expect(result.writes.size).toBe(0);
    expect(result.logs).toEqual([]);
  });

  test('renders flagged cards in report order and omits clean cards and their screenshots', () => {
    const findings = [
      finding({ severity: 'medium', route: '/synthetic-medium', screenshot: 'medium.png' }),
      finding({ severity: 'ok', route: '/synthetic-clean', screenshot: 'clean.png' }),
      finding({ severity: 'high', route: '/synthetic-high', screenshot: 'high.png' }),
    ];
    const result = successfulBoard({ report: report(findings) });
    expect(result.html.match(/<article class="card /g)).toHaveLength(2);
    expect(result.html).toContain('Flagged (2)');
    expect(result.html).toContain('background:#d97706">MEDIUM');
    expect(result.html).toContain('background:#dc2626">HIGH');
    expect(result.html.indexOf('/synthetic-medium')).toBeLessThan(result.html.indexOf('/synthetic-high'));
    expect(result.html).not.toContain('/synthetic-clean');
    expect(result.existenceChecks).not.toContain(`${ARTIFACT_DIR}/clean.png`);
    expect(result.logs).toEqual([`Board written to ${BOARD_PATH} (2 flagged of 3 checks)`]);
  });

  test('renders all four supplied totals without losing zero values', () => {
    const result = successfulBoard({
      report: { totals: { checks: 17, high: 6, medium: 0, ok: 11 }, findings: [] },
    });
    for (const total of ['<b>17</b> checks', '<b>6</b> high', '<b>0</b> medium', '<b>11</b> clean']) {
      expect(result.html).toContain(total);
    }
  });

  test.each([
    ['missing findings', {}],
    ['null findings', { findings: null }],
    ['empty findings', { findings: [] }],
  ])('renders an empty board with default totals for %s', (_name, input) => {
    const result = successfulBoard({ report: input });
    expect(result.html).toContain('No layout issues flagged');
    expect(result.html).not.toContain('<article');
    for (const label of ['checks', 'high', 'medium', 'clean']) {
      expect(result.html).toContain(`<b>0</b> ${label}`);
    }
    expect(result.existenceChecks).toEqual([REPORT_PATH]);
    expect(result.logs).toEqual([`Board written to ${BOARD_PATH} (0 flagged of 0 checks)`]);
  });

  test('a clean-only report keeps the clean tally and skips screenshot reads', () => {
    const result = successfulBoard({ report: report([finding({ severity: 'ok' })]) });
    expect(result.html).toContain('<b>1</b> checks');
    expect(result.html).toContain('<b>1</b> clean');
    expect(result.html).toContain('No layout issues flagged');
    expect(result.reads).toEqual([REPORT_PATH]);
  });

  test('embeds a nested screenshot once as PNG data in the image and link', () => {
    const image = Buffer.from([0, 1, 2, 127, 128, 255]);
    const uri = `data:image/png;base64,${image.toString('base64')}`;
    const result = successfulBoard({
      report: report([finding({ screenshot: 'nested/synthetic.png' })]),
      files: { [`${ARTIFACT_DIR}/nested/synthetic.png`]: image },
    });
    expect(result.html).toContain(`<a href="${uri}" target="_blank">`);
    expect(result.html).toContain(`<img loading="lazy" src="${uri}" alt="/synthetic-route desktop">`);
    expect(result.reads).toEqual([REPORT_PATH, `${ARTIFACT_DIR}/nested/synthetic.png`]);
    expect(result.html).not.toContain('(no screenshot)');
  });

  test('a missing screenshot renders a fallback without trying to read it', () => {
    const result = successfulBoard();
    expect(result.existenceChecks).toEqual([REPORT_PATH, `${ARTIFACT_DIR}/synthetic.png`]);
    expect(result.reads).toEqual([REPORT_PATH]);
    expect(result.html).toContain('<p class="noshot">(no screenshot)</p>');
    expect(result.html).not.toContain('<img');
  });

  test('escapes report text in route, viewport, summary, overflow description and image alt', () => {
    const text = '<span data-x="a&b">synthetic</span>';
    const escaped = '&lt;span data-x=&quot;a&amp;b&quot;&gt;synthetic&lt;/span&gt;';
    const result = successfulBoard({
      report: report([finding({
        route: text,
        viewport: text,
        summary: text,
        probe: { overflowers: [{ desc: text, overflow: 12, w: 450 }] },
      })]),
      files: { [`${ARTIFACT_DIR}/synthetic.png`]: 'synthetic image bytes' },
    });
    expect(result.html).not.toContain(text);
    expect(result.html).toContain(`<strong>${escaped}</strong>`);
    expect(result.html).toContain(`<p class="summary">${escaped}</p>`);
    expect(result.html).toContain(`<code>${escaped}</code> \u2014 overhang 12px (w 450)`);
    expect(result.html).toContain(`alt="${escaped} ${escaped}"`);
    expect(result.html).toContain(`${escaped} · 1440×900 · scale 100%`);
  });

  test.each([undefined, null, {}, { overflowers: [] }])('omits overflow details for optional probe %p', (probe) => {
    const result = successfulBoard({ report: report([finding({ probe })]) });
    expect(result.html).not.toContain('<details>');
  });

  test('renders every overflow entry and preserves their diagnostic order', () => {
    const result = successfulBoard({ report: report([finding({ probe: { overflowers: [
      { desc: 'synthetic first', overflow: 23, w: 900 },
      { desc: 'synthetic second', overflow: 4, w: 700 },
    ] } })]) });
    expect(result.html).toContain('<details><summary>overhanging elements</summary><ul>');
    expect(result.html.match(/<li>/g)).toHaveLength(2);
    expect(result.html).toContain('overhang 23px (w 900)');
    expect(result.html).toContain('overhang 4px (w 700)');
    expect(result.html.indexOf('synthetic first')).toBeLessThan(result.html.indexOf('synthetic second'));
  });

  test.each([
    ['invalid JSON', { reportText: '{not-json' }, 'SyntaxError'],
    ['null report', { reportText: 'null' }, 'TypeError'],
    ['non-array findings', { report: { findings: {} } }, 'filter is not a function'],
    ['null finding', { report: { findings: [null] } }, 'TypeError'],
    ['missing screenshot', { report: { findings: [{ severity: 'high' }] } }, 'TypeError'],
    ['non-array overflowers', { report: { findings: [{ ...finding(), probe: { overflowers: {} } }] } }, 'map is not a function'],
    ['numeric severity', { report: { findings: [{ ...finding(), severity: 7 }] } }, 'toUpperCase is not a function'],
  ])('a malformed report with %s fails before publishing a partial board', (_name, input, message) => {
    const result = renderBoard(input);
    expect(String(result.error)).toContain(message);
    expect(result.writes.size).toBe(0);
    expect(result.logs).toEqual([]);
    expect(result.exitCode).toBeUndefined();
  });

  test.each([REPORT_PATH, `${ARTIFACT_DIR}/synthetic.png`])('read failure for %s is not reported as success', (readFailureFor) => {
    const result = renderBoard({
      readFailureFor,
      files: { [`${ARTIFACT_DIR}/synthetic.png`]: 'synthetic image bytes' },
    });
    expect(String(result.error)).toContain(`Synthetic read failure: ${readFailureFor}`);
    expect(result.writes.size).toBe(0);
    expect(result.logs).toEqual([]);
  });

  test('a write failure propagates without a success log', () => {
    const failure = new Error('Synthetic output failure');
    const result = renderBoard({ writeFailure: failure });
    expect(result.error).toBe(failure);
    expect(result.writes.size).toBe(0);
    expect(result.logs).toEqual([]);
  });
});
