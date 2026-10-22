import assert from 'node:assert/strict';
import { loadDemo } from './burn4-harness';
import { baselineGroceries, baselineRecipes } from './burn4-baseline';

export const gapCases = [
  {
    name: 'Grocery demo requires products missing from baseline seed',
    run: async (load = loadDemo) => {
      const run = load('grocery', { groceries: baselineGroceries });
      let completed = false;
      try { await run.run(); completed = true; }
      catch (error) { assert.equal(String(error), 'Error: Missing synthetic grocery: Apples', 'Probe must reach the actual missing seeded product'); }
      assert.equal(completed, true, 'KNOWN GAP desired contract: grocery recording completes using reset-seeded products');
    },
  },
  {
    name: 'Recipe demo requires an unseeded user-added recipe',
    run: async (load = loadDemo) => {
      const run = load('recipe', { recipes: baselineRecipes });
      let completed = false;
      try { await run.run(); completed = true; }
      catch (error) { assert.equal(String(error), 'Error: Missing synthetic recipe: Carne Asada', 'Probe must reach the actual unseeded recipe'); }
      assert.equal(completed, true, 'KNOWN GAP desired contract: recipe recording completes using a reset-seeded recipe');
    },
  },
  ...(['away', 'babysitter'] as const).map(demo => ({
    name: `${demo === 'away' ? 'Away' : 'Babysitter'} demo broadcasts enabled state after rejected HTTP activation`,
    run: async (load = loadDemo) => {
      const run = load(demo, { status: 503 });
      let callbackError: unknown = null;
      try { await run.run(); } catch (error) { callbackError = error; }
      const enabledEvents = run.actions.filter(action => action.kind === 'dispatch' &&
        (action.value as { enabled: boolean }).enabled);
      assert.equal(enabledEvents.length, 0, `KNOWN GAP desired contract: ${demo} activation failure cannot broadcast enabled state${callbackError ? ' (callback rejected)' : ''}`);
    },
  })),
];
