import type { ESLint } from 'eslint';
import { eslintEngine, repositoryRoot } from './burn4-tooling-harness';

describe('actual repository ESLint behavior on synthetic source', () => {
  let engine: ESLint;

  beforeAll(() => {
    engine = eslintEngine();
  });

  async function messages(source: string) {
    const [result] = await engine.lintText(source, {
      filePath: `${repositoryRoot}/src/__tests__/burn4-tg3r4-a06/burn4-synthetic.tsx`,
    });
    if (!result) throw new Error('Expected one synthetic lint result');
    expect(result.fatalErrorCount).toBe(0);
    return result.messages;
  }

  it.each([
    ['image alternative text', 'jsx-a11y/alt-text', 'export const View = () => <img src="/fixture.svg" />;', 'export const View = () => <img src="/fixture.svg" alt="Fixture" />;'],
    ['valid accessibility roles', 'jsx-a11y/aria-role', 'export const View = () => <div role="imaginary-role" />;', 'export const View = () => <div role="status" />;'],
    ['stable keys in lists', 'react/jsx-key', 'export const View = () => [1, 2].map(item => <span>{item}</span>);', 'export const View = () => [1, 2].map(item => <span key={item}>{item}</span>);'],
  ])('rejects missing %s and accepts its repaired control', async (_name, rule, invalid, valid) => {
    expect(await messages(invalid)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: rule, severity: 2 }),
    ]));
    expect(await messages(valid)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: rule }),
    ]));
  });

  it('warns about unused locals while suppressing explicitly ignored locals', async () => {
    const found = await messages('export function inspect() { const unused = 1; const _reserved = 2; return 3; }');
    const unused = found.filter(message => message.ruleId === '@typescript-eslint/no-unused-vars');
    expect(unused).toHaveLength(1);
    expect(unused[0]).toEqual(expect.objectContaining({ severity: 1, message: expect.stringContaining('unused') }));
    expect(unused[0]?.message).not.toContain('_reserved');
  });

  it('warns about unused arguments while suppressing underscore arguments', async () => {
    const found = await messages('export function inspect(unused: number, _reserved: number) { return 3; }');
    const unused = found.filter(message => message.ruleId === '@typescript-eslint/no-unused-vars');
    expect(unused).toHaveLength(1);
    expect(unused[0]).toEqual(expect.objectContaining({ severity: 1, message: expect.stringContaining('unused') }));
    expect(unused[0]?.message).not.toContain('_reserved');
  });

  it('warns about explicit any and accepts unknown with the same exported API', async () => {
    expect(await messages('export function inspect(input: any) { return input; }')).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: '@typescript-eslint/no-explicit-any', severity: 1 }),
    ]));
    expect(await messages('export function inspect(input: unknown) { return input; }')).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: '@typescript-eslint/no-explicit-any' }),
    ]));
  });

  it('warns on interface declarations and accepts equivalent type aliases', async () => {
    expect(await messages('export interface Item { name: string }')).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: '@typescript-eslint/consistent-type-definitions', severity: 1 }),
    ]));
    expect(await messages('export type Item = { name: string };')).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: '@typescript-eslint/consistent-type-definitions' }),
    ]));
  });

  it('accepts console use, inferred function returns and JSX without a React namespace import', async () => {
    expect(await messages('export const View = () => { console.log("fixture"); return <span>Fixture</span>; };')).toEqual([]);
  });

  it.each([
    '.next/fixture.ts', 'out/fixture.ts', 'dist/fixture.ts', 'build/fixture.ts',
    'node_modules/fixture.ts', 'drizzle/fixture.ts', 'burn4-fixture.config.js', 'burn4-fixture.config.mjs',
  ])('does not lint generated or tool-managed input %s', async filename => {
    expect(await engine.isPathIgnored(`${repositoryRoot}/${filename}`)).toBe(true);
  });

  it('keeps application TypeScript in the lint boundary', async () => {
    expect(await engine.isPathIgnored(`${repositoryRoot}/src/burn4-fixture.tsx`)).toBe(false);
  });
});
