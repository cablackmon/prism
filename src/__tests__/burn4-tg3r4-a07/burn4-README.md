# Translation test helper contracts

This package tests `src/test-utils/nextIntlMock.tsx` through a synthetic catalog and React server rendering. It does not import real message data or application consumers. Jest substitutes `burn4-catalog.json`; the scoped TypeScript project also maps the catalog import to that fixture.

Coverage includes root and namespace lookup, missing and non-string messages, empty translations, independent translators, placeholder substitution, provider composition, locale and formatter stubs. ICU plural/select strings remain raw as the helper documents.

## Run

From the repository root with dependencies installed:

```sh
./node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r4-a07/burn4-next-intl-helper.test.tsx --cacheDirectory /tmp/prism-burn4-tg3r4-a07
./node_modules/.bin/eslint src/__tests__/burn4-tg3r4-a07/burn4-next-intl-helper.test.tsx --max-warnings 0
./node_modules/.bin/tsc --project src/__tests__/burn4-tg3r4-a07/burn4-tsconfig.json --noEmit --incremental false
```

The run has 29 cases: 25 ordinary passing cases and 4 named expected-failure cases. Focused ESLint and strict scoped TypeScript pass. The TypeScript check covers the helper and package, with the catalog import redirected to the synthetic fixture.

## KNOWN GAP

- Nested translation paths are read as literal property names. Three cases cover a dotted key inside a namespace, a dotted namespace and a dotted path from the root. Existing catalog values are returned as fallback keys instead of their message text.
- Placeholder values are passed directly to JavaScript string replacement. A literal value containing `$&` expands to the matched placeholder, so `Budget $&` becomes `Budget {name}`.

Each named gap uses `test.failing`. Isolated inverse probes changed those cases to ordinary tests and confirmed failure at the intended `toBe` assertion with the expected and actual message values. These four cases represent two underlying defects. A fix will make its corresponding expected-failure case fail until the regression is changed to an ordinary test.

## Needs decision

None. Production helper behavior is unchanged.
