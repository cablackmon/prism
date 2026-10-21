import { parseShoppingQuantity } from '../../lib/utils/parseShoppingQuantity';

describe('shopping search quantity parsing', () => {
  test.each([
    ['2 cups flour', 'flour', '2', 'cups'],
    ['1.5 lb chicken breast', 'chicken breast', '1.5', 'lb'],
    ['1 1/2 cups milk', 'milk', '1 1/2', 'cups'],
    ['1/3 cup brown sugar', 'brown sugar', '1/3', 'cup'],
    ['½ tsp cinnamon', 'cinnamon', '½', 'tsp'],
    ['⅞ cup stock', 'stock', '⅞', 'cup'],
    ['2 eggs', 'eggs', '2', undefined],
    ['3 BUNCHES kale', 'kale', '3', 'bunches'],
  ])('extracts a search noun and literal quantity from %s', (input, name, quantity, unit) => {
    expect(parseShoppingQuantity(input)).toEqual({ name, original: input, quantity, unit });
  });

  test('normalizes whitespace and unit punctuation without losing the original trimmed text', () => {
    expect(parseShoppingQuantity('  2\tTBSP.   of olive oil  ')).toEqual({
      name: 'olive oil',
      original: '2\tTBSP.   of olive oil',
      quantity: '2',
      unit: 'tbsp',
    });
  });

  test('removes preparation, alternatives, parentheticals and taste notes from a real ingredient', () => {
    expect(parseShoppingQuantity('2 cloves of garlic (about 6 g), peeled or 1 tsp garlic paste')).toEqual({
      name: 'garlic',
      original: '2 cloves of garlic (about 6 g), peeled or 1 tsp garlic paste',
      quantity: '2',
      unit: 'cloves',
    });
  });

  test.each([
    ['red pepper or chilli flakes', 'red pepper'],
    ['salt TO TASTE, plus more for serving', 'salt'],
    ['shrimp (peeled) (deveined)', 'shrimp'],
    ['coriander, finely chopped', 'coriander'],
    ['oregano', 'oregano'],
    ['orange zest', 'orange zest'],
  ])('cleans modifiers without mistaking words for alternative markers: %s', (input, name) => {
    expect(parseShoppingQuantity(input)).toEqual({
      name,
      original: input,
      quantity: undefined,
      unit: undefined,
    });
  });

  test('keeps an unrecognized noun after the quantity instead of treating it as a unit', () => {
    expect(parseShoppingQuantity('2 large eggs')).toMatchObject({
      name: 'large eggs', quantity: '2', unit: undefined,
    });
  });

  test('handles the optional connector with an unmeasured quantity', () => {
    expect(parseShoppingQuantity('3 of avocados')).toMatchObject({ name: 'avocados', quantity: '3' });
  });

  test.each(['', '   ', '2', '2 cups', '(optional)', 'salt to taste'])('does not throw or lose all text for %j', (input) => {
    const result = parseShoppingQuantity(input);
    expect(result.original).toBe(input.trim());
    expect(result.name).toBe(input.trim() === 'salt to taste' ? 'salt' : input.trim());
  });

  test('returns independent results when a caller edits a prior parsed item', () => {
    const first = parseShoppingQuantity('2 cups flour');
    first.name = 'caller edit';
    expect(parseShoppingQuantity('2 cups flour')).toEqual({
      name: 'flour', original: '2 cups flour', quantity: '2', unit: 'cups',
    });
  });

  test.failing('KNOWN GAP: compact mixed Unicode quantities remain in the product search name', () => {
    expect(parseShoppingQuantity('1½ cups flour')).toEqual({
      name: 'flour', original: '1½ cups flour', quantity: '1½', unit: 'cups',
    });
  });

  test.failing('KNOWN GAP: package size before the unit leaves a packaging word in the search name', () => {
    expect(parseShoppingQuantity('2 (14 ounce) cans diced tomatoes')).toEqual({
      name: 'diced tomatoes',
      original: '2 (14 ounce) cans diced tomatoes',
      quantity: '2',
      unit: 'cans',
    });
  });
});
