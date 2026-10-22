# Offline traffic dashboard behavior

These tests execute the unchanged inline JavaScript from both traffic/index.html and docs/traffic/index.html. Each source runs in a fresh VM with a synthetic jsdom document, queued fake fetch replies, a recorded fake Chart constructor and a deterministic clock. jsdom does not load resources or run scripts. The external chart dependency is never requested or executed. No browser, service, environment values, family data or credentials are used.

The matrix covers initialization, loading/fallback status, both helpers, remote and local failures, JSON failures, malformed and empty archives, legacy/null optional sections, totals, sorted date ranges, exact fourteen-day windows, gaps and leap/year boundaries, chart datasets, referral discovery and rendering, and independent or overlapping reloads. The fake chart records construction and does not model Chart.js canvas ownership. Same-context repeated main calls are characterized as current behavior; full-page contexts remain isolated.

## Run

From the repository root with its existing development dependencies installed:

```sh
node_modules/.bin/jest --config src/__tests__/burn4-tg3r5-b02/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b02/burn4-presentation.test.ts src/__tests__/burn4-tg3r5-b02/burn4-boundaries.test.ts src/__tests__/burn4-tg3r5-b02/burn4-gaps.test.ts
node_modules/.bin/tsc -p src/__tests__/burn4-tg3r5-b02/burn4-tsconfig.json
node_modules/.bin/eslint --no-ignore --max-warnings 0 src/__tests__/burn4-tg3r5-b02/burn4-harness.ts src/__tests__/burn4-tg3r5-b02/burn4-presentation.test.ts src/__tests__/burn4-tg3r5-b02/burn4-boundaries.test.ts src/__tests__/burn4-tg3r5-b02/burn4-gaps.test.ts src/__tests__/burn4-tg3r5-b02/burn4-jest.config.cjs src/__tests__/burn4-tg3r5-b02/burn4-probe.mjs
node src/__tests__/burn4-tg3r5-b02/burn4-probe.mjs
```

Run the inverse probe sequentially with other b02 checks. It writes an exclusive temporary burn4-inverse.test.ts, replaces only it.failing registrations with ordinary tests, runs only that file in an empty inherited child environment and removes its files in finally. It verifies all four failures point to the intended literal-text equality assertion with the expected markup and received plain domain. It exits successfully only after proving those failures. An optional first argument saves its exact Jest JSON report.

The custom Jest config excludes the repository setup file and discovers only this package. Strict TypeScript covers new test/harness TypeScript. The unchanged HTML runtime is executed as source text and is outside TypeScript checking. Lint includes the Node config and probe with --no-ignore. No full-suite, production build, browser integration or numeric coverage result is claimed.

## Results

104 accepted cases: 100 ordinary passes and four confirmed expected failures. Zero failed or skipped cases in the normal run. Focused lint and strict scoped TypeScript pass. The direct inverse run fails all four cases at the intended assertions, as required.

## KNOWN GAP list

- Current referrer names are parsed as HTML instead of displayed as text. The current-referrers table interpolates external names into innerHTML. A harmless bold element demonstrates that a literal name becomes DOM markup.
- Historical referrer names are parsed as HTML instead of displayed as text. The first-time-referrers table independently interpolates historical names into innerHTML. A harmless italic element demonstrates the same defect at that rendering site.

Each defect is checked against both HTML copies, producing four expected-failure cases. The tests use inert markup with no event handlers, script content or resource URLs. No active exploit runs. Fixes remain separate from this new-files-only package.

## Needs-decision list

None.
