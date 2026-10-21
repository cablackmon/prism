import { parseRecipeText } from '../../lib/utils/recipeTextParser';
import { parseShoppingQuantity } from '../../lib/utils/parseShoppingQuantity';

describe('pasted recipe text parsing', () => {
  test('imports a complete recipe card with metadata, grouped ingredients and steps', () => {
    const result = parseRecipeText(`\n## lemon chicken with rice\nPrep time: 20 min\nCooking time: 1 hour 10 minutes\nServes: about 4\nIngredients:\nFor the chicken:\n• 1.5 lb chicken breast, diced\n- 2 tbsp olive oil\nFor the Sauce...\n1/2 cup stock\n½ tsp salt\nDirections:\nStep 1: Sear chicken.\nStep 2: Simmer in sauce for 15 minutes.\nNotes:\nStore leftovers in the fridge.\n`);
    expect(result).toEqual({
      name: 'Lemon Chicken with Rice',
      prepTime: 20,
      cookTime: 70,
      servings: 4,
      ingredients: [
        { heading: 'chicken' },
        { text: '1.5 lb chicken breast, diced' },
        { text: '2 tbsp olive oil' },
        { heading: 'Sauce' },
        { text: '1/2 cup stock' },
        { text: '½ tsp salt' },
      ],
      instructions: 'Sear chicken.\nSimmer in sauce for 15 minutes.',
    });
  });

  test('classifies headerless ASCII quantities and written measurement quantities', () => {
    expect(parseRecipeText(`quick pancakes\n1 1/2 cups flour\n1/4 tsp salt\nTwo tablespoons sugar\nhalf cup milk\npinch nutmeg\nWhisk until smooth.\nRest the batter.`)).toEqual({
      name: 'Quick Pancakes',
      ingredients: [
        { text: '1 1/2 cups flour' },
        { text: '1/4 tsp salt' },
        { text: 'Two tablespoons sugar' },
        { text: 'half cup milk' },
        { text: 'pinch nutmeg' },
      ],
      instructions: 'Whisk until smooth.\nRest the batter.',
      prepTime: undefined,
      cookTime: undefined,
      servings: undefined,
    });
  });

  test('normalizes CRLF, whitespace and title casing while preserving acronyms', () => {
    expect(parseRecipeText(' \r\n  BBQ chicken and rice: with PB&J  \r\nIngredients\r\n2 cups rice\r\nMethod\r\n   Stir well.  \r\n')).toMatchObject({
      name: 'BBQ Chicken and Rice: With PB&J',
      ingredients: [{ text: '2 cups rice' }],
      instructions: 'Stir well.',
    });
  });

  test('capitalizes stop words at the beginning and end of a recipe title', () => {
    expect(parseRecipeText('the soup to come home to')).toMatchObject({ name: 'The Soup to Come Home To' });
  });

  test.each(['', ' \n\r\n ', 'Ingredients\nInstructions\nNotes'])('uses an editable empty result for %j', (raw) => {
    expect(parseRecipeText(raw)).toEqual({
      name: 'Untitled Recipe', ingredients: [], instructions: '',
      prepTime: undefined, cookTime: undefined, servings: undefined,
    });
  });

  test('recognizes a title after metadata and ingredient lines without consuming those ingredients', () => {
    expect(parseRecipeText('Serves 3\n1 cup rice\nrice pilaf\nStir with stock.')).toMatchObject({
      name: 'Rice Pilaf', servings: 3, ingredients: [{ text: '1 cup rice' }], instructions: 'Stir with stock.',
    });
  });

  test.each([
    ['prep: 1.5 hours', 90],
    ['Prep time 1 hour 30 min', 90],
    ['Prep - 25', 25],
    ['Prep: 15 min, plus chilling', 15],
    ['Prep: 20 minutes + resting', 20],
  ])('extracts a useful prep duration from %s', (metadata, prepTime) => {
    expect(parseRecipeText(`lentil soup\n${metadata}\nInstructions\nStir well.`)).toMatchObject({
      prepTime, cookTime: undefined, instructions: 'Stir well.',
    });
  });

  test('falls back from bake duration to cooking duration and ignores total when a breakdown exists', () => {
    expect(parseRecipeText('apple pie\nPrep: 10 min\nBake time: 45 min\nTotal: 2 hours')).toMatchObject({
      prepTime: 10, cookTime: 45,
    });
  });

  test('prefers explicit cook time over bake time regardless of their ordering', () => {
    expect(parseRecipeText('casserole\nBake: 45 min\nCook: 15 min\nTotal: 80 min')).toMatchObject({ cookTime: 15 });
  });

  test('uses total time as cooking time only when there is no prep or cooking breakdown', () => {
    expect(parseRecipeText('overnight oats\nTotal: 8 hr')).toMatchObject({ cookTime: 480 });
    expect(parseRecipeText('overnight oats\nPrep: 5 min\nTotal: 8 hr')).toMatchObject({ prepTime: 5, cookTime: undefined });
  });

  test('preserves unparseable metadata text in the editable instructions', () => {
    expect(parseRecipeText('soup\nDirections\nPrep: until ready\nCook: 0 min\nStir gently.')).toMatchObject({
      prepTime: undefined,
      cookTime: undefined,
      instructions: 'Prep: until ready\nCook: 0 min\nStir gently.',
    });
  });

  test.each([
    ['Yield: about 6 bowls', 6],
    ['Makes - 12 cookies', 12],
    ['4 servings', 4],
    ['Serving: 1', 1],
  ])('extracts servings from %s and excludes the metadata from sections', (metadata, servings) => {
    expect(parseRecipeText(`tomato soup\nIngredients\n2 cans tomatoes\n${metadata}\nInstructions\nStir well.`)).toMatchObject({
      servings, ingredients: [{ text: '2 cans tomatoes' }], instructions: 'Stir well.',
    });
  });

  test('splits repeated sections and drops tips without swallowing later ingredient or method blocks', () => {
    expect(parseRecipeText(`taco bowls\nWhat you'll need:\nFor rice\n1 cup rice\nTips\nRinse the rice.\nIngredient:\nFor the topping:\nFresh cilantro\nPreparation\nMix the bowls.\nIngredients\nSalt to taste\nTo make\nServe warm.`)).toMatchObject({
      name: 'Taco Bowls',
      ingredients: [{ heading: 'For rice' }, { text: '1 cup rice' }, { heading: 'topping' }, { text: 'Fresh cilantro' }, { text: 'Salt to taste' }],
      instructions: 'Mix the bowls.\nServe warm.',
    });
  });

  test('keeps numbered, fraction and long ingredient lines as text rather than headings', () => {
    const longLine = 'For the very generous topping of toasted nuts and fresh fruit:';
    expect(parseRecipeText(`granola\nIngredients\n2 apples:\n½ cup walnuts:\n${longLine}\nInstructions\nStir gently.`).ingredients).toEqual([
      { text: '2 apples:' }, { text: '½ cup walnuts:' }, { text: longLine },
    ]);
  });

  test('recognizes short heading heuristics without mistaking long prose for headings', () => {
    expect(parseRecipeText('grain bowl\nFor the dressing:\n1 cup yogurt\nFor a lively finish add fresh herbs.\nWhisk everything.')).toMatchObject({
      ingredients: [{ heading: 'dressing' }, { text: '1 cup yogurt' }],
      instructions: 'For a lively finish add fresh herbs.\nWhisk everything.',
    });
  });

  test('strips supported list markers from ingredients while keeping numbered instructions', () => {
    expect(parseRecipeText('salad\nIngredients\n• 2 tomatoes\n(2) 1 cucumber\na) 3 tbsp olive oil\nInstructions\n1. Chop vegetables.\n2) Toss together.')).toMatchObject({
      ingredients: [{ text: '2 tomatoes' }, { text: '1 cucumber' }, { text: '3 tbsp olive oil' }],
      instructions: '1. Chop vegetables.\n2) Toss together.',
    });
  });

  test('does not strip Step labels from a single step or a mixture of labeled and unlabeled steps', () => {
    expect(parseRecipeText('salad\nMethod\nStep 1: Toss well.').instructions).toBe('Step 1: Toss well.');
    expect(parseRecipeText('salad\nMethod\nStep 1: Toss well.\nServe cold.').instructions).toBe('Step 1: Toss well.\nServe cold.');
  });

  test('splits OCR step markers inline while preserving measurements and decimal amounts', () => {
    expect(parseRecipeText('bread\nInstructions\n1. Mix 2 tbsp oil with 1.5 cups flour. 2) Knead gently. Step 3: Rest. • Shape dough.').instructions).toBe(
      '1. Mix 2 tbsp oil with 1.5 cups flour.\n2) Knead gently.\nStep 3: Rest.\n• Shape dough.',
    );
  });

  test('returns independent nested ingredients when another caller edits a previous result', () => {
    const raw = 'rice\nIngredients\n1 cup rice\nMethod\nStir well.';
    const first = parseRecipeText(raw);
    first.ingredients[0]!.text = 'caller edit';
    first.ingredients.push({ heading: 'Extra' });
    expect(parseRecipeText(raw).ingredients).toEqual([{ text: '1 cup rice' }]);
  });

  test('passes preserved recipe ingredient text into shopping noun cleanup without mutating the recipe', () => {
    const recipe = parseRecipeText('pasta\nIngredients\n• 2 tbsp olive oil, divided\n1/2 cup parmesan (optional)\nMethod\nToss well.');
    const products = recipe.ingredients.map(({ text }) => parseShoppingQuantity(text!));
    expect(products.map(({ name, quantity, unit }) => ({ name, quantity, unit }))).toEqual([
      { name: 'olive oil', quantity: '2', unit: 'tbsp' },
      { name: 'parmesan', quantity: '1/2', unit: 'cup' },
    ]);
    expect(recipe.ingredients).toEqual([{ text: '2 tbsp olive oil, divided' }, { text: '1/2 cup parmesan (optional)' }]);
  });

  test.failing('KNOWN GAP: Unicode fraction ingredients are misclassified in a headerless recipe', () => {
    expect(parseRecipeText('oat porridge\n½ cup oats\n¼ tsp salt\nStir well.')).toMatchObject({
      ingredients: [{ text: '½ cup oats' }, { text: '¼ tsp salt' }], instructions: 'Stir well.',
    });
  });

  test.failing('KNOWN GAP: a pinch of salt is misclassified despite the documented article heuristic', () => {
    expect(parseRecipeText('oat porridge\na pinch of salt\nStir well.')).toMatchObject({
      ingredients: [{ text: 'a pinch of salt' }], instructions: 'Stir well.',
    });
  });

  test.failing('KNOWN GAP: a timed Cook instruction is removed as cooking metadata', () => {
    expect(parseRecipeText('pasta\nCook time: 12 min\nIngredients\n2 cups pasta\nInstructions\nCook the pasta for 8 minutes.\nDrain well.')).toMatchObject({
      cookTime: 12,
      instructions: 'Cook the pasta for 8 minutes.\nDrain well.',
    });
  });

  test.failing('KNOWN GAP: a timed Bake instruction is removed as baking metadata', () => {
    expect(parseRecipeText('loaf\nIngredients\n2 cups flour\nInstructions\nBake at 180 C for 30 minutes.\nCool before slicing.')).toMatchObject({
      cookTime: undefined,
      instructions: 'Bake at 180 C for 30 minutes.\nCool before slicing.',
    });
  });
});
