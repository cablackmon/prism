# Offline emoji asset preparation coverage

These tests execute the unchanged `scripts/copy-emoji-assets.mjs` as an ESM module in a fresh VM context. The only real filesystem read loads that source file. The CLI receives an in-memory filesystem, pure POSIX path functions, a pure file-URL converter, a synthetic module URL, captured console output and a process fake that only supports `exit`. Imports are allowlisted. No real assets are copied and the CLI cannot access process configuration.

The cases cover missing dependency fallback, recursive copy into a missing destination, partial destinations at zero and exactly 1000 entries, overwriting partial files while preserving unrelated files, a successful warm-cache invocation after 1001 files, encoded module locations, directory-list/create/copy failures, and retry after a small interrupted copy.

## Confirmed defect

One `test.failing` case names the KNOWN GAP: the cache uses destination entry count as a completeness check. If copying 1002 SVGs fails after 1001 files, the next invocation exits successfully without restoring the missing SVG. This is one defect. Removing only `test.failing` makes the assertion for the missing asset content fail with `Received: undefined`; the setup and first-copy failure assertions pass. Production code remains unchanged.

## Run

From the repository root:

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q07/burn4-emoji-assets.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r2-q07/burn4-emoji-vm.ts src/__tests__/burn4-tg3r2-q07/burn4-emoji-assets.test.ts --max-warnings 0
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r2-q07/burn4-tsconfig.json --pretty false
```

Expected counts: 12 cases, comprising 11 ordinary passes and one confirmed expected failure, with no skipped cases. Node's experimental VM module flag is required. The strict TypeScript check covers the new tests and harness only; it does not typecheck the JavaScript CLI or represent a repository-wide check. The memory copy fake models recursive merging and overwrites, plus injected failures, and is not an integration test of Node's filesystem implementation. No source-refresh or cache invalidation policy beyond interrupted-copy recovery is asserted. Needs decision: none.
