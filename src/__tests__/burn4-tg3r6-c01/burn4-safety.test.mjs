import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderRecipeHtml } from '../../../scripts/burn4-recipe-print.mjs';
import { withDocument } from './burn4-dom.mjs';

const attack = '</title><script>throw 1</script><img src="https://images.example.test/x" onerror="throw 2">&\'"';

test('hostile markup remains literal text in every rendered recipe field', () => {
  withDocument(renderRecipeHtml({
    name: attack, description: attack, ingredients: [{ heading: attack }, { text: attack }],
    instructions: attack, notes: attack, cuisine: attack, category: attack, tags: [attack],
  }), document => {
    for (const selector of ['title', 'h1', 'header > p', '#ingredients h3', '#ingredients li:last-child', '#instructions li', '#notes p']) {
      assert.equal(document.querySelector(selector)?.textContent, attack, selector);
    }
    assert.deepEqual([...document.querySelectorAll('dd')].map(node => node.textContent), [attack, attack]);
    assert.equal(document.querySelector('.tags')?.textContent, `Tags: ${attack}`);
    assert.equal(document.querySelectorAll('script, img, iframe, object, embed, link, base, form, input, svg, math, audio, video, source').length, 0);
    for (const element of document.querySelectorAll('*')) {
      assert.ok([...element.attributes].every(attribute => !/^on/iu.test(attribute.name)));
      assert.equal(element.hasAttribute('src'), false);
      assert.equal(element.hasAttribute('srcset'), false);
    }
    assert.match(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '', /default-src 'none'/u);
  });
});

test('source URL quoting cannot create attributes or markup', () => {
  const url = 'https://recipes.example.test/?q="<svg/onload=throw(1)>&apostrophe=\'';
  withDocument(renderRecipeHtml({ name: 'Synthetic linked recipe', ingredients: [], url }), document => {
    const anchor = document.querySelector('a');
    assert.equal(document.querySelectorAll('a').length, 1);
    assert.equal(anchor?.textContent, url);
    assert.equal(anchor?.href, new URL(url).href);
    assert.equal(new URL(anchor?.href ?? '').protocol, 'https:');
    assert.equal(document.querySelectorAll('[onload], svg, script').length, 0);
    assert.deepEqual([...anchor?.attributes ?? []].map(attribute => attribute.name).sort(), ['href', 'rel']);
  });
});

for (const url of [
  'javascript:throw(1)', 'JaVaScRiPt:throw(1)', 'data:text/html,<script>throw 1</script>',
  'file:///tmp/example', '//recipes.example.test/x', '/recipe', 'ftp://recipes.example.test/x',
  'https:\\recipes.example.test', ' https://recipes.example.test', 'https://recipes.example.test ',
  'https://recipes.example.test/\njavascript:x', 'https://recipes.example.test/\titem',
  'http://', 'https://[broken', 'https://name@recipes.example.test',
]) {
  test(`rejects unsafe or ambiguous URL form ${JSON.stringify(url)}`, () => {
    assert.throws(() => renderRecipeHtml({ name: 'Synthetic URL check', ingredients: [], url }), /^Error: url:/u);
  });
}

for (const url of ['http://recipes.example.test/a?b=c&d=e', 'HTTPS://recipes.example.test/caf%C3%A9', 'https://recipes.example.test/%0Ajavascript:x']) {
  test(`renders an explicit safe source link for ${url}`, () => {
    withDocument(renderRecipeHtml({ name: 'Synthetic safe link', ingredients: [], url }), document => {
      assert.equal(document.querySelector('a')?.href, new URL(url).href);
      assert.equal(document.querySelector('a')?.textContent, url);
      assert.equal(document.querySelectorAll('[src], [srcset], link').length, 0);
    });
  });
}

