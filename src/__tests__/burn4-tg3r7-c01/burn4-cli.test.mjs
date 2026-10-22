import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { openSync, closeSync } from 'node:fs';
import { runCli } from '../../../scripts/burn4-chore-anchor-preview.mjs';
import { snapshot } from './burn4-fixtures.mjs';
const execute = promisify(execFile);
const script = fileURLToPath(new URL('../../../scripts/burn4-chore-anchor-preview.mjs', import.meta.url));
/** @param {string[]} args @param {string} cwd */
async function invoke(args, cwd) {
  try { const result = await execute(process.execPath, [script, ...args], { cwd, env: {}, timeout: 5000, maxBuffer: 5 * 1048576 }); return { ...result, code: 0 }; }
  catch (error) {
    const failure = /** @type {Error & {stdout:string,stderr:string,code:number}} */ (error);
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}
/** @param {(directory:string)=>Promise<void>} body */
async function temporary(body) { const directory = await mkdtemp('/tmp/burn4-c01-'); try { await body(directory); } finally { await rm(directory, { recursive: true, force: true }); } }

test('real CLI outputs only deterministic JSON/ICS and never writes output files', async () => temporary(async directory => {
  const path = join(directory, 'input.json'), source = JSON.stringify(snapshot()); await writeFile(path, source);
  const before = await readdir(directory);
  const json = await invoke(['--input', path], directory); assert.equal(json.code, 0); assert.equal(json.stderr, ''); assert.equal(JSON.parse(json.stdout).totals.future, 3);
  const repeated = await invoke(['--input', path], directory); assert.equal(repeated.stdout, json.stdout);
  const ics = await invoke(['--format', 'ics', '--input', path], directory); assert.equal(ics.code, 0); assert.ok(ics.stdout.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.deepEqual(await readdir(directory), before); assert.equal(await readFile(path, 'utf8'), source);
}));
test('import is inert and reads no input, environment, service or output', async () => temporary(async directory => {
  const result = await execute(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../../../scripts/burn4-chore-anchor-preview.mjs', import.meta.url).href)});`], { cwd: directory, env: {}, timeout: 5000 });
  assert.equal(result.stdout, ''); assert.equal(result.stderr, ''); assert.deepEqual(await readdir(directory), []);
}));
test('help is useful, successful and does not read input', async () => {
  let reads = 0, stdout = '', stderr = '';
  const code = await runCli(['--help'], { readInput: async () => { reads++; throw new Error('must not read'); }, stdout: value => { stdout += value; }, stderr: value => { stderr += value; } });
  assert.equal(code, 0); assert.equal(reads, 0); assert.equal(stderr, ''); assert.match(stdout, /noInterveningCompletion:true/); assert.match(stdout, /--format json\|ics/);
});
const argumentCases = [[], ['--unknown', 'x'], ['--help', '--input', 'x'], ['--input'], ['--input', '--format'], ['--format', 'xml', '--input', 'x'], ['--input', 'x', '--input', 'y'], ['--input', 'x', '--format', 'ics', '--format', 'json'], ['x']];
for (const argv of argumentCases) test(`arguments fail before input access: ${JSON.stringify(argv)}`, async () => {
  let reads = 0, stdout = '', stderr = '';
  const result = await runCli(argv, { readInput: async () => { reads++; return '{}'; }, stdout: value => { stdout += value; }, stderr: value => { stderr += value; } });
  assert.equal(result, 2); assert.equal(reads, 0); assert.equal(stdout, ''); assert.match(stderr, /^Chore preview: /);
});
test('read/JSON/schema failures have bounded value-free diagnostics and no stdout', async () => {
  for (const source of [null, '{DO_NOT_ECHO', JSON.stringify(snapshot({ asOf: 'DO_NOT_ECHO' })), ' '.repeat(1048577)]) {
    let stdout = '', stderr = '';
    const code = await runCli(['--input', 'DO_NOT_ECHO'], { readInput: async () => { if (source === null) throw new Error('DO_NOT_ECHO'); return source; }, stdout: value => { stdout += value; }, stderr: value => { stderr += value; } });
    assert.equal(code, 2); assert.equal(stdout, ''); assert.ok(stderr.length < 160); assert.equal(stderr.includes('DO_NOT_ECHO'), false);
  }
});
test('actual CLI rejects missing, directory, special, malformed, oversized and invalid UTF-8 files', async () => temporary(async directory => {
  const malformed = join(directory, 'malformed.json'); await writeFile(malformed, '{DO_NOT_ECHO');
  const oversized = join(directory, 'oversized.json'); await writeFile(oversized, Buffer.alloc(1048577, 32));
  const invalid = join(directory, 'utf8.json'); await writeFile(invalid, Buffer.from([0xff]));
  for (const path of [join(directory, 'missing.json'), directory, '/dev/null', malformed, oversized, invalid]) {
    const result = await invoke(['--input', path], directory);
    assert.equal(result.code, 2); assert.equal(result.stdout, ''); assert.match(result.stderr, /^Chore preview: /); assert.equal(result.stderr.includes('DO_NOT_ECHO'), false);
  }
}));
test('input byte boundary accepts exactly one MiB of valid JSON plus whitespace', async () => temporary(async directory => {
  const source = JSON.stringify(snapshot({ chores: [] })), path = join(directory, 'exact.json');
  await writeFile(path, source + ' '.repeat(1048576 - Buffer.byteLength(source)));
  const result = await invoke(['--input', path], directory); assert.equal(result.code, 0); assert.deepEqual(JSON.parse(result.stdout).chores, []);
}));
test('injected output failures remain controlled even when the error sink also fails', async () => {
  const io = { readInput: async () => JSON.stringify(snapshot()), stdout() { throw new Error('DO_NOT_ECHO'); }, stderr() { throw new Error('DO_NOT_ECHO'); } };
  assert.equal(await runCli(['--input', 'x'], io), 2);
  assert.equal(await runCli([], io), 2);
});

test('bounded file reader rejects growth after stat and always closes its input handle', async () => temporary(async directory => {
  const program = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import assert from 'node:assert/strict';
    let closed = false, reads = 0;
    fs.open = async () => ({
      stat: async () => ({isFile:()=>true,size:0}),
      read: async (buffer, offset, length) => { reads++; buffer.fill(32,offset,offset+length); return {bytesRead:length}; },
      close: async () => { closed=true; }
    });
    syncBuiltinESMExports();
    const {runCli} = await import(${JSON.stringify(new URL('../../../scripts/burn4-chore-anchor-preview.mjs', import.meta.url).href)});
    const code = await runCli(['--input','synthetic-growing-file']);
    assert.equal(closed,true); assert.equal(reads,1); assert.equal(code,2);
    process.exitCode=code;
  `;
  try {
    await execute(process.execPath, ['--input-type=module', '-e', program], { cwd: directory, env: {}, timeout: 5000 });
    assert.fail('The growing file must be rejected');
  } catch (error) {
    const result = /** @type {Error & {code:number,stdout:string,stderr:string}} */ (error);
    assert.equal(result.code, 2); assert.equal(result.stdout, ''); assert.equal(result.stderr, 'Chore preview: Input exceeds 1 MiB.\n');
  }
}));


test('real CLI controls stdout and stderr write failures without stack or data leakage', async () => temporary(async directory => {
  const input = join(directory, 'snapshot.json'), sink = join(directory, 'readonly-sink');
  await writeFile(input, JSON.stringify(snapshot())); await writeFile(sink, '');
  const descriptor = openSync(sink, 'r');
  try {
    const outputFailure = spawnSync(process.execPath, [script, '--input', input], { cwd: directory, env: {}, timeout: 5000, encoding: 'utf8', stdio: ['ignore', descriptor, 'pipe'] });
    assert.equal(outputFailure.error, undefined); assert.equal(outputFailure.status, 2);
    assert.equal(outputFailure.stderr, 'Chore preview: Unable to read or validate the local snapshot.\n');
    const errorFailure = spawnSync(process.execPath, [script], { cwd: directory, env: {}, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', descriptor] });
    assert.equal(errorFailure.error, undefined); assert.equal(errorFailure.status, 2); assert.equal(errorFailure.stdout, '');
  } finally { closeSync(descriptor); }
}));
test('real CLI rejects empty ICS with no stdout while JSON still describes the empty projection', async () => temporary(async directory => {
  const path = join(directory, 'empty.json'); await writeFile(path, JSON.stringify(snapshot({ chores: [] })));
  const json = await invoke(['--input', path], directory); assert.equal(json.code, 0); assert.deepEqual(JSON.parse(json.stdout).totals, { missed: 0, current: 0, future: 0 });
  const ics = await invoke(['--input', path, '--format', 'ics'], directory); assert.equal(ics.code, 2); assert.equal(ics.stdout, ''); assert.equal(ics.stderr, 'Chore preview: No current or future occurrences to export; use JSON preview.\n');
}));
