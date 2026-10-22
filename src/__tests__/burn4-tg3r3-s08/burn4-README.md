# Release document transformation and atomicity

This package exercises `scripts/release.sh` against disposable repository layouts in `/tmp`. The harness reads the checked-in source dynamically and copies its exact text into the fixture. Production source files remain unchanged. Fixture package metadata, changelog history and optional Home Assistant manifest are synthetic.

Coverage includes argument syntax, missing and malformed documents, unchanged preflight failures, patch/minor/major releases, YAML version quoting, complete Markdown note movement, retained historical sections, successive releases, repeated invocations, process failures and changed changelogs between preflight and write. The controlled file changes exercise all three guards in the later changelog phase without a timing-dependent race.

The child environment contains only a closed fixture PATH, `LC_ALL=C` and `TZ=UTC`. Real local commands are allowlisted Bash, dirname, cat and Node. The date wrapper provides a fixed harmless date. The Node wrapper counts phases, optionally fails a phase, and optionally writes a specified synthetic competing changelog edit before a phase. Every fixture is removed in a finally block and child execution has an eight-second timeout.

The final `scripts/check-version-sync.sh` is a fixture fake that records invocation and returns a selected status. The original checker, release publishing, tags, Git commands and hosted services are outside this package's execution scope. Suggested commands remain output text.

Run from the repository root using installed dependencies:

```sh
node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r3-s08/burn4-release-preflight.test.ts src/__tests__/burn4-tg3r3-s08/burn4-release-transformation.test.ts src/__tests__/burn4-tg3r3-s08/burn4-release-gaps.test.ts --cacheDirectory=/tmp/burn4-tg3r3-s08-jest
node_modules/.bin/eslint src/__tests__/burn4-tg3r3-s08/burn4-*.ts --max-warnings=0
node_modules/.bin/tsc -p src/__tests__/burn4-tg3r3-s08/burn4-tsconfig.json
```

Validation: 51 tests across three test files, consisting of 40 ordinary cases and 11 `test.failing` cases. Focused ESLint passes with zero warnings. Strict scoped TypeScript passes for the tests and harness only. Shell and embedded JavaScript are exercised through actual local execution. These are focused checks, with no whole-suite result claimed.

KNOWN GAP list, five defects represented by eleven cases:

- A requested version already present in changelog history is accepted and duplicated. The preflight describes this as checking that the version is new, but only compares against the current package version.
- Multiple Unreleased headings are accepted, causing a second Unreleased section to appear inside the release notes.
- A malformed historical heading such as `## [1broken` qualifies as a versioned release anchor.
- A package without a current version field passes preflight and is treated as a valid release baseline.
- Document writes are not atomic. The package version remains changed after an invalid addon manifest, a later process failure, final checker rejection, or a competing changelog change rejected by the later validation guards. This defect has seven cases. Competing changelog content is preserved; its package version rollback is the failing contract.

Each expected-failure case contains one intended behavior assertion. A temporary untracked probe replaces `test.failing` with `test` and runs only that probe file. All eleven cases fail at the intended document or rejection assertion. Lane evidence is retained under `state/s08/gap-probe-results.json`, `state/s08/gap-probe.log` and `state/s08/gap-probe-evidence.md`; the temporary probe file is removed.

Accepted numeric version strings include lower versions under the existing helper behavior. Monotonic-version policy is outside this coverage scope.

Needs-decision list: None.
