import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { withDocument } from './burn4-dom.mjs';

const script = fileURLToPath(new URL('../../../scripts/burn4-recipe-print.mjs', import.meta.url));
const directory = mkdtempSync('/tmp/burn4-recipe-print-');
after(() => rmSync(directory, { recursive: true, force: true }));

/** @param {string[]} args @returns {import('node:child_process').SpawnSyncReturns<string>} */
function run(args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: directory, env: {}, encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

/** @param {string} name @param {string | Uint8Array} contents @returns {string} */
function fixture(name, contents) {
  const path = join(directory, name);
  writeFileSync(path, contents);
  return path;
}

for (const option of ['--help', '-h']) {
  test(`CLI ${option} prints usage successfully without reading a file`, () => {
    const result = run([option]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^Usage:/u);
    assert.equal(result.stderr, '');
  });
}

for (const args of [[], ['--unknown'], ['-'], ['--help', 'extra'], ['one.json', 'two.json']]) {
  test(`CLI rejects arguments ${JSON.stringify(args)} without HTML output`, () => {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Usage:/u);
  });
}

test('CLI prints HTML from one explicit file without changing input or creating files', () => {
  const path = fixture('recipe with spaces.json', JSON.stringify({
    name: 'Synthetic CLI café', ingredients: [{ text: '1 cup oats' }], instructions: 'Mix.\nServe.', servings: 2,
  }));
  const before = readFileSync(path);
  const filesBefore = readdirSync(directory).sort();
  const first = run([path]);
  const second = run([path]);
  assert.equal(first.status, 0);
  assert.equal(first.stderr, '');
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /^<!doctype html>/u);
  assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(readdirSync(directory).sort(), filesBefore);
  withDocument(first.stdout, document => {
    assert.equal(document.querySelector('h1')?.textContent, 'Synthetic CLI café');
    assert.equal(document.querySelector('#ingredients li')?.textContent, '1 cup oats');
    assert.deepEqual([...document.querySelectorAll('#instructions li')].map(node => node.textContent), ['Mix.', 'Serve.']);
  });
});

test('CLI import is silent and does not execute argument processing', () => {
  const moduleUrl = new URL('../../../scripts/burn4-recipe-print.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)});`], {
    cwd: directory, env: {}, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('CLI missing file produces an error code without echoing its input path', () => {
  const result = run([join(directory, 'synthetic-private-marker.json')]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Cannot read input file \(ENOENT\)/u);
  assert.ok(!result.stderr.includes('synthetic-private-marker'));
});

test('CLI rejects a directory as a nonregular input without hanging', () => {
  const result = run([directory]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /regular JSON file/u);
});

for (const [label, contents] of /** @type {Array<[string, string | Uint8Array]>} */ ([
  ['empty JSON', ''], ['malformed JSON', '{"synthetic-private-marker":'],
  ['invalid UTF-8', Buffer.from([0xc3, 0x28])],
  ['invalid recipe', '{"name":"synthetic-private-marker"}'],
  ['nonobject JSON', 'null'],
  ['nonfinite number', '{"name":"Synthetic","ingredients":[],"cookTime":1e999}'],
])) {
  test(`CLI ${label} fails before writing any HTML and keeps raw input out of diagnostics`, () => {
    const result = run([fixture(`${label}.json`, contents)]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Recipe print:/u);
    assert.ok(!result.stderr.includes('synthetic-private-marker'));
  });
}

test('CLI accepts a UTF-8 BOM and retains Unicode text', () => {
  const input = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ name: 'Synthetic café 🥣', ingredients: [] }))]);
  const result = run([fixture('bom.json', input)]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  withDocument(result.stdout, document => assert.equal(document.title, 'Synthetic café 🥣'));
});

test('CLI accepts exactly 1 MiB and rejects a larger file before parsing', () => {
  const json = JSON.stringify({ name: 'Synthetic boundary', ingredients: [] });
  const exact = json.padEnd(1024 * 1024, ' ');
  const good = run([fixture('exact-limit.json', exact)]);
  assert.equal(good.status, 0);
  assert.equal(good.stderr, '');
  const bad = run([fixture('over-limit.json', `${exact} `)]);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.match(bad.stderr, /1 MiB file limit/u);
});

test('CLI closed stdout fails concisely without an unhandled error or stack', async () => {
  const path = fixture('closed-output.json', JSON.stringify({ name: 'Synthetic pipe', ingredients: [] }));
  const child = spawn(process.execPath, [script, path], { cwd: directory, env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.destroy();
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, 'close');
  assert.equal(code, 1);
  assert.equal(signal, null);
  assert.equal(stderr, 'Recipe print: Cannot write output.\n');
});
