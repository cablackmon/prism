# Deployment and update offline failure boundaries

The package executes byte-identical copies of `scripts/deploy-local.sh` and `scripts/update.sh` in disposable `/tmp` fixtures. No source rewrite or root relocation is needed. Fixture paths contain spaces to exercise argument quoting.

All child shells receive an environment containing only the fixture PATH. That PATH contains six fake executables: npm, Docker, legacy Compose, Git, curl and sleep. Each wrapper invokes an absolute Node executable and a strict argument dispatcher. It records Docker shell command text without executing it. Fake npm creates harmless build placeholders; fake Docker validates source directory availability. No real build, deployment, network, Git pull, restart, ownership change or wait occurs. Unknown argument combinations fail with status 98. Tests calibrate injected failure codes and unsupported commands. A missing legacy Compose test omits its fake executable, leaving no host PATH fallback.

There are 27 passing cases: 25 ordinary and two expected failures for one named defect. Coverage includes complete deploy ordering, static cleanup, public/service-worker copying, ownership repairs, restart/readiness ordering, every mandatory command failure, missing artifact directories, readiness transport and HTTP failures, update pull/rebuild ordering, legacy Compose failure and absence, byte-identical source copies and fake argument rejection.

Run from the repository root with installed dependencies:

```sh
node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r3-s09/burn4-deploy-update.test.ts src/__tests__/burn4-tg3r3-s09/burn4-deploy-gaps.test.ts --cacheDirectory /tmp/burn4-tg3r3-s09-jest
node_modules/.bin/eslint src/__tests__/burn4-tg3r3-s09/burn4-*.ts --max-warnings=0
node_modules/.bin/tsc --project src/__tests__/burn4-tg3r3-s09/burn4-tsconfig.json --noEmit
```

## KNOWN GAP

The local deploy script exits zero after readiness curl fails because the final warning echo succeeds. Two expected-failure cases cover transport status 7 and HTTP failure status 22. Each has one intended assertion requiring nonzero script status. The ordinary companion cases independently calibrate curl failure status, full command order and the warning branch. Both uninverted lane-local probes fail at the intended assertion: expected a value other than zero, received zero.

## Limits and decisions

Strict TypeScript checks only the test and harness files. Shell behavior is executed with Bash, not typechecked. Fake command results prove orchestration and failure propagation without proving Docker, Compose, curl or Git behavior. No repository-wide suite, build, service, real environment or credential is used. Needs decision: none.
