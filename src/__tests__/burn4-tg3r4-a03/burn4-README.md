# Offline container startup coverage

These 25 tests execute the unchanged `docker/entrypoint.sh` and `docker/entrypoint-screenshots.sh` scripts with `/bin/sh`. They cover migration and startup ordering, readiness retries, mandatory phase failures, missing command failures, output visibility, final command exit status, exec PID preservation, SIGTERM/SIGINT delivery and independent concurrent boots.

The shell children receive no inherited environment. Their only supplied environment entry is a fixture-local PATH containing strict inert node, npx, npm and sleep fakes. Fakes accept only the expected command shapes, record stage names and PIDs, and use synthetic control files. They never run JavaScript, package managers, a database, a server or a real delay. Probe text is compared as an opaque argument; it is never evaluated. Each fixture lives in this package's temporary `burn4-fixtures` directory and removes its files after the test.

Signal tests hold the final fake command on stdin, verify that its PID matches the entrypoint PID, send a signal and inspect its trap result. They verify the shell's exec behavior. They do not claim that npm forwards signals to its own children. Async children have a two-second kill budget, and synchronous children have a 1.5-second timeout. These budgets detect harness failures rather than define a product retry policy.

Run from the repository root:

```sh
./node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r4-a03/burn4-production-startup.test.ts src/__tests__/burn4-tg3r4-a03/burn4-screenshot-startup.test.ts
./node_modules/.bin/eslint --max-warnings 0 src/__tests__/burn4-tg3r4-a03/burn4-startup-fixture.ts src/__tests__/burn4-tg3r4-a03/burn4-production-startup.test.ts src/__tests__/burn4-tg3r4-a03/burn4-screenshot-startup.test.ts
./node_modules/.bin/tsc --project src/__tests__/burn4-tg3r4-a03/burn4-tsconfig.json --noEmit --incremental false
```

The lane validation adds its own local Jest cache and JSON report path. TypeScript checks only these tests and their harness; the unchanged shell scripts are exercised rather than typechecked. No full suite, build, browser, container or production validation is claimed.

KNOWN GAP list: None verified. The screenshot source explicitly retries readiness until it succeeds. No documented finite retry requirement was found, so an arbitrary retry cap is not asserted as a defect.

Needs-decision list: None.
