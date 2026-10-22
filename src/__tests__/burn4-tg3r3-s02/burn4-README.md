# Backup integrity, remote verification and scheduling

New tests cover the unchanged `scripts/backup.sh` and `scripts/backup-scheduler.sh`.
They exercise dump arguments, size boundaries, retention, compression errors,
health signals, remote copy and verification, deletion archival, asset/cache
selection, writable config seeding and scheduled loop behavior.

The shell receives source through stdin after narrowly relocating `/backups`,
filesystem `/data`, `/etc/rclone/rclone.conf`, `/root/.config/rclone` and the
scheduler's backup command into disposable fixtures. Original source is unchanged.
The environment starts empty and receives only fixture PATH, locale and explicit
nonsecret settings. Password configuration is absent. No caller env is read.

The closed PATH contains fake date, dump, gzip, rclone, curl, backup and sleep
commands. Only stat, du, cut, find, ls, grep, mkdir and cp run as real local tools.
The dump and gzip fakes provide controlled stream lengths and exit statuses;
these tests check shell orchestration rather than gzip implementation or actual
PostgreSQL dumps. Synthetic configs contain no authentication values. Each fake
sleep records the requested duration and terminates its parent shell after the
configured number of iterations. Each shell invocation also has a ten-second
timeout. No network command or real wait executes.

Run from the repository root with dependencies installed:

```sh
node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r3-s02/burn4-backup.test.ts src/__tests__/burn4-tg3r3-s02/burn4-backup-gaps.test.ts src/__tests__/burn4-tg3r3-s02/burn4-scheduler.test.ts src/__tests__/burn4-tg3r3-s02/burn4-scheduler-gaps.test.ts --cacheDirectory /tmp/burn4-tg3r3-s02-jest-cache
node_modules/.bin/eslint src/__tests__/burn4-tg3r3-s02/burn4-shell-fixture.ts src/__tests__/burn4-tg3r3-s02/burn4-backup.test.ts src/__tests__/burn4-tg3r3-s02/burn4-backup-gaps.test.ts src/__tests__/burn4-tg3r3-s02/burn4-scheduler.test.ts src/__tests__/burn4-tg3r3-s02/burn4-scheduler-gaps.test.ts --max-warnings=0
node_modules/.bin/tsc --noEmit -p src/__tests__/burn4-tg3r3-s02/burn4-tsconfig.json
```

Counts: 38 total cases, 29 ordinary passes and 9 expected failures naming 6
existing defects. No failed or skipped cases. Scoped TypeScript checks only this
package's tests and harness; shell source is executed, not typechecked. No full
suite or whole-repository build is claimed.

KNOWN GAP defects:

- A failed pg_dump producing a large partial stream is accepted because the
  compression pipeline loses its exit status.
- Compression failure exits before sending a failure health ping.
- Off-site copy, asset sync, database verification and asset verification failures
  all return process exit status zero. Four cases share this single defect.
- A configured remote with missing rclone sends a successful health ping.
- Asset verification skips every cache directory, while sync excludes only the
  photo cache. Non-photo cache assets can go unchecked.
- The scheduler promises an immediate startup backup but skips it outside the
  configured backup hour.

Every expected-failure test contains one intended behavior assertion. The same
nine cases were run without inversion in temporary untracked probe files and
all failed at their intended assertions. Lane evidence is in
`state/s02/gap-probe.log` and `state/s02/gap-probe.json`.

Needs-decision: none. These tests document defects; production fixes are outside
the new-files-only scope.
