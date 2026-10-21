# Recipe and shopping parser coverage

This package exercises the real `parseRecipeText` and `parseShoppingQuantity` exports. All inputs are synthetic recipe text. These pure functions need no fakes, network, browser, database, environment values or provider access.

Coverage includes full recipe cards, headerless classification, time and serving metadata, ingredient groups, repeated sections, dropped notes, bullet removal, OCR step splitting, whitespace, title casing, empty inputs, modifier cleanup, literal quantities, independent results and the recipe-to-shopping path.

Run only this package from the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p01/burn4-shoppingQuantity.test.ts src/__tests__/burn4-p01/burn4-recipeText.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p01/burn4-shoppingQuantity.test.ts src/__tests__/burn4-p01/burn4-recipeText.test.ts
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-p01/burn4-tsconfig.json --noEmit
```

For coverage, append these options to the Jest command. Choose a local output directory outside tracked files:

```sh
--coverage --collectCoverageFrom=src/lib/utils/parseShoppingQuantity.ts --collectCoverageFrom=src/lib/utils/recipeTextParser.ts --coverageDirectory=/tmp/prism-burn4-p01-coverage
```

## Validation

There are 60 test cases: 54 ordinary passing cases and 6 named `test.failing` cases. There are no skipped cases. Jest reports all 60 as passing because the six expected failures currently fail as intended. Temporarily running the same cases as ordinary tests confirmed exactly those six assertion failures and 54 passes. The confirmation copies were removed before publication.

Focused ESLint and focused TypeScript checking passed. The restricted tsconfig checks these tests and their imported source modules; this does not claim whole-repository type safety. The focused coverage run measured 100% lines, 100% functions, 99.45% statements and 99% branches across the two source files. Coverage includes execution within the expected-failure cases.

## KNOWN GAP defects

- Compact mixed Unicode quantities remain in the product search name: `1½ cups flour` produces `1½ cups flour` instead of `flour` and does not expose quantity or unit.
- Package size before the unit leaves a packaging word in the search name: `2 (14 ounce) cans diced tomatoes` produces `cans diced tomatoes` and misses the `cans` unit.
- Unicode fraction ingredients are misclassified in a headerless recipe: `½ cup oats` and `¼ tsp salt` become instructions rather than ingredients.
- An article followed by a measurement is misclassified despite the documented heuristic: `a pinch of salt` becomes an instruction.
- A timed Cook instruction is removed as cooking metadata: `Cook the pasta for 8 minutes.` disappears from instructions and replaces an explicit `Cook time: 12 min` with 8.
- A timed Bake instruction is removed as baking metadata: `Bake at 180 C for 30 minutes.` disappears from instructions and assigns cooking time 30.

Each expected-failure case asserts the desired parsed result. Source files are unchanged.

## Needs decision

None. Fixing the six defects is follow-up implementation work outside this new-test-files package.
