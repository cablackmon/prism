import { parseFontScale } from '../../lib/burn4-font-scale';

describe('explicit font scale validation', () => {
  test.each([null, 50, 51, 75, 99, 100, 125, 199, 200])('accepts the exact value %s', (value) => {
    expect(parseFontScale(value)).toEqual({ ok: true, value });
  });
  test.each([undefined, false, true, '', '100', 'Auto', {}, [], [100], 0, -1, 49, 201, 100.5, NaN, Infinity, -Infinity])(
    'rejects an invalid value without coercion: %s', (value) => {
      expect(parseFontScale(value)).toEqual({ ok: false, error: 'Choose Auto or a whole percentage from 50 to 200.' });
    },
  );
  test('does not inspect or mutate an invalid object', () => {
    const value = Object.freeze({ valueOf() { throw new Error('must not coerce'); } });
    expect(parseFontScale(value).ok).toBe(false);
    expect(Object.isFrozen(value)).toBe(true);
  });
});
