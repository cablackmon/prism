import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {auditFiles, main} from '../../../scripts/burn4-icu-catalog-audit.mjs';
import {withFiles, catalogFile, cli, tool, expectCodes} from './burn4-test-helpers.mjs';

test('explicit file API loads Unicode paths and resolves paths from caller cwd', async () => {
  await withFiles(async directory => {
    const source = await catalogFile(directory, 'source.json', {message: 'Hello {name}'});
    const target = await catalogFile(directory, 'sprache ü.json', {message: 'Hallo {name}'});
    const result = await auditFiles(source, [target]);
    expectCodes(result, []);
    assert.equal(result.translatedMessages, 1);
    const child = cli(['--source', 'source.json', '--json', 'sprache ü.json'], directory);
    assert.equal(child.status, 0);
    assert.equal(JSON.parse(child.stdout).translatedMessages, 1);
    assert.equal(child.stderr, '');
  });
});

test('file API aggregates unreadable and invalid locale files without aborting remaining validation', async () => {
  await withFiles(async directory => {
    const source = await catalogFile(directory, 'en.json', {a: 'A'});
    const malformed = join(directory, 'broken.json');
    await writeFile(malformed, '{');
    const bad = await catalogFile(directory, 'bad.json', {a: '{bad'});
    const result = await auditFiles(source, [join(directory, 'absent.json'), malformed, bad]);
    expectCodes(result, ['unreadable_catalog', 'invalid_json', 'invalid_icu']);
    assert.equal(result.catalogs, 4);
    assert.equal(result.diagnostics.every(item => item.path === '' || item.path === '/a'), true);
  });
});

test('unreadable source still permits independent syntax checks of every locale', async () => {
  await withFiles(async directory => {
    const malformed = join(directory, 'bad.json');
    await writeFile(malformed, '{');
    const result = await auditFiles(join(directory, 'missing.json'), [malformed, join(directory, 'also-missing.json')]);
    expectCodes(result, ['unreadable_catalog', 'invalid_json', 'unreadable_catalog']);
  });
});

test('canonical file paths detect a duplicate translation even through dot segments', async () => {
  await withFiles(async directory => {
    const source = await catalogFile(directory, 'en.json', {a: 'A'});
    const target = await catalogFile(directory, 'de.json', {a: 'B'});
    const result = await auditFiles(source, [target, `${directory}/./de.json`]);
    expectCodes(result, ['duplicate_catalog']);
  });
});

for (const flag of ['--help', '-h']) {
  test(`CLI help ${flag} succeeds without loading files`, async () => {
    await withFiles(async directory => {
      const child = cli([flag], directory);
      assert.equal(child.status, 0);
      assert.match(child.stdout, /^Usage:/);
      assert.equal(child.stderr, '');
    });
  });
}

for (const args of [[], ['--source'], ['--source', '--json'], ['--source', 'en.json'], ['de.json'], ['--unknown'], ['--source', 'en.json', '--source', 'other.json', 'de.json']]) {
  test(`CLI usage error exits 2 for ${JSON.stringify(args)}`, async () => {
    await withFiles(async directory => {
      const child = cli(args, directory);
      assert.equal(child.status, 2);
      if (args.includes('--json')) {
        assert.equal(JSON.parse(child.stdout).error, 'invalid_arguments');
        assert.equal(child.stderr, '');
      } else {
        assert.equal(child.stdout, '');
        assert.match(child.stderr, /^Usage:/);
      }
    });
  });
}

test('CLI JSON usage error has a parseable diagnostic and no stderr', async () => {
  await withFiles(async directory => {
    const child = cli(['--json', '--unknown'], directory);
    assert.equal(child.status, 2);
    assert.equal(JSON.parse(child.stdout).error, 'invalid_arguments');
    assert.equal(child.stderr, '');
  });
});

test('CLI complete mode changes fallback exit status while default mode passes', async () => {
  await withFiles(async directory => {
    const source = await catalogFile(directory, 'en.json', {a: 'A', b: 'B'});
    const target = await catalogFile(directory, 'de.json', {a: 'B'});
    const partial = cli(['--source', source, target, '--json'], directory);
    assert.equal(partial.status, 0);
    assert.equal(JSON.parse(partial.stdout).fallbacks, 1);
    const complete = cli(['--source', source, target, '--json', '--require-complete'], directory);
    assert.equal(complete.status, 1);
    assert.equal(JSON.parse(complete.stdout).errors, 1);
  });
});

test('human output has file, pointer and duplicate location without input message text', async () => {
  await withFiles(async directory => {
    const source = await catalogFile(directory, 'en.json', {a: 'A'});
    const target = join(directory, 'de.json');
    await writeFile(target, '{\n"a":"MARKER_FIRST",\n"a":"MARKER_SECOND"}');
    const child = cli(['--source', source, target], directory);
    assert.equal(child.status, 1);
    assert.match(child.stdout, /^Catalog audit: FAIL; 1 errors;/);
    assert.match(child.stdout, /duplicate_key .*de\.json:3:1 \/a:/);
    assert.equal(child.stdout.includes('MARKER_'), false);
    await writeFile(target, '{"a":"MARKER_THIRD {person}"}');
    const argument = cli(['--source', source, target], directory);
    assert.equal(argument.status, 1);
    assert.match(argument.stdout, /extra_argument .* \/a \[person\]:/);
    assert.equal(argument.stdout.includes('MARKER_'), false);
  });
});

test('human success output exposes warning and fallback counts', async () => {
  await withFiles(async directory => {
    const source = await catalogFile(directory, 'en.json', {a: 'A', b: 'B'});
    const target = await catalogFile(directory, 'de.json', {a: 'B', extra: 'Extra'});
    const child = cli(['--source', source, target], directory);
    assert.equal(child.status, 0);
    assert.match(child.stdout, /^Catalog audit: PASS; 0 errors; 1 warnings; 1 fallbacks\./);
    assert.match(child.stdout, /warning orphan_translation/);
    assert.match(child.stdout, /info missing_translation/);
  });
});

test('option terminator permits a literal translation filename named --help', async () => {
  await withFiles(async directory => {
    const source = await catalogFile(directory, 'en.json', {a: 'A'});
    await catalogFile(directory, '--help', {a: 'B'});
    const child = cli(['--source', source, '--json', '--', '--help'], directory);
    assert.equal(child.status, 0);
    assert.equal(JSON.parse(child.stdout).translatedMessages, 1);
  });
});

test('importing tool from another entrypoint has no CLI output or file access', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(pathToFileURL(tool).href)})`], {
    env: {}, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
});

test('main supports caller-provided output sinks for programmatic help and usage errors', async () => {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const io = {out: (/** @type {string} */ text) => {out.push(text);}, err: (/** @type {string} */ text) => {err.push(text);}};
  assert.equal(await main(['--help'], io), 0);
  assert.match(out.join(''), /^Usage:/);
  assert.equal(await main([], io), 2);
  assert.match(err.join(''), /^Usage:/);
});

test('unexpected CLI output failure returns generic exit 2 without leaking exception text', async () => {
  await withFiles(async directory => {
    const preload = join(directory, 'burn4-output-failure.mjs');
    await writeFile(preload, 'process.stdout.write = () => {throw new Error("SYNTHETIC_INTERNAL_DETAIL");};');
    const child = cli(['--help'], directory, ['--import', pathToFileURL(preload).href]);
    assert.equal(child.status, 2);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr, 'Catalog audit failed unexpectedly.\n');
  });
});
