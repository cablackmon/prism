import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { auth, Fixture, sourceFile, type Report } from './burn4-harness';
let fixture: Fixture;
beforeEach(() => { fixture = new Fixture(); });
afterEach(() => { fixture.dispose(); });
const mutation = auth + 'export const POST=()=>read()';
const clean = 'export const POST=()=>({ok:true})';
function files(selected: string[] = [], root = fixture.root): Report {
  return fixture.api({ operation: 'files', root, files: selected });
}
test('default discovery sorts only route files below the synthetic API tree', () => {
  fixture.write('src/app/api/z/route.ts', mutation);
  fixture.write('src/app/api/a/route.js', clean);
  fixture.write('src/app/api/a/helper.ts', 'throw new Error("must not execute")');
  fixture.write('node_modules/route.ts', mutation);
  fixture.write('.git/route.ts', mutation);
  fixture.write('src/app/api/node_modules/nested/route.ts', mutation);
  fixture.write('src/app/api/.git/nested/route.ts', mutation);
  const report = files();
  expect(report.files).toEqual(['src/app/api/a/route.js', 'src/app/api/z/route.ts']);
  expect(report.findings).toHaveLength(1);
  expect(report.diagnostics).toEqual([]);
});
test('explicit selection sorts and deduplicates without discovering other routes', () => {
  fixture.write('one.ts', clean);fixture.write('two.ts', mutation);fixture.write(sourceFile, mutation);
  const report = files(['two.ts', 'one.ts', 'two.ts']);
  expect(report.files).toEqual(['one.ts', 'two.ts']);
  expect(report.findings.map((f) => f.file)).toEqual(['two.ts']);
});
test.each(['[id]', '[...slug]', '[[...slug]]'])('literal %s route segments support discovery, selection and exceptions', (segment) => {
  const file = `src/app/api/items/${segment}/route.ts`;
  fixture.write(file, mutation);
  expect(files().files).toEqual([file]);expect(files([file]).files).toEqual([file]);
  fixture.write('exceptions.json', JSON.stringify([{ file, method: 'POST', reason: 'documented kiosk scan' }]));
  const result = fixture.cli(['--check', '--exceptions', 'exceptions.json', file]);
  expect(result.exitCode).toBe(0);expect(result.report.findings[0]!.excepted).toBe('documented kiosk scan');
});
test.each([
  ['outside selection', ['../outside.ts']],
  ['absolute selection', ['/tmp/outside.ts']],
  ['missing selection', ['missing.ts']],
  ['unsupported extension', ['source.json']],
  ['directory selection', ['directory.ts']],
])('%s returns an input diagnostic', (_name, selected) => {
  mkdirSync(join(fixture.root, 'directory.ts'));
  const result = fixture.cli(selected);
  expect(result.exitCode).toBe(2);expect(result.report.diagnostics[0]!.code).toBe('input');
});
test('empty discovery is an input error with explicit analyzed count zero', () => {
  mkdirSync(join(fixture.root, 'src/app/api'), { recursive: true });
  const result = fixture.cli([]);
  expect(result.exitCode).toBe(2);expect(result.report.files).toEqual([]);
  expect(result.report.diagnostics[0]!.message).toBe('No route source files selected');
});
test('missing default tree fails without scanning another location', () => { expect(fixture.cli([]).exitCode).toBe(2); });
test('oversize source is rejected before parsing', () => {
  fixture.write('large.ts', ' '.repeat(512 * 1024 + 1));
  expect(() => files(['large.ts'])).toThrow('512 KiB');
});
test.each(['file', 'directory', 'root'])('%s symlinks are refused even when their targets stay inside root', (kind) => {
  fixture.write(sourceFile, mutation);
  if (kind === 'file') {
    symlinkSync(join(fixture.root, sourceFile), join(fixture.root, 'alias.ts'));
    expect(() => files(['alias.ts'])).toThrow('Symlink');
  } else if (kind === 'directory') {
    symlinkSync(join(fixture.root, 'src/app/api/synthetic'), join(fixture.root, 'src/app/api/alias'));
    expect(() => files()).toThrow('Symlink');
  } else {
    symlinkSync(join(fixture.root, 'src'), join(fixture.root, 'alias'));
    expect(() => files([], join(fixture.root, 'alias'))).toThrow('Symlink');
  }
});
test('a symlink outside root cannot be an explicit source or exception manifest', () => {
  const other = new Fixture();
  try {
    other.write('source.ts', mutation);other.write('exceptions.json', '[]');
    symlinkSync(join(other.root, 'source.ts'), join(fixture.root, 'outside.ts'));
    symlinkSync(join(other.root, 'exceptions.json'), join(fixture.root, 'exceptions.json'));
    expect(fixture.cli(['outside.ts']).exitCode).toBe(2);
    expect(fixture.cli(['--exceptions', 'exceptions.json', 'outside.ts']).report.diagnostics[0]!.message).toContain('Symlink');
  } finally { other.dispose(); }
});
test.each([
  ['clean advisory', clean, [], 0],
  ['clean check', clean, ['--check'], 0],
  ['finding advisory', mutation, [], 0],
  ['finding check', mutation, ['--check'], 1],
  ['invalid advisory', 'export function POST(', [], 2],
  ['invalid check', 'export function POST(', ['--check'], 2],
  ['incomplete advisory', auth + 'export const POST=()=>unknown(read)', [], 2],
  ['incomplete check', auth + 'export const POST=()=>unknown(read)', ['--check'], 2],
])('%s has the specified exit status', (_name, source, args, expected) => {
  fixture.write(sourceFile, source as string);
  const result = fixture.cli(args as string[]);
  expect(result.exitCode).toBe(expected);
  expect(result.report.files).toEqual([sourceFile]);
});
test('an exact exception cannot suppress incompleteness or a different mutation method', () => {
  fixture.write(sourceFile, auth + 'export const POST=()=>{read();unknown(read)};export const PATCH=()=>read()');
  fixture.write('exceptions.json', JSON.stringify([{ file: sourceFile, method: 'POST', reason: 'documented kiosk' }]));
  const result = fixture.cli(['--check', '--exceptions', 'exceptions.json']);
  expect(result.exitCode).toBe(2);
  expect(result.report.findings.map((f) => [f.method, f.excepted])).toEqual([['PATCH', undefined], ['POST', 'documented kiosk']]);
  expect(result.report.diagnostics.length).toBeGreaterThan(0);
});
test('exceptions outside explicit selection are stale', () => {
  fixture.write(sourceFile, mutation);fixture.write('selected.ts', clean);
  fixture.write('exceptions.json', JSON.stringify([{ file: sourceFile, method: 'POST', reason: 'documented kiosk' }]));
  expect(fixture.cli(['--exceptions', 'exceptions.json', 'selected.ts']).report.diagnostics[0]!.message).toContain('Stale exception');
});
test('malformed manifest errors never echo source snippets', () => {
  fixture.write(sourceFile, clean);fixture.write('exceptions.json', '{invalid synthetic sentinel');
  const result = fixture.cli(['--exceptions', 'exceptions.json']);
  expect(result.exitCode).toBe(2);expect(result.report.diagnostics[0]!.message).toBe('Malformed exception JSON');
  expect(result.output).not.toContain('sentinel');
});
test.each([
  ['unknown option', ['--unknown']],
  ['duplicate flag', ['--check', '--check']],
  ['missing option value', ['--exceptions']],
  ['missing manifest', ['--exceptions', 'absent.json']],
  ['outside manifest', ['--exceptions', '../outside.json']],
])('%s is rejected', (_name, args) => {
  fixture.write(sourceFile, clean);expect(fixture.cli(args).exitCode).toBe(2);
});
test('missing root and help are pure explicit API paths under synthetic cwd', () => {
  const absent = fixture.api<{ exitCode: number; output: string }>({ operation: 'cli', args: [] });
  expect(absent.exitCode).toBe(2);expect(absent.output).toContain('--root is required');
  const help = fixture.api<{ exitCode: number; output: string }>({ operation: 'cli', args: ['--help'] });
  expect(help.exitCode).toBe(0);expect(help.output).toContain('Usage:');
});
test('real entrypoint has deterministic text/JSON and does not execute source', () => {
  fixture.write(sourceFile, auth + 'throw new Error("must not execute");export const PUT=()=>read()');
  const first = fixture.execute(['--check']);const second = fixture.execute(['--check']);
  expect(first).toEqual(second);expect(first.status).toBe(1);expect(first.stderr).toBe('');
  expect(first.stdout).toContain(`${sourceFile}:2:`);expect(first.stdout).toContain('PUT getDisplayAuth via PUT');
  const json = fixture.execute(['--json', '--check']);
  expect(json.status).toBe(1);expect(JSON.parse(json.stdout).findings).toHaveLength(1);
  expect(json.stderr).toBe('');
});

test('the public file API rejects an empty root instead of discovering cwd', () => { expect(() => files([], '')).toThrow('Explicit root'); });

test.each([['clean', clean, 0], ['syntax error', 'export function POST(', 2]])('real entrypoint preserves the %s exit status', (_name, source, status) => {
  fixture.write(sourceFile, source as string);
  const result = fixture.execute(['--json', '--check']);
  expect(result.status).toBe(status);expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout).files).toEqual([sourceFile]);
});
