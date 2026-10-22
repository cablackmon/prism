# Community layout CLI regression coverage

This package covers `scripts/validate-community-layouts.ts` without changing it.
The harness reads that source once, transpiles it with TypeScript, and executes
it in a fresh VM for every invocation. It supplies an in-memory filesystem,
a process with only a throwing `exit` method, captured console methods, and an
allowlisted dependency loader. It never forwards a real process environment.
No community data files, services, network clients or real validators run.
The shared validator is a fake boundary and is outside this package's coverage.
Fixtures use synthetic layout data and only the index fields consumed by the CLI.

`burn4-cli-input.test.ts` covers missing, malformed and empty indexes, malformed
index shapes, missing and unreadable layout files, parsed validator inputs,
resolved file reads, exit handling, and isolation between invocations.
`burn4-cli-aggregation.test.ts` covers validator errors and advisories, index
name/mode/widget count consistency, zero and absent widgets, aggregation across
multiple files, duplicate IDs after file failures, and distinct IDs sharing a file.

Run from the repository root with installed development dependencies:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q05/burn4-cli-input.test.ts src/__tests__/burn4-tg3r2-q05/burn4-cli-aggregation.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r2-q05/burn4-cli-harness.ts src/__tests__/burn4-tg3r2-q05/burn4-cli-input.test.ts src/__tests__/burn4-tg3r2-q05/burn4-cli-aggregation.test.ts --max-warnings 0
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r2-q05/burn4-tsconfig.json
```

The scoped strict TypeScript check covers the tests and harness. It does not
typecheck the CLI or its excluded validator dependency. The VM executes the CLI
with its control flow intact, but this package does not provide an instrumented
line coverage percentage.

There are 26 ordinary passing cases and four expected failure cases using
`test.failing`. Each expected failure was also run as an ordinary test in a
disposable probe. All four failed at the intended no-uncaught-error assertion:

- JSON `null` in the index causes a property access crash before controlled exit.
- An index read failure escapes the command's error reporting and exit handling.
- A null catalog entry crashes before subsequent layouts are validated.
- A null layout crashes consistency checks after the validator reports it, so
  subsequent layouts and the final failure summary are omitted.

These defects remain unchanged. There are no skipped cases or pending tests.
The package needs no product decision; fixes for these defects are outside its
new-files-only scope.
