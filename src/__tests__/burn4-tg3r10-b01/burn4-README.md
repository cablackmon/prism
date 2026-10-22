# Signed-in recipe reader and printing

Open `/recipes/read` to choose a saved recipe, or `/recipes/read?id=<recipe UUID>` to read one directly. The page uses the existing recipe GET endpoints and their existing session checks. Copy read-only link copies a link to this installation; another household member must sign in to read it. This does not create public or anonymous recipe sharing.

The new page renders recipe text, ordered ingredient headings and lines, instructions, timing, servings, cuisine and category. Structured ingredients retain their amount and unit strings. It leaves quantities unchanged and omits recipe notes, creator/history data, images and source URLs. Print recipe requests the browser print dialog through an explicit user gesture. The print stylesheet hides the application shell while this reader is mounted, including overlays outside the reader root, and restores normal print behavior when the reader is absent.

Written basis: `docs/features/RECIPES.md` lines 190-192 and `docs/planning.md` line 71 describe a dedicated print view and read-only recipe links. Earlier round 6 work provided an offline JSON-to-HTML command. This package adds the saved-recipe browser route without importing that command or changing existing application source.

## Offline verification

Run from this worktree with the repository dependencies installed:

```sh
node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r10-b01/burn4-jest.config.cjs --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r10-b01/burn4-model.test.ts src/__tests__/burn4-tg3r10-b01/burn4-ui.test.tsx
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r10-b01/burn4-tsconfig.json
node node_modules/eslint/bin/eslint.js --no-config-lookup --config src/__tests__/burn4-tg3r10-b01/burn4-eslint.config.mjs --max-warnings=0 src/lib/burn4-recipe-reader.ts src/components/recipes/burn4-recipe-reader.tsx src/app/recipes/read/page.tsx src/__tests__/burn4-tg3r10-b01/
```

The focused package has 97 ordinary passing cases, zero failures, skips or expected failures. Scoped strict TypeScript and focused zero-warning lint pass. The Jest config restricts discovery to the two owned test files, uses its own setup and named TypeScript config, and has no root setup or configuration inheritance. A default rejecting fetch fake prevents accidental network requests; each request test supplies its own synthetic response.

Coverage targets are only the new model's seven exported functions, the new reader component and the actual new route wrapper. Existing recipe endpoints are HTTP contracts only and are never imported or executed by these tests. Behavior cases cover projection and field bounds, structured ingredients, exact identity matching, GET/session/error contracts, byte limits and UTF-8, streamed-read cancellation, missing and malformed responses, retry, paging, selection changes and stale results, query/back navigation, unmount, escaped text, clipboard and print gestures, and failures. The CSS assertion checks the route-scoped print contract; it does not prove browser printing.

## Limits and review

- Existing navigation and recipe dialogs do not gain links to this route. Open its URL directly. No existing source is changed.
- Links require access to the same installation and a session authorized by its existing endpoint. This page creates no access capability, sharing state or server authentication changes.
- The existing list endpoint returns an empty 200 response when signed out. The empty-state text reflects that ambiguity; detail denials are shown using their real status.
- Index pages hold at most 100 rows and offsets stop at 100000. No snapshot consistency is promised if recipes change between page reads.
- Each response is limited to 1 MiB before JSON parsing. Display fields and ingredients have additional explicit bounds. Out-of-contract data fails visibly instead of being silently shortened.
- Displayed data remains a snapshot until selection or retry; this package adds no live refresh or account-change subscription.
- Print containment uses CSS `:has`. A modern browser is required. jsdom tests do not establish print preview, paper pagination, physical-device layout, actual clipboard permissions, screen-reader behavior, or completion of printing.
- No whole-app build, full suite, live service, database or browser check is claimed.

KNOWN GAP list: None found in accepted new-code scope.

Needs-decision list: None within the accepted signed-in scope. Anonymous public recipe sharing remains outside this package.
