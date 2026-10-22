# Offline reset helper reliability

This package covers all five exports from unchanged `e2e/helpers/reset.ts`: resetTasks, resetShoppingItems, resetChoreCompletions, resetModes and resetAll.

The source is read and transpiled without edits, then loaded into an isolated VM. Its child_process, fs, os, path and clock dependencies are inert. SQL payloads exist only in a private memory map; assertions use semantic summaries. Commands are classified in memory and never executed or logged. No real environment object is exposed: the VM receives a frozen empty map. No browser, database, Docker, Redis, network, connection fixture or credential is used.

Coverage includes each reset's intended mutation predicates, temporary-file lifecycle, Docker dispatch, cache-before-data ordering, fail-fast behavior, execution/cleanup errors, repeated calls and deterministic interleavings across independent VMs sharing a fake filesystem. This checks orchestration and statement intent; it does not prove database effects. Backend paths that require configured connection material are outside this credential-free harness. TypeScript checks the new tests and harness, not the source loaded as a string.

Run from the repository root with dependencies already installed:

```sh
node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r5-b07/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b07/burn4-reset-lifecycle.test.ts src/__tests__/burn4-tg3r5-b07/burn4-reset-failures.test.ts src/__tests__/burn4-tg3r5-b07/burn4-reset-concurrency.test.ts src/__tests__/burn4-tg3r5-b07/burn4-reset-gaps.test.ts
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r5-b07/burn4-tsconfig.json
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r5-b07/*.ts src/__tests__/burn4-tg3r5-b07/burn4-jest.config.cjs --max-warnings 0
```

Validation: 39 accepted cases, consisting of 37 ordinary passes and 2 named KNOWN GAP expected failures. Zero failures or skips in the normal run. Focused lint passes with zero warnings. Strict scoped test/harness TypeScript passes.

KNOWN GAP list:

- Same-millisecond reset calls share a temporary file and lose a pending payload. The deterministic schedule pauses VM A before its inert subprocess consumes the file, runs VM B completely, then resumes A. B removes the shared path, so A cannot consume its own payload.
- A partial temporary write fails before cleanup and leaves its artifact behind. The fake write creates one byte and throws; source writeFileSync is outside its try/finally, so unlink is never attempted.

Both tests assert intended behavior. They share their exact assertion callbacks with this explicit-only inverse reproduction, which must exit 1 with exactly two assertion failures while these defects remain:

```sh
node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r5-b07/burn4-jest.config.cjs --runInBand --testMatch '**/burn4-reset-gaps.inverse.ts' --runTestsByPath src/__tests__/burn4-tg3r5-b07/burn4-reset-gaps.inverse.ts
```

The inverse file does not match normal discovery. No existing E2E suite runs. Once a source fix makes the intended behavior pass, the expected-failure test will fail and should be converted to an ordinary regression case.

Needs-decision: none. Source fixes are outside this new-files-only package.
