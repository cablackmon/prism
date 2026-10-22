import { baselineGroceries } from './burn4-baseline';
import { gapCases } from './burn4-gap-cases';
import { loadDemo, type Demo } from './burn4-harness';

function intendedFix(demo: Demo, source: string): string {
  let fixed: string;
  if (demo === 'grocery') {
    fixed = source.replace(/const items = \[[^\n]+\];/, `const items = ${JSON.stringify(baselineGroceries)};`);
  } else if (demo === 'recipe') {
    fixed = source.replace('text=Carne Asada', 'text=Sheet Pan Meatball Pitas');
  } else {
    fixed = source.replace('await page.request.post(', 'const activation = await page.request.post(')
      .replace('  // Dispatch custom event', '  if (!activation.ok()) return;\n\n  // Dispatch custom event');
  }
  expect(fixed).not.toBe(source);
  return fixed;
}

test.each(gapCases)('desired contract passes under its intended in-memory fix: $name', async gap => {
  // No source file changes. Exercise the exact same desired-contract body.
  await gap.run((demo, options) => loadDemo(demo, options, source => intendedFix(demo, source)));
});

test.each(gapCases.slice(2))('desired mode contract also accepts a fail-fast HTTP fix: $name', async gap => {
  await gap.run((demo, options) => loadDemo(demo, options, source => {
    const fixed = intendedFix(demo, source).replace('if (!activation.ok()) return;', 'if (!activation.ok()) throw new Error("activation rejected");');
    expect(fixed).toContain('throw new Error("activation rejected")');
    return fixed;
  }));
});
