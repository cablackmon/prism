import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCatalogs} from '../../../scripts/burn4-icu-catalog-audit.mjs';
import {pair, expectCodes} from './burn4-test-helpers.mjs';

test('missing translation is informational by default and an error in complete mode', () => {
  const partial = pair({one: 'One', two: 'Two'}, {one: 'Eins'});
  expectCodes(partial, ['missing_translation']);
  assert.equal(partial.ok, true);
  assert.equal(partial.fallbacks, 1);
  const complete = pair({one: 'One', two: 'Two'}, {one: 'Eins'}, {requireComplete: true});
  expectCodes(complete, ['missing_translation']);
  assert.equal(complete.ok, false);
});

test('orphan translations warn while known translated messages are counted', () => {
  const result = pair({one: 'One'}, {one: 'Eins', retired: 'Alt'});
  expectCodes(result, ['orphan_translation']);
  assert.equal(result.warnings, 1);
  assert.equal(result.translatedMessages, 1);
  assert.equal(result.ok, true);
});

test('argument renaming reports both missing and extra arguments', () => {
  const result = pair({hello: 'Hello {name}'}, {hello: 'Hallo {person}'});
  expectCodes(result, ['missing_argument', 'extra_argument']);
  assert.deepEqual(result.diagnostics.map(item => [item.code, item.subject]), [['extra_argument', 'person'], ['missing_argument', 'name']]);
});

test('an argument appearing only in a nested non-default branch is required', () => {
  const source = '{audience, select, special {{n, plural, one {{guest}} other {#}}} other {Welcome}}';
  const target = '{audience, select, special {{n, plural, one {Welcome} other {#}}} other {Welcome}}';
  expectCodes(pair({message: source}, {message: target}), ['missing_argument']);
});

test('extra arguments inside nested target plural branches fail', () => {
  const source = '{n, plural, one {One} other {#}}';
  const target = '{n, plural, one {{extra}} other {#}}';
  expectCodes(pair({message: source}, {message: target}), ['extra_argument']);
});

for (const [source, target] of [
  ['Hello {name}', 'Hallo {name, number}'],
  ['{n, number}', '{n, date}'],
  ['{when, date}', '{when, number}'],
  ['{n, select, other {x}}', '{n, number}'],
]) {
  test(`translation cannot narrow or change argument type: ${source} to ${target}`, () => {
    expectCodes(pair({message: source}, {message: target}), ['argument_type_mismatch']);
  });
}

test('typed source arguments may be used as plain values by a locale without plurals', () => {
  expectCodes(pair({message: '{n, plural, one {# item} other {# items}}'}, {message: '{n} items'}), []);
});

test('translation may select on an already supplied number or plain value', () => {
  expectCodes(pair({message: '{n, number}'}, {message: '{n, select, other {items}}'}), []);
  expectCodes(pair({message: '{person}'}, {message: '{person, select, other {Welcome}}'}), []);
});

test('date/time and number/plural formatting share their compatible input contracts', () => {
  expectCodes(pair({message: '{when, date} {n, number}'}, {message: '{when, time} {n, plural, other {#}}'}), []);
});

test('locale-specific plural categories, option order and offsets may differ', () => {
  const source = '{n, plural, =0 {Zero} one {# item} other {# items}}';
  const target = '{n, plural, offset:1 few {# few} other {# other} many {# many} =0 {Zero} one {# one}}';
  expectCodes(pair({message: source}, {message: target}), []);
});

test('argument order, repeated compatible use and rich-text nesting can differ', () => {
  expectCodes(pair({message: '<b>{name}</b> <i>{n, number}</i>'}, {message: '<i><b>{n, number} {name} {name}</b></i>'}), []);
});

test('rich tag rename reports missing and extra tags independently of arguments', () => {
  const result = pair({message: '<b>{name}</b>'}, {message: '<strong>{name}</strong>'});
  expectCodes(result, ['missing_tag', 'extra_tag']);
  assert.deepEqual(result.diagnostics.map(item => item.subject), ['strong', 'b']);
});

for (const [source, target] of [
  [{nav: {save: 'Save'}}, {nav: 'Changed'}],
  [{nav: 'Source'}, {nav: {save: 'Changed'}}],
]) {
  test(`namespace and message collision is an error without fallback/orphan cascades: ${JSON.stringify(source)}`, () => {
    expectCodes(pair(source, target), ['namespace_collision']);
  });
}

test('all locales are checked and report ordering is independent of input order', () => {
  const source = {file: 'en.json', text: '{"a":"Hello {name}","b":"B"}'};
  const locales = [{file: 'zz.json', text: '{"a":"Wrong"}'}, {file: 'aa.json', text: '{"a":"Wrong {other}"}'}];
  const result = auditCatalogs(source, locales);
  assert.deepEqual(result, auditCatalogs(source, [...locales].reverse()));
  assert.equal(result.catalogs, 3);
  assert.equal(result.fallbacks, 2);
  assert.equal(result.errors, 3);
});

test('repeated catalog labels are errors and are not counted as extra translated messages', () => {
  const source = {file: 'en.json', text: '{"a":"A"}'};
  const target = {file: 'de.json', text: '{"a":"B"}'};
  const result = auditCatalogs(source, [target, target, source]);
  expectCodes(result, ['duplicate_catalog', 'duplicate_catalog']);
  assert.equal(result.translatedMessages, 1);
});

test('failed translation syntax is not misreported as missing translation fallback', () => {
  const result = pair({a: 'A'}, {a: '{broken'});
  expectCodes(result, ['invalid_icu']);
  assert.equal(result.fallbacks, 0);
  assert.equal(result.translatedMessages, 0);
});
