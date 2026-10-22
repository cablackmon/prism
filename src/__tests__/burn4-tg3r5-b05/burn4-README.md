# UI audit detector behavior

These offline tests cover both unchanged exports from `e2e/helpers/ui-detectors.ts`: `layoutProbe` and `gradeProbe`. The audit sweep currently exercises them only as part of a database-backed diagnostic run whose final assertion checks that the sweep produced findings.

The new tests exercise viewport dimensions, document overflow, tolerance and rounding boundaries, zero-size geometry, overwide containers, element descriptions including SVG, intentional horizontal scrollers, the worst eight overhangs, navigation clipping and spill, severity precedence, repeat-call isolation, serialization without module closures, and JSON report transport.

The four test files contain 56 ordinary passing cases. There are zero expected failures, failed cases or skipped cases. No concrete source defect was confirmed, so the KNOWN GAP list is empty. Needs-decision list: none.

From the repository root:

```sh
./node_modules/.bin/jest --config src/__tests__/burn4-tg3r5-b05/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b05/burn4-geometry.test.ts src/__tests__/burn4-tg3r5-b05/burn4-navigation.test.ts src/__tests__/burn4-tg3r5-b05/burn4-severity.test.ts src/__tests__/burn4-tg3r5-b05/burn4-serialization.test.ts
./node_modules/.bin/eslint --no-ignore --max-warnings 0 src/__tests__/burn4-tg3r5-b05/burn4-*.ts src/__tests__/burn4-tg3r5-b05/burn4-jest.config.cjs
./node_modules/.bin/tsc --project src/__tests__/burn4-tg3r5-b05/burn4-tsconfig.json --noEmit
```

The custom Jest config loads only this package and bypasses the repository setup. The source has no imports, and the tests never load Playwright, the audit spec, authentication helpers or reset helpers. jsdom supplies DOM traversal and computed inline styles. Explicit synthetic rectangles and scroll measurements replace a browser layout engine. The serialization case evaluates only the detector function in an isolated VM with a one-second timeout and supplied DOM globals.

Strict scoped TypeScript includes every new TypeScript test and fixture plus the unchanged detector source. Focused ESLint reports zero warnings. These checks do not establish actual browser layout, CSS rendering, screenshots, service behavior or audit sweep orchestration. All added files stay inside this directory; no source or existing test is changed.

For optional coverage, append `--coverage --coverageProvider v8 --collectCoverageFrom e2e/helpers/ui-detectors.ts` to the Jest command. That run passes all 56 cases with 100% statement, branch, function and line coverage of the detector source. V8 leaves the serialized callback intact; Istanbul instrumentation adds a module closure that cannot be copied into a separate VM.