/** @type {Array<[string, unknown, RegExp]>} */
const invalid = [
  ['null root', null, /recipe:/u], ['array root', [], /recipe:/u], ['string root', 'recipe', /recipe:/u],
  ['missing name', { ingredients: [] }, /name:/u], ['blank name', { name: ' \n ', ingredients: [] }, /name:/u],
  ['numeric name', { name: 1, ingredients: [] }, /name:/u], ['missing ingredients', { name: 'Synthetic' }, /ingredients:/u],
  ['null ingredients', { name: 'Synthetic', ingredients: null }, /ingredients:/u],
  ['ingredient primitive', { name: 'Synthetic', ingredients: ['1 cup'] }, /ingredients\[0\]/u],
  ['ingredient null', { name: 'Synthetic', ingredients: [null] }, /ingredients\[0\]/u],
  ['ambiguous ingredient', { name: 'Synthetic', ingredients: [{ text: 'One', heading: 'Two' }] }, /ingredients\[0\]/u],
  ['unsupported ingredient shape', { name: 'Synthetic', ingredients: [{ name: 'flour', amount: '1' }] }, /ingredients\[0\]/u],
  ['extra ingredient data', { name: 'Synthetic', ingredients: [{ text: 'flour', notes: 'keep this' }] }, /ingredients\[0\]/u],
  ['blank ingredient', { name: 'Synthetic', ingredients: [{ text: '' }] }, /ingredients\[0\].text/u],
  ['numeric heading', { name: 'Synthetic', ingredients: [{ heading: 2 }] }, /ingredients\[0\].heading/u],
  ['sparse ingredient', { name: 'Synthetic', ingredients: Array(1) }, /ingredients\[0\]/u],
  ['nonarray tags', { name: 'Synthetic', ingredients: [], tags: 'tag' }, /tags:/u],
  ['null tag', { name: 'Synthetic', ingredients: [], tags: [null] }, /tags\[0\]/u],
  ['blank tag', { name: 'Synthetic', ingredients: [], tags: [' '] }, /tags\[0\]/u],
  ['sparse tag', { name: 'Synthetic', ingredients: [], tags: Array(1) }, /tags\[0\]/u],
];
for (const field of ['description', 'instructions', 'notes', 'cuisine', 'category', 'url']) {
  invalid.push([`invalid ${field} type`, { name: 'Synthetic', ingredients: [], [field]: {} }, new RegExp(`${field}:`, 'u')]);
}
for (const field of ['prepTime', 'cookTime', 'servings']) {
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2']) {
    invalid.push([`invalid ${field} ${String(value)}`, { name: 'Synthetic', ingredients: [], [field]: value }, new RegExp(`${field}:`, 'u')]);
  }
}
invalid.push(['zero servings', { name: 'Synthetic', ingredients: [], servings: 0 }, /servings:/u]);
for (const [label, input, pattern] of invalid) {
  test(`rejects ${label} with a field diagnostic`, () => assert.throws(() => renderRecipeHtml(input), pattern));
}

for (const [field, limit] of /** @type {Array<[string, number]>} */ ([
  ['name', 512], ['description', 65536], ['instructions', 65536], ['notes', 65536], ['cuisine', 512], ['category', 512],
])) {
  test(`enforces ${field} length while retaining its exact limit`, () => {
    const recipe = { name: 'Synthetic', ingredients: [], [field]: 'x'.repeat(limit) };
    assert.doesNotThrow(() => renderRecipeHtml(recipe));
    assert.throws(() => renderRecipeHtml({ ...recipe, [field]: 'x'.repeat(limit + 1) }), new RegExp(`${field}:`, 'u'));
  });
}

test('enforces ingredient, step, tag and URL bounds without truncating', () => {
  const base = { name: 'Synthetic limits', ingredients: [] };
  assert.doesNotThrow(() => renderRecipeHtml({ ...base, ingredients: Array.from({ length: 500 }, () => ({ text: 'x'.repeat(4096) })) }));
  assert.throws(() => renderRecipeHtml({ ...base, ingredients: Array.from({ length: 501 }, () => ({ text: 'x' })) }), /ingredients:/u);
  assert.throws(() => renderRecipeHtml({ ...base, ingredients: [{ text: 'x'.repeat(4097) }] }), /ingredients\[0\].text/u);
  assert.doesNotThrow(() => renderRecipeHtml({ ...base, instructions: Array(1000).fill('step').join('\n') }));
  assert.throws(() => renderRecipeHtml({ ...base, instructions: Array(1001).fill('step').join('\n') }), /instructions:/u);
  assert.doesNotThrow(() => renderRecipeHtml({ ...base, tags: Array(64).fill('x'.repeat(128)) }));
  assert.throws(() => renderRecipeHtml({ ...base, tags: Array(65).fill('x') }), /tags:/u);
  assert.throws(() => renderRecipeHtml({ ...base, tags: ['x'.repeat(129)] }), /tags\[0\]/u);
  assert.throws(() => renderRecipeHtml({ ...base, url: `https://recipes.example.test/${'x'.repeat(4096)}` }), /url:/u);
});

test('rejects controls and malformed Unicode while preserving valid astral text', () => {
  for (const value of ['bad\0text', 'bad\u007ftext', 'bad\ud800text']) {
    assert.throws(() => renderRecipeHtml({ name: value, ingredients: [] }), /name:.*unsupported/u);
  }
  withDocument(renderRecipeHtml({ name: 'Synthetic 🥣 café', ingredients: [] }), document => {
    assert.equal(document.querySelector('h1')?.textContent, 'Synthetic 🥣 café');
  });
});
