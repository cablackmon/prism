# Offline outbound metadata guard coverage

These tests copy `scripts/guard-outbound.sh` unchanged into a disposable fixture root. The fixture has a local fake `scan-text.sh`, synthetic metadata files and a temporary directory. A fixed driver runs under absolute `/bin/bash` with `env: {}`. It defines only a local `mktemp` helper that invokes absolute `/usr/bin/mktemp` inside the fixture scratch directory, then sources the unchanged guard. It makes no environment assignments. The sourced guard retains its own script path when locating the fake scanner.

Every proposed command is encoded as JSON on the guard's stdin. Proposed text is never an executable argument or shell program in the harness. Tests also verify that an inert command-substitution marker is never created. No real scanner, denylist, process configuration, personal information, credential or network service is used. Every fixture is removed in a `finally` block, and tests check that the guard removes its own temporary file on success, rejection and early return.

Coverage includes malformed hook input, nonpublishing metadata, single/double quotes, separated/equals flags, multiline fields, field order, GraphQL bodies, scanner success/rejection/error, harmless attribution patterns, file metadata, missing/empty files, process-substitution references and shell text that stays inert.

Run only these files from the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q13/burn4-guard-parsing.test.ts src/__tests__/burn4-tg3r2-q13/burn4-guard-files.test.ts src/__tests__/burn4-tg3r2-q13/burn4-guard-gaps.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r2-q13/burn4-guard-fixture.ts src/__tests__/burn4-tg3r2-q13/burn4-guard-parsing.test.ts src/__tests__/burn4-tg3r2-q13/burn4-guard-files.test.ts src/__tests__/burn4-tg3r2-q13/burn4-guard-gaps.test.ts --max-warnings 0
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r2-q13/burn4-tsconfig.json
```

Validation: 74 passing tests comprising 60 ordinary behavior tests and 14 confirmed expected failures. No skipped tests. Focused ESLint and strict scoped TypeScript pass. TypeScript checks the new tests and harness only, not the unchanged Bash source.

## KNOWN GAP list

- Unquoted inline values bypass the guard's scanner. Six cases cover `--title`, `--body` and `--notes` with both separated and equals syntax. Valid single-word metadata exits 0 without invoking the fake scanner even when that scanner would reject it.
- Quoted file paths containing spaces are truncated and bypass scanning. Eight cases cover `--body-file` and `--notes-file`, both separators and both quote styles. The existing readable fixture file is not scanned, and the guard exits 0.

A disposable probe replaced only `test.failing` with `test`. All 14 cases failed at the intended rejection boundary: expected status 2, received status 0. The preconditions verified temporary cleanup and that the proposed command never executed. There were no runtime suite errors.

## Needs-decision list

None. Fixing these parsing defects requires a separate production change.

## Limits

These tests cover metadata extraction and the local scanner boundary. They do not verify the real scanner's patterns or execute any proposed GitHub command. Missing or empty files currently contribute no text; those ordinary tests record the extraction boundary without imposing a new publication policy. The fixture requires Linux Bash, Python and text utilities, including `/bin/bash`, `/usr/bin/mktemp` and `/usr/bin/cat`.
