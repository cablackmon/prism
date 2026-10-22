import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { runCli, suggestWeekend } from '../../../scripts/burn4-weekend-suggest.mjs';
import { scenario } from './burn4-helpers.mjs';

const scriptURL = new URL('../../../scripts/burn4-weekend-suggest.mjs', import.meta.url);
const script = fileURLToPath(scriptURL);
const directory = mkdtempSync('/tmp/burn4-weekend-');
after(() => rmSync(directory, { recursive: true, force: true }));
const maxBytes = 2 * 1024 * 1024;

/** @param {string[]} args */
function actual(args) {
  const result = spawnSync(process.execPath, [script, ...args], { env: {}, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

/** @param {Uint8Array | Error} [input] */
function fake(input = Buffer.from(JSON.stringify(scenario()))) {
  const captured = { reads: 0, output: '', error: '', path: '', bound: 0 };
  /** @type {import('../../../scripts/burn4-weekend-suggest.mjs').CliIO} */
  const io = {
    async readFile(path, bound) { captured.reads += 1; captured.path = path; captured.bound = bound; if (input instanceof Error) throw input; return input; },
    stdout(text) { captured.output += text; },
    stderr(text) { captured.error += text; },
  };
  return { captured, io };
}

test('injected CLI emits exactly deterministic JSON and one newline', async () => {
  const { captured, io } = fake();
  assert.equal(await runCli(['input with spaces.json'], io), 0);
  assert.equal(captured.reads, 1);
  assert.equal(captured.path, 'input with spaces.json');
  assert.equal(captured.bound, maxBytes);
  assert.equal(captured.output, `${JSON.stringify(suggestWeekend(scenario()), null, 2)}\n`);
  assert.equal(captured.error, '');
});

test('help and argument failures complete without reading any file', async () => {
  const help = fake(new Error('Read must not run'));
  assert.equal(await runCli(['--help'], help.io), 0);
  assert.match(help.captured.output, /^Usage:/);
  assert.equal(help.captured.reads, 0);
  assert.equal(help.captured.error, '');
  for (const args of [[], ['--unknown'], ['input', 'extra'], ['--help', 'extra'], ['']]) {
    const { captured, io } = fake(new Error('Read must not run'));
    assert.equal(await runCli(args, io), 1);
    assert.equal(captured.reads, 0);
    assert.equal(captured.output, '');
    assert.match(captured.error, /Use --help/);
    assert.ok(!captured.error.includes('extra'));
  }
  const malformed = fake();
  assert.equal(await Reflect.apply(runCli, undefined, [[1], malformed.io]), 1);
  assert.equal(malformed.captured.reads, 0);
});

test('read, oversized, nonbyte, JSON, UTF-8 and schema failures hide supplied values', async () => {
  const marker = 'PRIVATE_INERT_MARKER';
  for (const input of [new Error(marker), Buffer.alloc(maxBytes + 1), Buffer.from(`{"bad":"${marker}"`), Buffer.from([0xff]), Buffer.from(JSON.stringify(scenario({ date: marker }))), Buffer.alloc(0)]) {
    const { captured, io } = fake(input);
    assert.equal(await runCli([marker], io), 1);
    assert.equal(captured.output, '');
    assert.ok(captured.error.length > 0);
    assert.ok(!captured.error.includes(marker));
  }
  const { captured, io } = fake();
  Object.defineProperty(io, 'readFile', { value: async () => marker });
  assert.equal(await runCli([marker], io), 1);
  assert.equal(captured.output, '');
  assert.ok(!captured.error.includes(marker));
});

test('asynchronous output failures return failure without exposing stream errors', async () => {
  const marker = 'PRIVATE_STREAM_MARKER';
  const output = fake();
  output.io.stdout = async () => { throw new Error(marker); };
  assert.equal(await runCli(['input'], output.io), 1);
  assert.equal(output.captured.error, 'Unable to write output.\n');
  const diagnostic = fake(new Error(marker));
  diagnostic.io.stderr = async () => { throw new Error(marker); };
  assert.equal(await runCli(['input'], diagnostic.io), 1);
  output.io.stderr = async () => { throw new Error(marker); };
  assert.equal(await runCli(['--help'], output.io), 1);
});

test('actual CLI reads a spaced regular path without changing file or directory contents', () => {
  const path = join(directory, 'synthetic outing input.json');
  const source = Buffer.from(JSON.stringify(scenario()));
  writeFileSync(path, source);
  const before = readdirSync(directory);
  const result = actual([path]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify(suggestWeekend(scenario()), null, 2)}\n`);
  assert.deepEqual(readFileSync(path), source);
  assert.deepEqual(readdirSync(directory), before);
  assert.equal(actual([path]).stdout, result.stdout);
});

test('actual CLI help/bad arguments/missing files/directories have controlled outputs', () => {
  const help = actual(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage:/);
  assert.equal(help.stderr, '');
  for (const args of [[], ['--unknown'], [join(directory, 'MISSING_INERT_MARKER')], [directory]]) {
    const result = actual(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.length > 0);
    assert.ok(!result.stderr.includes(directory));
    assert.ok(!result.stderr.includes('MISSING_INERT_MARKER'));
  }
});

test('actual reader accepts exactly 2 MiB, rejects one more byte and counts UTF-8 bytes', () => {
  const path = join(directory, 'bounded.json');
  const json = Buffer.from(JSON.stringify(scenario()));
  writeFileSync(path, Buffer.concat([json, Buffer.alloc(maxBytes - json.byteLength, 0x20)]));
  assert.equal(actual([path]).status, 0);
  writeFileSync(path, Buffer.concat([json, Buffer.alloc(maxBytes + 1 - json.byteLength, 0x20)]));
  const oversized = actual([path]);
  assert.equal(oversized.status, 1);
  assert.equal(oversized.stdout, '');
  assert.match(oversized.stderr, /within 2097152 bytes/);
  const multibyte = JSON.stringify({ ...scenario(), metadata: 'é'.repeat(1100000) });
  assert.ok(multibyte.length < maxBytes);
  assert.ok(Buffer.byteLength(multibyte) > maxBytes);
  writeFileSync(path, multibyte);
  assert.equal(actual([path]).status, 1);
});

test('actual malformed JSON, UTF-8 and schema diagnostics do not echo source excerpts', () => {
  const path = join(directory, 'malformed.json');
  for (const bytes of [Buffer.from('{"PRIVATE_MARKER"'), Buffer.from([0xff]), Buffer.from('  '), Buffer.from(JSON.stringify(scenario({ hemisphere: 'PRIVATE_MARKER' })))]) {
    writeFileSync(path, bytes);
    const result = actual([path]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes('PRIVATE_MARKER'));
  }
});

test('default descriptor reader caps growth after a stale stat and always closes', () => {
  const child = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import fsp from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    let reads=0, closed=0;
    fsp.open = async (_path, flags) => {
      assert.ok(flags & fs.constants.O_NONBLOCK);
      return { stat: async () => ({ isFile: () => true, size: 0 }),
        read: async (buffer, offset, length) => { reads++; assert.equal(length, 2097153); buffer.fill(0, offset, offset+length); return { bytesRead: length }; },
        close: async () => { closed++; } };
    };
    syncBuiltinESMExports();
    const tool = await import(${JSON.stringify(scriptURL.href)});
    assert.equal(await tool.runCli(['synthetic']), 1);
    assert.equal(reads, 1); assert.equal(closed, 1);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', child], { env: {}, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Unable to read a regular input file within 2097152 bytes.\n');
});

test('default reader handles partial reads and stale small sizes without truncating input', () => {
  const encoded = JSON.stringify(JSON.stringify(scenario()));
  const child = `
    import assert from 'node:assert/strict';
    import fsp from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const data = Buffer.from(${encoded}); let closed=0;
    fsp.open = async () => ({ stat: async () => ({ isFile: () => true, size: 1 }),
      read: async (buffer, offset, length, position) => {
        const count=Math.min(3, data.length-position, length);
        data.copy(buffer, offset, position, position+count); return { bytesRead: count };
      }, close: async () => { closed++; } });
    syncBuiltinESMExports();
    const tool = await import(${JSON.stringify(scriptURL.href)});
    assert.equal(await tool.runCli(['synthetic']), 0); assert.equal(closed, 1);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', child], { env: {}, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify(suggestWeekend(scenario()), null, 2)}\n`);
});

test('import causes no tool I/O, output, clock access or CLI execution', () => {
  const child = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import fsp from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    fs.writeSync = () => { throw new Error('Import output denied'); };
    fsp.open = async () => { throw new Error('Import input denied'); };
    syncBuiltinESMExports();
    globalThis.Date = class extends Date { constructor() { throw new Error('Clock denied'); } static now() { throw new Error('Clock denied'); } };
    const tool = await import(${JSON.stringify(scriptURL.href)});
    assert.deepEqual(Object.keys(tool).sort(), ['parseWeekendScenario','runCli','suggestWeekend']);
    process.stdout.write('IMPORT_OK\\n');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', child], { env: {}, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'IMPORT_OK\n');
  assert.equal(result.stderr, '');
});
