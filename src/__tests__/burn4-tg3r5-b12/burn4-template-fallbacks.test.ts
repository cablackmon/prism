import { meta, page, render, renderMany, schema, site } from './burn4-render-harness';

test('the real installed engine matches verified MkDocs default rendering policies', () => {
  const batch = renderMany([{ config: site(), page: null }]);
  expect(batch.engine).toEqual({
    jinjaVersion: expect.stringMatching(/^\d+\.\d+/), autoescape: false, undefined: 'Undefined',
  });
});

test('a generated 404 page=None uses site metadata and produces valid JSON-LD', () => {
  const config = site();
  const output = render(config, null);
  expect(meta(output, 'og:title')).toBe(config.site_name);
  expect(meta(output, 'og:description')).toBe(config.site_description);
  expect(meta(output, 'og:url')).toBe(config.site_url);
  expect(meta(output, 'twitter:title')).toBe(config.site_name);
  expect(meta(output, 'twitter:description')).toBe(config.site_description);
  expect(schema(output).name).toBe(config.site_name);
});

test('a populated page takes precedence over all three site fallbacks', () => {
  const output = render(site(), page({
    title: 'Specific title',
    meta: { description: 'Specific description' },
    canonical_url: 'https://docs.invalid/specific/',
  }));
  expect(meta(output, 'og:title')).toBe('Specific title');
  expect(meta(output, 'twitter:title')).toBe('Specific title');
  expect(meta(output, 'og:description')).toBe('Specific description');
  expect(meta(output, 'twitter:description')).toBe('Specific description');
  expect(meta(output, 'og:url')).toBe('https://docs.invalid/specific/');
  expect(meta(output, 'og:site_name')).toBe(site().site_name);
  expect(schema(output).name).toBe(site().site_name);
});

test.each([
  { label: 'missing', value: { meta: { description: 'Page description' } }, expectedDescription: 'Page description' },
  { label: 'empty', value: page({ title: '' }), expectedDescription: 'Synthetic page description.' },
  { label: 'null', value: page({ title: null }), expectedDescription: 'Synthetic page description.' },
])('$label page title falls back independently', ({ value, expectedDescription }) => {
  const config = site();
  const output = render(config, value);
  expect(meta(output, 'og:title')).toBe(config.site_name);
  expect(meta(output, 'twitter:title')).toBe(config.site_name);
  expect(meta(output, 'og:description')).toBe(expectedDescription);
});

test.each([
  { label: 'missing', value: { title: 'Present page title' } },
  { label: 'empty', value: page({ canonical_url: '' }) },
  { label: 'null', value: page({ canonical_url: null }) },
])('$label canonical URL falls back without replacing a page title', ({ value }) => {
  const config = site();
  const output = render(config, value);
  expect(meta(output, 'og:url')).toBe(config.site_url);
  expect(meta(output, 'og:title')).toBe(value?.title);
});

test.each([
  { label: 'missing metadata', value: { title: 'Present title' } },
  { label: 'null metadata', value: page({ meta: null }) },
  { label: 'empty metadata', value: page({ meta: {} }) },
  { label: 'unrelated metadata', value: page({ meta: { category: 'fixture' } }) },
  { label: 'empty description', value: page({ meta: { description: '' } }) },
  { label: 'null description', value: page({ meta: { description: null } }) },
])('$label uses the site description', ({ value }) => {
  const config = site();
  const output = render(config, value);
  expect(meta(output, 'og:description')).toBe(config.site_description);
  expect(meta(output, 'twitter:description')).toBe(config.site_description);
  expect(meta(output, 'og:title')).toBe(value?.title);
});

test('an empty page object safely uses every site fallback', () => {
  const config = site();
  const output = render(config, {});
  expect(meta(output, 'og:title')).toBe(config.site_name);
  expect(meta(output, 'og:description')).toBe(config.site_description);
  expect(meta(output, 'og:url')).toBe(config.site_url);
  expect(schema(output).url).toBe(config.site_url);
});

test('inherited head content appears once before the override metadata', () => {
  const output = render();
  expect(meta(output, 'burn4-base')).toBe('inherited fixture');
  const inherited = output.meta.findIndex((entry) => entry.name === 'burn4-base');
  const social = output.meta.findIndex((entry) => entry.property === 'og:title');
  expect(inherited).toBeLessThan(social);
});

test.each(['https://docs.invalid/', 'https://docs.invalid/nested/handbook/'])(
  'social and JSON-LD images use the configured site base %s',
  (siteUrl) => {
    const output = render(site({ site_url: siteUrl }));
    const image = `${siteUrl}assets/og-image.png`;
    expect(meta(output, 'og:image')).toBe(image);
    expect(meta(output, 'twitter:image')).toBe(image);
    expect(schema(output).image).toBe(image);
    expect(schema(output).screenshot).toBe(image);
  },
);

test('JSON-LD retains site identity while page metadata uses a page-specific description', () => {
  const config = site({ site_name: 'Distinct site', site_description: 'Distinct site description.' });
  const output = render(config, page({ meta: { description: 'Distinct page description.' } }));
  const data = schema(output);
  expect(data.name).toBe(config.site_name);
  expect(data.description).toEqual(expect.stringMatching(/^Distinct site description\. /));
  expect(data.url).toBe(config.site_url);
  expect(meta(output, 'og:description')).toBe('Distinct page description.');
});

test('repeated renders share an Environment without leaking page or config state', () => {
  const first = site({ site_name: 'First site', site_description: 'First description.' });
  const second = site({ site_name: 'Second site', site_description: 'Second description.' });
  const batch = renderMany([
    { config: first, page: page({ title: 'First page' }) },
    { config: second, page: null },
    { config: first, page: page({ title: 'Third page', meta: {} }) },
  ]);
  expect(batch.renders).toHaveLength(3);
  expect(batch.renders.map((entry) => meta(entry, 'og:title'))).toEqual(['First page', 'Second site', 'Third page']);
  expect(meta(batch.renders[1]!, 'og:description')).toBe(second.site_description);
  expect(meta(batch.renders[2]!, 'og:description')).toBe(first.site_description);
  expect(batch.renders.map((entry) => schema(entry).name)).toEqual(['First site', 'Second site', 'First site']);
  expect(batch.renders.map((entry) => meta(entry, 'burn4-base'))).toEqual(Array(3).fill('inherited fixture'));
});
