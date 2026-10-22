import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderRecipeHtml } from '../../../scripts/burn4-recipe-print.mjs';
import { withDocument } from './burn4-dom.mjs';

test('minimal recipe has a complete document and omits absent sections', () => {
  withDocument(renderRecipeHtml({ name: 'Synthetic soup', ingredients: [] }), document => {
    assert.equal(document.doctype?.name, 'html');
    assert.equal(document.documentElement.lang, 'en');
    assert.equal(document.querySelector('meta[charset]')?.getAttribute('charset'), 'utf-8');
    assert.equal(document.querySelector('meta[name="viewport"]')?.getAttribute('content'), 'width=device-width, initial-scale=1');
    assert.equal(document.title, 'Synthetic soup');
    assert.equal(document.querySelectorAll('h1').length, 1);
    assert.equal(document.querySelector('h1')?.textContent, 'Synthetic soup');
    assert.equal(document.querySelectorAll('section, dl, footer, .tags').length, 0);
  });
});

test('complete recipe preserves quantities, headings, instruction order, notes and Unicode', () => {
  const recipe = {
    name: 'Synthetic café bowl 🥣', description: 'A simple synthetic meal.',
    ingredients: [{ heading: 'Sauce' }, { text: '1/2 cup flour & 2 tbsp water' }, { text: '2 onions, sliced' }],
    instructions: ' Mix slowly.\r\n\r\nCook for 5 minutes.\nServe café style. ',
    prepTime: 15, cookTime: 30, servings: 4, cuisine: 'Test cuisine', category: 'Main dish',
    tags: ['quick', 'plant-based'], notes: 'Keep covered.\nStir before serving.',
    url: 'https://recipes.example.test/soup?size=2&kind=simple',
    id: 'not-for-print', createdByName: 'not-for-print', imageUrl: 'https://images.example.test/no-load.png',
  };
  const before = structuredClone(recipe);
  const html = renderRecipeHtml(recipe);
  assert.deepEqual(recipe, before);
  assert.equal(renderRecipeHtml(recipe), html);
  assert.ok(!html.includes('not-for-print'));
  withDocument(html, document => {
    assert.equal(document.querySelector('h1')?.textContent, recipe.name);
    assert.deepEqual([...document.querySelectorAll('#ingredients li')].map(node => node.textContent), [
      'Sauce', '1/2 cup flour & 2 tbsp water', '2 onions, sliced',
    ]);
    assert.equal(document.querySelector('#ingredients h3')?.textContent, 'Sauce');
    assert.deepEqual([...document.querySelectorAll('#instructions li')].map(node => node.textContent), [
      ' Mix slowly.', 'Cook for 5 minutes.', 'Serve café style. ',
    ]);
    assert.equal(document.querySelector('#notes p')?.textContent, recipe.notes);
    assert.deepEqual([...document.querySelectorAll('dd')].map(node => node.textContent), [
      '15 minutes', '30 minutes', '4', 'Test cuisine', 'Main dish',
    ]);
    assert.equal(document.querySelector('.tags')?.textContent, 'Tags: quick, plant-based');
    assert.equal(document.querySelector('a')?.href, recipe.url);
    assert.equal(document.querySelector('a')?.textContent, recipe.url);
    assert.equal(document.querySelectorAll('img').length, 0);
  });
});

test('zero minutes stay visible and optional blank/null fields are omitted', () => {
  withDocument(renderRecipeHtml({
    name: 'Synthetic no-cook bowl', ingredients: [], prepTime: 0, cookTime: 0,
    description: null, instructions: ' \n ', notes: '', cuisine: null, category: '  ', tags: null, url: '', servings: null,
  }), document => {
    assert.deepEqual([...document.querySelectorAll('dd')].map(node => node.textContent), ['0 minutes', '0 minutes']);
    assert.equal(document.querySelectorAll('section, footer, .tags').length, 0);
    assert.ok(!document.body.textContent?.includes('undefined'));
    assert.ok(!document.body.textContent?.includes('null'));
  });
});

test('print styling is inline with page margins and readable wrapping/break rules', () => {
  withDocument(renderRecipeHtml({ name: 'Synthetic print case', ingredients: [{ text: '1 item' }] }), document => {
    const style = document.querySelector('style');
    assert.ok(style?.sheet);
    const css = [...style.sheet.cssRules].map(rule => rule.cssText).join('\n');
    assert.match(css, /@media print/u);
    assert.match(css, /@page.*18mm/su);
    assert.match(css, /break-inside: avoid/u);
    assert.match(css, /break-after: avoid/u);
    assert.match(css, /white-space: pre-wrap/u);
    assert.ok(!/url\s*\(|@import|(?:^|[;{])\s*(?:min-|max-)?height\s*:/iu.test(css));
  });
});

test('ingredient heading-only recipes and single instruction retain their content', () => {
  withDocument(renderRecipeHtml({
    name: 'Synthetic section', ingredients: [{ heading: 'Prepare next' }], instructions: 'One intact instruction.',
  }), document => {
    assert.equal(document.querySelector('#ingredients h3')?.textContent, 'Prepare next');
    assert.equal(document.querySelector('#instructions ol')?.children.length, 1);
    assert.equal(document.querySelector('#instructions li')?.textContent, 'One intact instruction.');
  });
});
