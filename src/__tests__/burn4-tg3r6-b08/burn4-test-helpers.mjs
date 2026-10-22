import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {auditCatalogs} from '../../../scripts/burn4-icu-catalog-audit.mjs';

export const tool = fileURLToPath(new URL('../../../scripts/burn4-icu-catalog-audit.mjs', import.meta.url));

/** @param {unknown} source @param {unknown} target @param {import('../../../scripts/burn4-icu-catalog-audit.mjs').AuditOptions} [options] */
export function pair(source, target, options) {
  return auditCatalogs(
    {file: 'en.json', text: JSON.stringify(source)},
    [{file: 'de.json', text: JSON.stringify(target)}], options,
  );
}

/** @param {import('../../../scripts/burn4-icu-catalog-audit.mjs').AuditReport} result */
export function codes(result) {
  return result.diagnostics.map(item => item.code);
}

/** @param {import('../../../scripts/burn4-icu-catalog-audit.mjs').AuditReport} result @param {string[]} expected */
export function expectCodes(result, expected) {
  assert.deepEqual(codes(result).sort(), [...expected].sort());
  assert.equal(result.ok, result.errors === 0);
  assert.equal(result.errors, result.diagnostics.filter(item => item.severity === 'error').length);
}

/** @param {(directory: string) => Promise<void>} action */
export async function withFiles(action) {
  const directory = await mkdtemp('/tmp/burn4-b08-');
  try { await action(directory); } finally { await rm(directory, {recursive: true, force: true}); }
}

/** @param {string} directory @param {string} name @param {unknown} data */
export async function catalogFile(directory, name, data) {
  const file = join(directory, name);
  await writeFile(file, JSON.stringify(data), 'utf8');
  return file;
}

/** @param {string[]} args @param {string} cwd @param {string[]} [nodeArgs] */
export function cli(args, cwd, nodeArgs = []) {
  const child = spawnSync(process.execPath, [...nodeArgs, tool, ...args], {
    cwd, env: {}, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  return child;
}
