# Fresh-install verifier error detection

Tests execute the unchanged `scripts/test-fresh-install.sh` as bash text in a
disposable fixture directory. Coverage includes exact confirmation gates, modern
and legacy Compose cleanup, tolerated cleanup failures, installer failure order,
container count boundaries, health failures, database counts/filter failures and
the 100-byte page-prefix check.

The fixture contains a strict fake `./scripts/install.sh`. The real installer is
never executed or read. Argument-restricted docker, docker-compose, curl and rm
fakes record operations without contacting services, deleting files or running
any nested command. The closed PATH allows only those fakes and local wc, tr
and head. Those three real tools only receive stdin; controlled failure cases
replace the selected filter with a fake. No host PATH fallback is present.

Subprocesses receive only the fixture PATH and C locale. Caller env is never
inherited or read. The fixture starts without any env, service config or
credential file, and neither the harness nor the fake installer creates one.
Responses are harmless literals in the fake executable. Every shell run has a
ten-second timeout. No Docker, installer, HTTP request, database, paid API or
real Prism data is accessed.

Run from the repository root with dependencies installed:

```sh
node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r3-s10/burn4-fresh-install.test.ts src/__tests__/burn4-tg3r3-s10/burn4-fresh-install-gaps.test.ts --cacheDirectory /tmp/burn4-tg3r3-s10-jest-cache
node_modules/.bin/eslint src/__tests__/burn4-tg3r3-s10/burn4-fresh-install-fixture.ts src/__tests__/burn4-tg3r3-s10/burn4-fresh-install.test.ts src/__tests__/burn4-tg3r3-s10/burn4-fresh-install-gaps.test.ts --max-warnings=0
node_modules/.bin/tsc --noEmit -p src/__tests__/burn4-tg3r3-s10/burn4-tsconfig.json
```

Results: 35 cases, 28 ordinary passes and 7 confirmed expected failures, with
zero failed or skipped cases. Focused lint and strict scoped TypeScript pass.
Only tests and the harness are typechecked; shell source is executed. No full
suite, actual fresh install or whole-repository build is claimed.

KNOWN GAP defects:

- Nonfinal producer failures in the container enumeration, database query and
  page-fetch pipelines are ignored. Plausible partial output permits a passing
  verifier. Three cases cover this shared pipeline-status defect.
- The database count is not validated as a nonnegative integer. Empty text,
  nonnumeric text and a negative value are accepted. Three cases share this
  validation defect.
- A partial health response followed by curl failure has the failed marker
  appended to the body. The equality check misses the failure. One case covers
  this health-error detection defect.

Each expected-failure case has one intended behavior assertion. All seven were
also run without inversion in an untracked temporary probe and failed at that
assertion. Lane evidence is `state/s10/gap-probe.log` and
`state/s10/gap-probe.json`.

Needs-decision: none. Production fixes remain outside the new-files-only scope.
