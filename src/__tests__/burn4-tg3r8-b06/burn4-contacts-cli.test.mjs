import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_INPUT_BYTES, runContactsImportCli } from '../../../scripts/burn4-contacts-import.mjs';

/** @param {string} content @param {boolean} [readFailure] */
function fakeIO(content, readFailure = false) {
  /** @type {{path: string, maxBytes: number}[]} */
  const reads = [];
  /** @type {string[]} */
  const output = [];
  /** @type {string[]} */
  const errors = [];
  return {
    reads, output, errors,
    io: {
      /** @param {string} path @param {number} maxBytes */
      readText: async (path, maxBytes) => {
        reads.push({ path, maxBytes });
        if (readFailure) throw new Error('synthetic read failure');
        return content;
      },
      /** @param {string} value */
      writeOutput: (value) => { output.push(value); },
      /** @param {string} value */
      writeError: (value) => { errors.push(value); },
    },
  };
}

test('CLI reads exactly its explicit path and emits one JSON result', async () => {
  const io = fakeIO(JSON.stringify({ schemaVersion: 1, sourceId: 'fixture', complete: true, records: [] }));
  assert.equal(await runContactsImportCli(['synthetic-input.json'], io.io), 0);
  assert.deepEqual(io.reads, [{ path: 'synthetic-input.json', maxBytes: MAX_INPUT_BYTES }]);
  assert.equal(io.output.length, 1);
  assert.deepEqual(io.errors, []);
  assert.equal(JSON.parse(io.output[0] ?? '').snapshot.sourceId, 'fixture');
});

for (const args of [[], ['one.json', 'two.json'], ['-'], ['https://never-read.invalid/contacts.json']]) {
  test(`CLI rejects usage ${JSON.stringify(args)} without reading`, async () => {
    const io = fakeIO('{}');
    assert.equal(await runContactsImportCli(args, io.io), 1);
    assert.deepEqual(io.reads, []);
    assert.deepEqual(io.output, []);
    assert.deepEqual(io.errors, ['{"error":"usage_expected_one_json_file"}\n']);
  });
}

/** @type {[string, string, string][]} */
const invalidInputs = [['JSON', '{', 'invalid_json'], ['envelope', '{}', 'invalid_envelope'], ['size', ' '.repeat(MAX_INPUT_BYTES + 1), 'input_too_large']];
for (const [name, content, code] of invalidInputs) {
  test(`CLI reports invalid ${name} without partial output`, async () => {
    const io = fakeIO(content);
    assert.equal(await runContactsImportCli(['fixture.json'], io.io), 1);
    assert.deepEqual(io.output, []);
    assert.equal(JSON.parse(io.errors[0] ?? '').error, code);
  });
}

test('CLI read errors do not echo arbitrary error or input content', async () => {
  const io = fakeIO('{}', true);
  assert.equal(await runContactsImportCli(['fixture.json'], io.io), 1);
  assert.deepEqual(io.errors, ['{"error":"input_read_failed"}\n']);
  assert.deepEqual(io.output, []);
});

test('CLI emits incomplete structured report for malformed record batches', async () => {
  const io = fakeIO(JSON.stringify({ schemaVersion: 1, sourceId: 'fixture', complete: true, records: [null] }));
  assert.equal(await runContactsImportCli(['fixture.json'], io.io), 0);
  const result = JSON.parse(io.output[0] ?? '');
  assert.equal(result.snapshot.complete, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.diff.missingSuppressed, true);
});
