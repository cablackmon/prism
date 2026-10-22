import { meta, page, render, schema, site } from './burn4-render-harness';

test.each([
  'Café calendar and 家庭の予定',
  "A parent's calendar",
  'Planner & chores <today> > tomorrow',
  'Calendar / tasks: one, two; three!',
])('ordinary page metadata round-trips through HTML attributes: %s', (value) => {
  const output = render(site(), page({ title: value, meta: { description: value } }));
  expect(meta(output, 'og:title')).toBe(value);
  expect(meta(output, 'twitter:title')).toBe(value);
  expect(meta(output, 'og:description')).toBe(value);
  expect(meta(output, 'twitter:description')).toBe(value);
});

test.each([
  'Café calendar and 家庭の予定',
  "A parent's calendar",
  'Planner & chores <today> > tomorrow',
])('site values round-trip in both HTML metadata and parsed JSON-LD: %s', (value) => {
  const config = site({ site_name: value, site_description: value });
  const output = render(config, null);
  const data = schema(output);
  expect(meta(output, 'og:title')).toBe(value);
  expect(meta(output, 'og:description')).toBe(value);
  expect(meta(output, 'og:site_name')).toBe(value);
  expect(data.name).toBe(value);
  expect(typeof data.description).toBe('string');
  expect((data.description as string).startsWith(`${value} `)).toBe(true);
});

test('ordinary canonical query punctuation survives the HTML parser', () => {
  const canonical = 'https://docs.invalid/fixture/?section=calendar&mode=wide';
  const output = render(site(), page({ canonical_url: canonical }));
  expect(meta(output, 'og:url')).toBe(canonical);
});
