# Traffic history workflow behavior

This package executes the unchanged Python merge heredoc from `.github/workflows/traffic.yml` and its separate publication Bash block. Production source is unchanged. It covers first-run and legacy archives, daily overwrite and deduplication, retained old history, rolling unique snapshots, UTC boundaries, referrer retention, malformed/missing inputs, filesystem failures and publication ordering.

The Python child starts with an empty inherited environment. The driver exposes only four approved imports, guarded file operations under a disposable `/tmp/burn4-b03-*` directory and a synthetic UTC clock. The workflow's fixed API input paths map to that directory. It cannot run the real fetch step or read authentication configuration. Each child has a five-second timeout. The publication block receives inert in-process `git` and `date` functions under an empty inherited environment. No real GitHub workflow, network, git command, service, database or authentication operation runs.

The driver catches source exceptions and returns their types and messages so tests can assert exact failure boundaries. It separately returns the final history bytes, parsed history and parse errors. The interrupted-write fake writes only a prefix to the temporary output, reproducing a disk-write failure without touching any repository archive. This is a narrowly guarded harness for this trusted unchanged script, not a general untrusted Python sandbox.

Prerequisites are the repository's Node dependencies, `/usr/bin/python3` and `/bin/bash`. Only these explicit package files run:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b03/burn4-merge.test.ts src/__tests__/burn4-tg3r5-b03/burn4-errors.test.ts src/__tests__/burn4-tg3r5-b03/burn4-publication.test.ts src/__tests__/burn4-tg3r5-b03/burn4-gaps.test.ts --cacheDirectory=/tmp/burn4-b03-jest-cache
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r5-b03/burn4-harness.ts src/__tests__/burn4-tg3r5-b03/burn4-merge.test.ts src/__tests__/burn4-tg3r5-b03/burn4-errors.test.ts src/__tests__/burn4-tg3r5-b03/burn4-publication.test.ts src/__tests__/burn4-tg3r5-b03/burn4-gaps.test.ts --max-warnings=0
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r5-b03/burn4-tsconfig.json
python3 -I -c "import ast,pathlib; ast.parse(pathlib.Path('src/__tests__/burn4-tg3r5-b03/burn4-driver.py').read_text())"
```

Verified count: 78 accepted cases, comprising 63 ordinary passes and 15 confirmed expected-failure cases. Zero failed or skipped cases. Strict scoped TypeScript covers the new TypeScript tests and harness only. Focused ESLint has zero warnings. The Python driver passes syntax parsing and executes in all Python-backed cases. No full suite, live API, action integration or numeric coverage percentage is claimed.

## KNOWN GAP list

- Failed referrer ingestion clears the latest successful referrer table. Three cases cover a missing file, invalid JSON and a non-list error response. Historical referrer snapshots survive, but the current dashboard table loses its last good data.
- Syntactically valid non-object views/clones API JSON aborts the entire merge instead of isolating the endpoint failure. Ten cases cover null, array, boolean, number and string roots for both endpoints.
- An interrupted JSON write truncates the only valid history archive. One case demonstrates that a failed write leaves partial unparseable JSON rather than the previous archive.
- A staged-diff error is treated as changed content and the publication block still commits and pushes. One case uses diff status 2 and requires the error to stop publication.

Each gap uses `test.failing` and asserts the intended behavior. Direct inverse verification changes only the expected-failure markers to ordinary tests in a temporary owned probe file, then runs that file explicitly. All 15 cases fail at their intended assertions; no harness/setup failure supplies the expected failure. The temporary probe is removed afterward. Remove the marker when the production defect is fixed.

Needs-decision list: none. Source fixes remain outside this new-files-only package.
