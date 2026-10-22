import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { runCli, TRIP_ROUTE_LIMITS } from '../../../scripts/burn4-trip-route-geometry.mjs';
import { fakeIO, snapshot } from './burn4-test-helpers.mjs';

const script = fileURLToPath(new URL('../../../scripts/burn4-trip-route-geometry.mjs', import.meta.url));

test('CLI produces newline-terminated deterministic GeoJSON and reads only its explicit path', async () => {
  const fake = fakeIO();
  assert.equal(await runCli(['./synthetic-trips.json'], fake.io), 0);
  assert.deepEqual(fake.reads, ['./synthetic-trips.json']);
  assert.deepEqual(fake.err, []);
  assert.equal(fake.out.length, 1);
  assert.ok(fake.out[0]?.endsWith('\n'));
  const parsed = JSON.parse(fake.out[0] ?? '');
  assert.equal(parsed.type, 'FeatureCollection');
  assert.equal(parsed.features.length, 1);
  const second = fakeIO();
  await runCli(['./synthetic-trips.json'], second.io);
  assert.deepEqual(second.out, fake.out);
});

for (const flag of ['--help', '-h']) {
  test(`CLI ${flag} prints help without reading a file`, async () => {
    const fake = fakeIO();
    assert.equal(await runCli([flag], fake.io), 0);
    assert.match(fake.out.join(''), /Usage:.*<local-trip-snapshot.json>/);
    assert.deepEqual(fake.reads, []);
    assert.deepEqual(fake.err, []);
  });
}

for (const args of [[], ['a.json', 'b.json'], ['--unknown'], ['-'], [''], ['https://invalid.example/trips'], ['file:///tmp/trips'], ['bad\0path'], ['x'.repeat(4097)]]) {
  test(`CLI rejects argument shape ${JSON.stringify(args.map((value) => value.length > 30 ? '[overlong]' : value))}`, async () => {
    const fake = fakeIO();
    assert.equal(await runCli(args, fake.io), 2);
    assert.deepEqual(fake.reads, []);
    assert.deepEqual(fake.out, []);
    assert.match(fake.err.join(''), /^Usage:/);
  });
}

test('relative local path may contain a colon after a directory separator', async () => {
  const fake = fakeIO();
  assert.equal(await runCli(['./fixture:trips.json'], fake.io), 0);
  assert.deepEqual(fake.reads, ['./fixture:trips.json']);
});

test('read rejection reports its stage without echoing raw reader error data', async () => {
  const fake = fakeIO(undefined, { readChunks: async function* () { throw new Error('PRIVATE FIXTURE DETAIL'); } });
  assert.equal(await runCli(['fixture.json'], fake.io), 2);
  assert.deepEqual(fake.out, []);
  assert.deepEqual(fake.err, ['Trip route read failed.\n']);
});

test('malformed JSON error does not echo source contents', async () => {
  const fake = fakeIO(undefined, { readChunks: async function* () { yield Buffer.from('{private broken content'); } });
  assert.equal(await runCli(['fixture.json'], fake.io), 2);
  assert.deepEqual(fake.out, []);
  assert.deepEqual(fake.err, ['Trip route JSON failed.\n']);
});

test('validation error preserves useful field path without echoing rejected value', async () => {
  const fake = fakeIO({ trips: [{ id: 't', style: 'PRIVATE REJECTED STYLE', stops: [] }] });
  assert.equal(await runCli(['fixture.json'], fake.io), 2);
  assert.deepEqual(fake.out, []);
  assert.deepEqual(fake.err, ['Trip route validation failed: trips[0].style: expected route, loop or hub.\n']);
});

test('output rejection returns failure and reports output stage', async () => {
  const fake = fakeIO(undefined, { stdout: async () => { throw new Error('not echoed'); } });
  assert.equal(await runCli(['fixture.json'], fake.io), 2);
  assert.deepEqual(fake.err, ['Trip route output failed.\n']);
});

test('broken stderr does not turn a CLI failure into an unhandled rejection', async () => {
  const fake = fakeIO(undefined, { stderr: async () => { throw new Error('broken'); } });
  assert.equal(await runCli([], fake.io), 2);
});

test('help output failure also returns 2 without any read', async () => {
  const fake = fakeIO(undefined, { stdout: () => { throw new Error('broken'); } });
  assert.equal(await runCli(['--help'], fake.io), 2);
  assert.deepEqual(fake.reads, []);
});

test('reader enforces bytes rather than character count and closes oversized iterators', async () => {
  let closed = false;
  let yielded = 0;
  const fake = fakeIO(undefined, { readChunks: async function* () {
    try {
      yielded += 1;
      yield Buffer.alloc(TRIP_ROUTE_LIMITS.inputBytes + 1, 0x20);
      yielded += 1;
      yield Buffer.from('{}');
    } finally { closed = true; }
  } });
  assert.equal(await runCli(['fixture.json'], fake.io), 2);
  assert.equal(yielded, 1);
  assert.equal(closed, true);
  assert.deepEqual(fake.err, ['Trip route read failed: input: file exceeds input byte budget.\n']);
});

