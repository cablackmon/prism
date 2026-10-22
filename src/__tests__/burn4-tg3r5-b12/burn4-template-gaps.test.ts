import { meta, page, render, schema, site } from './burn4-render-harness';

const direct = (globalThis as typeof globalThis & { burn4DirectGap?: boolean }).burn4DirectGap === true;
const gap = direct ? test : test.failing;

gap.each([
  { label: 'quoted title', title: 'Calendar "wide" view', description: 'Safe description', key: 'og:title' },
  { label: 'quoted description', title: 'Safe title', description: 'Calendar "wide" view', key: 'og:description' },
  { label: 'literal entity title', title: 'Calendar &copy; fixture', description: 'Safe description', key: 'og:title' },
  { label: 'literal entity description', title: 'Safe title', description: 'Calendar &copy; fixture', key: 'og:description' },
])('KNOWN GAP: HTML attribute encoding corrupts $label', ({ title, description, key }) => {
  const output = render(site(), page({ title, meta: { description } }));
  expect(meta(output, key)).toBe(key === 'og:title' ? title : description);
});

gap.each([
  { label: 'quoted site name', config: site({ site_name: 'Calendar "wide" view' }) },
  { label: 'multiline description', config: site({ site_description: 'Calendar\nsecond line' }) },
])('KNOWN GAP: JSON string encoding rejects $label', ({ config }) => {
  const output = render(config, null);
  expect(output.schemas).toHaveLength(1);
  expect(output.schemas[0]!.error).toBeNull();
});

gap('KNOWN GAP: JSON string encoding changes literal backslash sequences in site names', () => {
  const value = 'Calendar\\notes';
  const output = render(site({ site_name: value }), null);
  expect(schema(output).name).toBe(value);
});

gap('KNOWN GAP: JSON string encoding changes literal backslash sequences in descriptions', () => {
  const value = 'Calendar\\tasks';
  const output = render(site({ site_description: value }), null);
  expect((schema(output).description as string).startsWith(`${value} `)).toBe(true);
});

gap('KNOWN GAP: an embedded closing-script delimiter truncates JSON-LD content', () => {
  const output = render(site({ site_name: 'Calendar </script> fixture' }), null);
  expect(output.schemas).toHaveLength(1);
  expect(output.schemas[0]!.error).toBeNull();
});
