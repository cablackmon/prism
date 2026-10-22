# Example text audit scanner contracts

This package covers `scripts/scan-examples.sh` without changing it. Every run
creates a disposable Git repository beneath this test directory, writes only
synthetic text, stages explicitly selected fixture files and runs the unchanged
script with that repository as its working directory. A finally block removes
the entire fixture. No real repository contents, family data, environment files
or denylist are scanned.

All child processes receive `env: {}`. Git setup uses `/usr/bin/git`, disables
hooks and uses an empty template. The scanner uses `/bin/bash`; subprocesses
have five second timeouts. The package needs Bash, Git and the GNU utilities
used by the existing script. No environment values are read or forwarded.

The 24 ordinary cases cover both section headings, no matches, nonempty and empty
placeholder syntax, each supported extension, excluded extensions, tracked versus
untracked files, unstaged changes to tracked files, case behavior, nested paths
with spaces, exact matching text and line numbers, multiple files and multiple
pattern occurrences on one line. The review tool exits zero for matches and
nonmatches. The current script emits line numbers without filenames when only
one candidate file reaches grep. Tests record that behavior without asserting a
new diagnostic requirement.

One KNOWN GAP has four representative expected failure cases: each nonempty
section reports one fewer matching line than it emits. One placeholder line
reports zero, one example line reports zero, sections containing two and three
lines report one and two, and multiple occurrences on one line in both sections
report zero for each section. The script's command substitution strips trailing
newlines, then its `printf "%s" | wc -l` counts separators instead of lines.
The defect remains unchanged.

Each expected failure first verifies successful subprocess completion and the
actual number of emitted matching lines. Disposable inverse probes ran those
four cases as ordinary tests. All four failed precisely at the summary assertion,
after six preceding assertions passed. There are no skipped or pending tests.

Run from the repository root with installed development dependencies:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q12/burn4-scan-examples.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r2-q12/burn4-scanner-fixtures.ts src/__tests__/burn4-tg3r2-q12/burn4-scan-examples.test.ts --max-warnings 0
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r2-q12/burn4-tsconfig.json
```

The strict scoped TypeScript check covers the tests and fixture harness. It does
not typecheck the shell source or provide an instrumented source coverage rate.
Needs-decision list: none. Fixing the count defect is outside this new-files-only
coverage package.