test('exact input byte boundary parses successfully', async () => {
  const body = Buffer.from('{"trips":[]}');
  const fake = fakeIO(undefined, { readChunks: async function* () {
    yield body;
    yield Buffer.alloc(TRIP_ROUTE_LIMITS.inputBytes - body.byteLength, 0x20);
  } });
  assert.equal(await runCli(['fixture.json'], fake.io), 0);
  assert.equal(JSON.parse(fake.out[0] ?? '').features.length, 0);
});

test('byte accounting rejects multibyte text that stays under a character budget', async () => {
  const body = `{"trips":[],"unused":"${'界'.repeat(Math.floor(TRIP_ROUTE_LIMITS.inputBytes / 2))}"}`;
  assert.ok(body.length < TRIP_ROUTE_LIMITS.inputBytes);
  const fake = fakeIO(undefined, { readChunks: async function* () { yield Buffer.from(body); } });
  assert.equal(await runCli(['fixture.json'], fake.io), 2);
  assert.deepEqual(fake.err, ['Trip route read failed: input: file exceeds input byte budget.\n']);
});

test('UTF-8 chunk boundary preserves Unicode text across a partial code point', async () => {
  const body = Buffer.from('{"trips":[{"id":"t","name":"日本","style":"route","stops":[]}]}');
  const location = body.indexOf(Buffer.from('日')) + 1;
  const fake = fakeIO(undefined, { readChunks: async function* () { yield body.subarray(0, location); yield body.subarray(location); } });
  assert.equal(await runCli(['fixture.json'], fake.io), 0);
});

test('invalid and incomplete UTF-8 input is rejected instead of replaced', async () => {
  for (const bytes of [[0xff], [0xe2, 0x82]]) {
    const fake = fakeIO(undefined, { readChunks: async function* () { yield Buffer.from(bytes); } });
    assert.equal(await runCli(['fixture.json'], fake.io), 2);
    assert.deepEqual(fake.err, ['Trip route read failed.\n']);
  }
});

test('empty chunks count toward fragmentation limit and close the reader', async () => {
  let closed = false;
  let chunks = 0;
  const fake = fakeIO(undefined, { readChunks: async function* () {
    try {
      for (let index = 0; index <= TRIP_ROUTE_LIMITS.chunks; index += 1) { chunks += 1; yield new Uint8Array(); }
    } finally { closed = true; }
  } });
  assert.equal(await runCli(['fixture.json'], fake.io), 2);
  assert.equal(chunks, TRIP_ROUTE_LIMITS.chunks + 1);
  assert.equal(closed, true);
  assert.deepEqual(fake.err, ['Trip route read failed: input: file exceeds input chunk budget.\n']);
});

test('fragment count boundary includes the final JSON chunk', async () => {
  const fake = fakeIO(undefined, { readChunks: async function* () {
    for (let index = 1; index < TRIP_ROUTE_LIMITS.chunks; index += 1) yield new Uint8Array();
    yield Buffer.from('{"trips":[]}');
  } });
  assert.equal(await runCli(['fixture.json'], fake.io), 0);
});

test('reader rejects non-byte adapter data at its boundary', async () => {
  const fake = fakeIO(undefined, { readChunks: /** @type {import('../../../scripts/burn4-trip-route-geometry.mjs').CliIO['readChunks']} */ (/** @type {unknown} */ (async function* () { yield 'not bytes'; })) });
  assert.equal(await runCli(['fixture.json'], fake.io), 2);
  assert.deepEqual(fake.err, ['Trip route read failed: input: reader must supply byte chunks.\n']);
});

test('real process entry, local file adapter, read-only output and import silence', async () => {
  const directory = await mkdtemp('/tmp/burn4-tg3r9-b03-');
  try {
    const file = join(directory, 'trips.json');
    const bytes = JSON.stringify(snapshot());
    await writeFile(file, bytes);
    const actual = spawnSync(process.execPath, [script, file], { env: {}, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    assert.equal(actual.status, 0, actual.stderr);
    assert.equal(actual.stderr, '');
    assert.equal(JSON.parse(actual.stdout).features.length, 1);
    assert.equal(await readFile(file, 'utf8'), bytes);
    const help = spawnSync(process.execPath, [script, '--help'], { env: {}, encoding: 'utf8', timeout: 10000 });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^Usage:/);
    const missing = spawnSync(process.execPath, [script, join(directory, 'absent.json')], { env: {}, encoding: 'utf8', timeout: 10000 });
    assert.equal(missing.status, 2);
    assert.equal(missing.stdout, '');
    assert.equal(missing.stderr, 'Trip route read failed.\n');
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../../../scripts/burn4-trip-route-geometry.mjs', import.meta.url).href)})`], { env: {}, cwd: resolve(directory), encoding: 'utf8', timeout: 10000 });
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, '');
    assert.equal(imported.stderr, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('real closed stdout pipe returns CLI failure instead of an unhandled stream error', async () => {
  const directory = await mkdtemp('/tmp/burn4-tg3r9-b03-pipe-');
  try {
    const file = join(directory, 'trips.json');
    await writeFile(file, JSON.stringify(snapshot()));
    const child = spawn(process.execPath, [script, file], { env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.destroy();
    let diagnostic = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { diagnostic += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(code, 2);
    assert.equal(diagnostic, 'Trip route output failed.\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
