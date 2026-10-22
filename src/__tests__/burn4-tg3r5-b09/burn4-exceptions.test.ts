import { Fixture, type Finding } from './burn4-harness';
let fixture: Fixture;
beforeEach(() => { fixture = new Fixture(); });
afterEach(() => { fixture.dispose(); });
const file = 'src/app/api/items/[id]/route.ts';
const finding: Finding = { file, method: 'POST', line: 3, column: 4, path: ['POST', 'helper'] };
function apply(exceptions: unknown, findings = [finding]): Finding[] {
  return fixture.api({ operation: 'exceptions', findings, exceptions });
}
test('exact method exceptions retain every finding and the trimmed reason', () => {
  const findings = [finding, { ...finding, line: 5 }, { ...finding, method: 'PATCH' }];
  expect(apply([{ file, method: 'POST', reason: '  documented kiosk input  ' }], findings)).toEqual([
    { ...finding, excepted: 'documented kiosk input' },
    { ...finding, line: 5, excepted: 'documented kiosk input' },
    { ...finding, method: 'PATCH' },
  ]);
});
test('an empty manifest preserves findings', () => { expect(apply([])).toEqual([finding]); });
test.each([
  ['not an array', {}],
  ['null item', [null]],
  ['array item', [[]]],
  ['unknown field', [{ file, method: 'POST', reason: 'ok', extra: true }]],
  ['missing reason', [{ file, method: 'POST' }]],
  ['blank reason', [{ file, method: 'POST', reason: ' \t ' }]],
  ['wrong reason type', [{ file, method: 'POST', reason: 4 }]],
  ['read method', [{ file, method: 'GET', reason: 'ok' }]],
  ['lowercase method', [{ file, method: 'post', reason: 'ok' }]],
  ['outside root', [{ file: '../route.ts', method: 'POST', reason: 'ok' }]],
  ['absolute file', [{ file: '/tmp/route.ts', method: 'POST', reason: 'ok' }]],
  ['glob file', [{ file: 'src/*/route.ts', method: 'POST', reason: 'ok' }]],
  ['question glob', [{ file: 'src/?/route.ts', method: 'POST', reason: 'ok' }]],
  ['backslashes', [{ file: 'src\\route.ts', method: 'POST', reason: 'ok' }]],
  ['dot segment', [{ file: 'src/./route.ts', method: 'POST', reason: 'ok' }]],
  ['duplicate separator', [{ file: 'src//route.ts', method: 'POST', reason: 'ok' }]],
  ['duplicate exact identity', [{ file, method: 'POST', reason: 'a' }, { file, method: 'POST', reason: 'b' }]],
  ['stale method', [{ file, method: 'PUT', reason: 'ok' }]],
  ['stale file', [{ file: 'other.ts', method: 'POST', reason: 'ok' }]],
])('%s is rejected', (_name, exceptions) => { expect(() => apply(exceptions)).toThrow(); });
test('a comment-only or read-only route cannot justify an exception', () => {
  expect(() => apply([{ file, method: 'POST', reason: 'ok' }], [])).toThrow('Stale exception');
});
