# Recipe quantity and meal date regressions

These tests import the unchanged `scaleIngredient.ts` and `mealDate.ts` modules.
All inputs are literal recipe text, numbers and calendar dates. They perform no
filesystem, network, database or provider operations, and do not read or alter
process environment values.

Existing quantity tests cover basic doubling, halving and leading-count
preservation. This package adds factor guards, thirds and arbitrary fractions,
mixed quantities, precision tolerances and exact surrounding text preservation.
Every exported function in the two covered modules has behavior assertions.

Existing meal date tests enumerate weekday windows. This package adds exact
results across leap days, century leap rules, month and year changes, unknown
weekday fallback and invalid anchor behavior, without repeating that matrix.

Run from the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q03/burn4-scale-ingredient.test.ts src/__tests__/burn4-tg3r2-q03/burn4-meal-date.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r2-q03/burn4-scale-ingredient.test.ts src/__tests__/burn4-tg3r2-q03/burn4-meal-date.test.ts --max-warnings 0
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r2-q03/burn4-tsconfig.json --noEmit
```

The verified suite has 60 tests: 59 ordinary passes and one `test.failing`
regression for the known defect below. There are no skipped or todo cases.
Focused ESLint passes with zero warnings. The scoped strict TypeScript check
includes the test files, both source modules and their imported dependencies.
It does not check unrelated application files.

## Known gap

- A decimal without an initial zero is parsed as an integer suffix.
  `scaleIngredientText('.5 cup cream (8 oz carton)', 2)` returns
  `.10 cup cream (8 oz carton)` instead of `1 cup cream (8 oz carton)`.
  The quantity matcher starts at `5` and preserves the preceding decimal point.
  The ordinary assertion failed with this precise expected/received difference
  before it was marked `test.failing`. Replacing `test.failing` with `test` in a
  disposable copy reproduces the failure. A future fix makes this expected
  failure fail, requiring it to become an ordinary regression test.

Needs decision: none. The current implementation remains unchanged.
