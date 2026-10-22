# Offline outbound text scanner coverage

These tests execute the unchanged `scripts/scan-text.sh` against synthetic text and a disposable denylist. They cover stdin and named files, spaces in paths, missing input, missing denylist warnings, case handling, word boundaries, literal punctuation, comment filtering, entry numbering, multiple findings, line numbers, diagnostic limits, private address ranges, email exemptions, postal shapes and coordinate shapes.

Each fixture lives under the checkout with a `burn4-s07-fixture-` prefix and is removed after its test. Child processes receive only a fixture PATH, an explicit fixture denylist path and the C locale. PATH contains symlinks to four allowlisted local commands: `cat`, `grep`, `head` and `sed`. A fixed Bash `printf` pipeline supplies real stdin because Node input sockets cannot reopen `/dev/stdin` on this host. The scanner source is neither copied nor rewritten. The tests never read a caller environment, real denylist, personal data or service configuration. They make no network calls.

The suite has 55 cases: 50 ordinary cases and 5 expected failures. The expected failures cover four defects:

- KNOWN GAP: denylist diagnostics expose the matched entry in the printed line despite saying the value is withheld.
- KNOWN GAP: a final denylist entry without a trailing newline is skipped.
- KNOWN GAP: a readable directory produces a clean result after `cat` fails.
- KNOWN GAP: missing required `cat` or `grep` commands permit a clean result. Two parameterized cases cover this one defect.

Each expected-failure test has one intended assertion. Removing `test.failing` from a temporary probe caused all five to fail at that assertion: the first exposed a harmless marker, the second returned 0 instead of 1, and the remaining three returned 0 instead of 2. The probe is not part of this PR.

Run only this package from the repository root with dependencies already installed:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r3-s07/burn4-scan-text-input.test.ts src/__tests__/burn4-tg3r3-s07/burn4-scan-text-patterns.test.ts src/__tests__/burn4-tg3r3-s07/burn4-scan-text-gaps.test.ts --cacheDirectory /tmp/burn4-s07-jest-cache
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r3-s07/burn4-scanner-fixture.ts src/__tests__/burn4-tg3r3-s07/burn4-scan-text-input.test.ts src/__tests__/burn4-tg3r3-s07/burn4-scan-text-patterns.test.ts src/__tests__/burn4-tg3r3-s07/burn4-scan-text-gaps.test.ts --max-warnings=0
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r3-s07/burn4-tsconfig.json
```

Focused Jest, ESLint and strict TypeScript checks pass. TypeScript checks only the tests and harness. It does not typecheck the shell source or the full repository. The harness requires Bash and GNU-compatible commands at `/usr/bin/{cat,grep,head,sed}`.

Needs decision: none. Existing source changes are outside this package's new-files-only scope.
