import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCatalogs} from '../../../scripts/burn4-icu-catalog-audit.mjs';
import {pair, expectCodes} from './burn4-test-helpers.mjs';

test('nested literal messages produce accurate counts without changing inputs', () => {
  const source = Object.freeze({file: 'en.json', text: '{"nav":{"save":"Save"},"hello":"Hello {name}"}'});
  const target = Object.freeze({file: 'de.json', text: '{"hello":"Hallo {name}","nav":{"save":"Speichern"}}'});
  const inputs = [target];
  const before = JSON.stringify({source, inputs});
  const result = auditCatalogs(source, inputs);
  assert.equal(result.ok, true);
  assert.equal(result.sourceMessages, 2);
  assert.equal(result.translatedMessages, 2);
  assert.equal(result.catalogs, 2);
  assert.equal(JSON.stringify({source, inputs}), before);
});

for (const text of ['{"key":"ok",}', '{"key":NaN}', '{/* comment */"key":"ok"}', '{"key":"unterminated}', '\ufeff{"key":"ok"}']) {
  test(`strict JSON rejects syntax case ${JSON.stringify(text)}`, () => {
    const result = auditCatalogs({file: 'en.json', text: '{"key":"ok"}'}, [{file: 'de.json', text}]);
    expectCodes(result, ['invalid_json']);
  });
}

for (const root of [null, [], 5, true, 'message']) {
  test(`catalog root rejects ${JSON.stringify(root)}`, () => {
    expectCodes(pair({key: 'valid'}, root), ['invalid_root']);
  });
}

test('raw duplicate names include the repeated key location and escaped pointer', () => {
  const result = auditCatalogs(
    {file: 'en.json', text: '{"a/b~c":"valid"}'},
    [{file: 'de.json', text: '{\n  "a/b~c":"first",\n  "a/b~c":"second"\n}'}],
  );
  expectCodes(result, ['duplicate_key']);
  assert.deepEqual(result.diagnostics[0], {
    severity: 'error', code: 'duplicate_key', file: 'de.json', path: '/a~1b~0c',
    message: 'JSON object contains a repeated key.', line: 3, column: 3,
  });
});

test('escaped Unicode names count as duplicates inside namespaces', () => {
  const result = auditCatalogs(
    {file: 'en.json', text: '{"nav":{"save":"Save"}}'},
    [{file: 'de.json', text: '{"nav":{"save":"First","\\u0073ave":"Second"}}'}],
  );
  expectCodes(result, ['duplicate_key']);
  assert.equal(result.diagnostics[0]?.path, '/nav/save');
});

test('duplicates inside an invalid array are still reported', () => {
  const result = auditCatalogs(
    {file: 'en.json', text: '{"key":"valid"}'},
    [{file: 'de.json', text: '{"key":[{"a":"A","a":"B"}]}'}],
  );
  expectCodes(result, ['duplicate_key', 'invalid_message_type']);
  assert.equal(result.diagnostics.find(item => item.code === 'duplicate_key')?.path, '/key/0/a');
});

for (const leaf of [null, [], ['text'], 9, false]) {
  test(`message leaf rejects ${JSON.stringify(leaf)}`, () => {
    expectCodes(pair({key: 'valid'}, {key: leaf}), ['invalid_message_type']);
  });
}

for (const leaf of ['', ' \n\t ']) {
  test(`message leaf rejects empty text ${JSON.stringify(leaf)}`, () => {
    expectCodes(pair({key: 'valid'}, {key: leaf}), ['empty_message']);
  });
}

test('empty locale namespaces preserve source fallback', () => {
  const result = pair({nav: {save: 'Save'}}, {nav: {}});
  expectCodes(result, ['missing_translation']);
  assert.equal(result.fallbacks, 1);
  assert.equal(result.ok, true);
});

test('source catalog must contain a message', () => {
  expectCodes(pair({}, {}), ['empty_source']);
  expectCodes(pair({nav: {}}, {}), ['empty_source']);
});

test('literal dots and slash keys remain distinct from nested key paths', () => {
  const result = pair({'a.b': 'Dot', a: {b: 'Nested'}, 'a/b': 'Slash'}, {'a.b': 'Punkt', a: {b: 'Tief'}, 'a/b': 'Strich'});
  expectCodes(result, []);
  assert.equal(result.sourceMessages, 3);
});

test('prototype-shaped JSON keys are ordinary own properties', () => {
  const text = '{"__proto__":{"toString":"Message"},"constructor":"Another"}';
  const result = auditCatalogs({file: 'en.json', text}, [{file: 'de.json', text}]);
  expectCodes(result, []);
  assert.equal(result.sourceMessages, 2);
  assert.equal(Object.prototype.hasOwnProperty.call({}, 'polluted'), false);
});

test('invalid source syntax is reported once without misleading translation drift', () => {
  const result = auditCatalogs({file: 'en.json', text: '{'}, [{file: 'de.json', text: '{"key":"Valid"}'}]);
  expectCodes(result, ['invalid_json']);
  assert.equal(result.sourceMessages, 0);
});
