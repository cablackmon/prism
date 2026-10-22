# Avatar storage failure and concurrency coverage

This package covers the unchanged `src/lib/services/avatar-storage.ts`. It extends the existing avatar tests with directory, decoding, transform, encoding and writer failures; asynchronous completion; independent concurrent saves; and validation ordering for all three exports.

The fixture replaces `sharp`, filesystem promises, runtime configuration and the path-ID validator before loading the source. Each input gets its own fake image pipeline and controlled completion promise. No images, family records, process environment, filesystem storage, services or network are used. The runtime configuration and validator implementations are outside this package's coverage scope.

Run only this package from the repository root:

```sh
node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q02/burn4-avatar-save-boundaries.test.ts src/__tests__/burn4-tg3r2-q02/burn4-avatar-concurrency.test.ts src/__tests__/burn4-tg3r2-q02/burn4-avatar-delete-and-guard.test.ts
node_modules/.bin/eslint src/__tests__/burn4-tg3r2-q02/burn4-avatar-fixture.ts src/__tests__/burn4-tg3r2-q02/burn4-avatar-save-boundaries.test.ts src/__tests__/burn4-tg3r2-q02/burn4-avatar-concurrency.test.ts src/__tests__/burn4-tg3r2-q02/burn4-avatar-delete-and-guard.test.ts --max-warnings 0
node_modules/.bin/tsc --project src/__tests__/burn4-tg3r2-q02/burn4-tsconfig.json
```

Verified result: 19 accepted cases, consisting of 17 ordinary passes and 2 confirmed expected failures. No failed or skipped cases in the normal run. Focused ESLint passed with zero warnings. Scoped strict TypeScript passed with no diagnostics, including the imported avatar source and its transitive type dependencies. No whole-repository validation is claimed.

## KNOWN GAP

`deleteAvatar` catches every unlink error and reports successful deletion. The source comment describes tolerating an absent file, but real permission (`EACCES`) and storage I/O (`EIO`) failures also resolve successfully. Two `test.failing` cases require the original failure to reach the caller. A disposable copy with expected-failure inversion removed failed at `.rejects.toBe(error)` for both cases because the promise resolved to `undefined`. Production behavior remains unchanged.

Needs-decision: none. The gap records the defect for later review; this package adds tests only.
