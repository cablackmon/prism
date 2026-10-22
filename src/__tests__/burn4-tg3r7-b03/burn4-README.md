# Offline E2E teardown reliability

This package covers the default export in unchanged `e2e/global-teardown.ts`.
It checks temporary input creation, ordered execution and removal, scoped SQL
deletion statements, generic failure reporting, retry independence and overlapping
invocations. The source never receives a real filesystem, subprocess, environment,
database connection or browser. No authentication or reset helper is imported.

The harness reads that one source file, transpiles it with the existing TypeScript
dependency, and evaluates it in a fresh VM. Imports and members are denied unless
explicitly supplied by the harness. Files live in a Map. The fake subprocess
accepts only the teardown command shape, consumes the Map input synchronously and
records completion. SQL is inspected as text and is never executed. Unknown
capabilities fail outside the source's swallowed-error boundary as well.

The synthetic Linux host rejects the explicitly requested Windows shell. Repository
CI runs Playwright on Ubuntu and registers this teardown in `playwright.config.ts`.
The overlap case models two isolated invocations using one temporary directory in
the same millisecond: a second invocation runs immediately before the first fake
subprocess consumes its input. It demonstrates an input filename collision across
overlapping processes. The source export itself remains synchronous. Successful
sequential invocations are covered separately.

Run from the repository root after installing the repository's existing dependencies:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r7-b03/burn4-teardown.test.ts
node node_modules/eslint/bin/eslint.js --max-warnings 0 src/__tests__/burn4-tg3r7-b03/burn4-teardown-harness.ts src/__tests__/burn4-tg3r7-b03/burn4-teardown.test.ts src/__tests__/burn4-tg3r7-b03/burn4-gap-probe.ts
node node_modules/typescript/bin/tsc --noEmit -p src/__tests__/burn4-tg3r7-b03/burn4-tsconfig.json
```

There are 22 ordinary passing cases and three named `test.failing` cases. Those
three express the desired contracts below. A capability-denial test and a simulated
missing-cleanup mutation also check that the harness and success oracle reject
faults. These are offline behavior checks, with no claim about an actual Docker,
PostgreSQL or operating-system run. Three ordinary cases apply minimal hypothetical
repairs to VM copies and require the identical desired contracts to pass. The
repairs use a POSIX shell, move the write inside `try/finally`, and add distinct
inert process IDs to temporary names. They prove the expected-failure contracts can
pass when their defects are repaired. They do not claim those suggestions fully
solve cross-platform behavior or all possible temporary-file collisions.

KNOWN GAP list:

- Global teardown forces `cmd.exe` on supported Linux hosts. The inert Linux host
  cannot execute cleanup, and the source reduces the failure to a warning.
- Global teardown leaves a partial temporary artifact after write failure. The
  write occurs before the `try/finally`, so a partial file is never unlinked.
- Global teardown reuses temporary input across same-millisecond invocations. In
  the demonstrated overlapping-process interleaving, the inner invocation removes
  the shared filename before the outer invocation consumes it.

Run each desired contract without expected-failure inversion. Each command should
exit 1 at the named `KNOWN GAP` assertion:

```sh
node --import tsx src/__tests__/burn4-tg3r7-b03/burn4-gap-probe.ts linux
node --import tsx src/__tests__/burn4-tg3r7-b03/burn4-gap-probe.ts partial
node --import tsx src/__tests__/burn4-tg3r7-b03/burn4-gap-probe.ts concurrent
```

Append `fixed` to any probe command to apply that intended VM repair and require
the same contract to pass with exit 0.

Needs-decision: None. Production source stays unchanged for review.
