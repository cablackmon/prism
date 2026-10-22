# Offline repository scanner contracts

This package executes unchanged `scripts/scan-pii.sh` and `scripts/scan-secrets.sh` against disposable synthetic Git repositories. It covers tracking and working-tree changes, staged paths, whitespace in paths, exact repository exclusions, binary handling, denylist normalization and fixed-word matching, PII exemptions, rule aggregation, line counts, missing dependencies and diagnostic privacy.

Validation: 74 cases, comprising 55 ordinary passes and 19 confirmed expected failures. There are no failed or skipped cases in the focused run. The expected-failure count describes cases, not 19 distinct defects.

Run from the repository root after installing the existing dependencies:

```sh
node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r3-s06/burn4-pii.test.ts src/__tests__/burn4-tg3r3-s06/burn4-secrets.test.ts src/__tests__/burn4-tg3r3-s06/burn4-gaps.test.ts --cacheDirectory=/tmp/burn4-s06-jest-cache
node_modules/.bin/eslint src/__tests__/burn4-tg3r3-s06/burn4-*.ts --max-warnings=0
node_modules/.bin/tsc --project src/__tests__/burn4-tg3r3-s06/burn4-tsconfig.json
```

The strict TypeScript project checks this package's tests and fixture harness only. Both production source files are Bash. No full-suite, full-repository typecheck or real-service validation is claimed.

## Isolation and scope

Each test uses a fresh `/tmp/burn4-s06-*` repository and explicit external synthetic denylist. Child processes inherit no caller environment values. Their environment contains only the fixture binary path, scratch path, denylist path, locale and Git isolation settings. No HOME or USERPROFILE is supplied, so the scanners cannot discover a real maintainer denylist. A PATH consisting only of symlinks to Git, grep, xargs, sed, mktemp, rm and wc prevents fallback to other host tools. Git hooks and system/global Git configuration are disabled. Git operations are limited to local init, add and fixture configuration. Each child has a five-second timeout, and fixtures are removed after each test.

Marker text is fictional. Emails use reserved example or `.invalid` domains, and IP-shaped markers contain impossible octets. The secret scanner's positive findings exercise its private-IP pattern and shared control flow. No authentication token, private key, usable healthcheck URL, real identity or credential fixture is generated. Authentication-token rules and the positive healthcheck UUID rule are outside this package's coverage. The tests never scan the actual repository, caller environment or a real denylist. No source relocation or source modification is used.

## KNOWN GAP list

- Indexed findings can be hidden by clean unstaged edits because both scanners read current working-tree content. Two cases cover the scanners separately.
- Tab-containing paths are Git-quoted and never resolved by the newline/xargs pipeline. Two cases.
- Leading-dash paths become grep options because file arguments lack an option terminator. Two cases.
- Missing git, grep or xargs is swallowed as an empty or clean scan. Six cases cover three missing tools across both scanners.
- Running outside a Git repository reports clean success after inventory fails. Two cases.
- Finding diagnostics disclose unrelated text from the matched line. The PII denylist layer and secret scanner both reproduce this disclosure using harmless private-context marker text. Two cases.
- PII example-domain allowlisting accepts unrelated suffixes such as an `.invalid` domain following `example.com`. One case.
- PII placeholder-local-part allowlisting accepts unrelated addresses whose local part merely ends in `you`. One case.
- PII IP-line filtering discards a host finding when unrelated CIDR/network text occurs on the same line. One case.

Each expected-failure test has one intended behavior assertion after setup. Lane-local copies with `test.failing` removed produced exactly 19 assertion failures and zero runtime/setup failures. Status cases returned zero instead of the asserted failure; privacy cases included the context marker instead of excluding it. Burn-run evidence is in lane `state/s06/gap-probe.json`, `gap-probe.log` and `gap-probe-summary.json`. Those local evidence files are outside this PR.

Needs-decision: none. Existing defects remain unfixed because this package adds new files only.
