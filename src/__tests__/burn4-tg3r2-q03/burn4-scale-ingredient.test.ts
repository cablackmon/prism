import { formatQuantity, scaleIngredientText } from '@/lib/utils/scaleIngredient';

describe('burn4 recipe quantity rendering boundaries', () => {
  test.each([
    ['not a number', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['zero', 0],
    ['negative amount', -2.5],
  ])('renders %s as zero', (_label, amount) => {
    expect(formatQuantity(amount)).toBe('0');
  });

  test.each([
    [0.25, '1/4'],
    [1 / 3, '1/3'],
    [2 / 3, '2/3'],
    [2.25, '2 1/4'],
    [2 + 1 / 3, '2 1/3'],
    [2 + 2 / 3, '2 2/3'],
    [2.75, '2 3/4'],
  ])('renders the remaining common fraction forms for %s', (amount, expected) => {
    expect(formatQuantity(amount)).toBe(expected);
  });

  test.each([
    [4.01, '4'],
    [3.99, '4'],
    [2.9999999999, '3'],
    [0.241, '1/4'],
    [1.261, '1 1/4'],
    [0.229, '0.23'],
    [0.271, '0.27'],
    [1.124, '1.12'],
    [1.286, '1.29'],
    [1.204, '1.2'],
  ])('applies whole/fraction tolerance or trimmed decimal precision to %s', (amount, expected) => {
    expect(formatQuantity(amount)).toBe(expected);
  });
});

describe('burn4 ingredient scale guards and exact text preservation', () => {
  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'preserves the entire line for a non-finite factor %s',
    (factor) => {
      const text = '\t 1 1/2 cups stock (8 oz), chilled.  ';
      expect(scaleIngredientText(text, factor)).toBe(text);
    },
  );

  test('factor one preserves original notation rather than reformatting it', () => {
    expect(scaleIngredientText('  02.500 cups flour  ', 1)).toBe('  02.500 cups flour  ');
  });

  test.each(['', '  \t', 'salt, pepper & herbs to taste'])('preserves a line with no quantity: %j', (text) => {
    expect(scaleIngredientText(text, 1.5)).toBe(text);
  });

  test.each([
    ['0.4 cup oats', 3, '1.2 cup oats'],
    ['2/5 cup oats', 3, '1.2 cup oats'],
    ['2 2/5 cups oats', 0.5, '1.2 cups oats'],
    ['1/3 cup oil', 3, '1 cup oil'],
    ['2/3 cup oil', 0.5, '1/3 cup oil'],
    ['2 3/4 cups stock', 0.5, '1.38 cups stock'],
    ['0.125 tsp spice', 2, '1/4 tsp spice'],
  ])('scales decimal and non-halves quantities: %s by %s', (text, factor, expected) => {
    expect(scaleIngredientText(text, factor)).toBe(expected);
  });

  test('preserves prefix, punctuation, spacing, package size and trailing instructions byte for byte', () => {
    expect(scaleIngredientText('\t about 1\t1/2 cups stock (8 oz), warm at 180 C.  ', 2))
      .toBe('\t about 3 cups stock (8 oz), warm at 180 C.  ');
  });

  test('scales only the first amount when a line contains another ingredient', () => {
    expect(scaleIngredientText('2 eggs + 1 cup milk', 3)).toBe('6 eggs + 1 cup milk');
  });

  test('preserves both pack count and decimal dimensions after the amount', () => {
    expect(scaleIngredientText('1/4 of a 12-pack, 0.5 oz each', 3))
      .toBe('3/4 of a 12-pack, 0.5 oz each');
  });

  test.each([0, -2])('clamps a nonpositive scaled quantity to zero for factor %s', (factor) => {
    expect(scaleIngredientText('1 1/2 cups stock (8 oz)', factor)).toBe('0 cups stock (8 oz)');
  });

  test.failing('KNOWN GAP: a decimal quantity without an initial zero is scaled as an integer suffix', () => {
    expect(scaleIngredientText('.5 cup cream (8 oz carton)', 2)).toBe('1 cup cream (8 oz carton)');
  });
});
