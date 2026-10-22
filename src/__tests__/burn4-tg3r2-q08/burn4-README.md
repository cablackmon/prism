# Local release check regressions

These tests run unchanged copies of `scripts/check-inline-js.sh` and
`scripts/check-version-sync.sh` against disposable fixture files. They do not
read real release metadata or execute inline JavaScript. Each child launches
`/bin/bash` with an empty environment. There are no provider calls, databases,
network clients, family data, or operational scripts.

Fixtures use unique directories from Node's `os.tmpdir()` (`/tmp` on the
verification host). Every test removes its fixture in `afterEach`. The inline
scanner also creates its own temporary parser files
with its unchanged `mktemp` and EXIT trap. Local Bash, Node.js 24 or newer, awk,
GNU csplit, sed, grep, head, tr and mktemp are required.

## Coverage

- Inline scanner: missing input, missing files, empty documents and blocks,
  multiline bodies, opening-line and closing-line code, module syntax, syntax
  checking without execution, duplicate declarations, per-block isolation,
  multiple failures, filenames with spaces, and ignored external scripts.
- Version check: changelog heading selection, matching optional addon metadata,
  caller directory independence, quote handling, drift diagnostics, absent or
  malformed package and changelog files, absent version fields, and first addon
  version selection.
- Counts: 49 tests, consisting of 45 ordinary passing cases and four confirmed
  expected failures. There are no skipped or todo tests in the normal run.

## Run

From any clone with the repository dependencies installed:

```sh
./node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q08/burn4-inline-js.test.ts src/__tests__/burn4-tg3r2-q08/burn4-version-sync.test.ts
./node_modules/.bin/eslint src/__tests__/burn4-tg3r2-q08/burn4-inline-js.test.ts src/__tests__/burn4-tg3r2-q08/burn4-version-sync.test.ts src/__tests__/burn4-tg3r2-q08/burn4-shell-fixture.ts --max-warnings 0
./node_modules/.bin/tsc -p src/__tests__/burn4-tg3r2-q08/burn4-tsconfig.json
```

The scoped TypeScript check covers the test and fixture TypeScript only. The
production sources are Bash scripts and are exercised behaviorally.

## KNOWN GAP defects

Each `test.failing` asserts the desired exit status. Removing only the failing
modifier produces the following assertion failures on the unchanged source:

1. A valid same-line script retains `</script>` in the extracted JavaScript.
   Expected exit 0, actual exit 1.
2. A second opening tag on the same line hides an earlier invalid script.
   Expected exit 1, actual exit 0.
3. Whitespace before `src =` causes an external body to be syntax checked.
   Expected exit 0, actual exit 1.
4. Uppercase HTML script tags bypass syntax checking.
   Expected exit 1, actual exit 0.

Source fixes are outside this tests-only package. Expected-failure tests will
fail on an unexpected pass so a later fix can retire the modifier.

Needs decision: none.
