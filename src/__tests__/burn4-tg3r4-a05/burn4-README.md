# CalDAV smoke lifecycle coverage

This package exercises unchanged `scripts/smoke-caldav-write.mjs` with synthetic fixtures. It adds 76 cases: 71 ordinary passes and five named expected failures. No source file is changed.

## Run

From the repository root with dependencies already installed:

```sh
./node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r4-a05/burn4-lifecycle.test.ts src/__tests__/burn4-tg3r4-a05/burn4-boundaries.test.ts src/__tests__/burn4-tg3r4-a05/burn4-gaps.test.ts --cacheDirectory /tmp/prism-burn4-a05-jest
./node_modules/.bin/eslint src/__tests__/burn4-tg3r4-a05/*.ts --max-warnings 0
./node_modules/.bin/tsc -p src/__tests__/burn4-tg3r4-a05/burn4-tsconfig.json --noEmit --incremental false
```

TypeScript checks only the new tests, protocol and harness. JavaScript source is evaluated unchanged after its four exact import declarations and shebang are removed in memory. Two helper cases evaluate only the original declaration prefix before SQL initialization. This is a focused package, with no full suite, build or provider integration claim.

## Coverage and isolation

The tests cover argument and source selection, configuration URL precedence, bound SQL parameters, decrypt call ordering and exceptions, event property marshaling, create/read/update/delete ordering, response failures, thrown dependency failures, SQL shutdown, two eventual-consistency waits, deferred asynchronous boundaries and concurrent executions.

Each case starts one disposable Node child with `env: {}`. The child reads only the supplied source/options from stdin and writes safe synthetic trace JSON to stdout. It constructs a VM with fake postgres, DAV, ICAL, crypto, Buffer, process, clock, timers and logs. No source dependency is imported. Common network/module globals throw, module declarations are checked and VM string code generation is disabled. This isolates this known source, with no claim that Node VM is a security boundary for hostile code.

The VM environment Proxy returns only `undefined` for the three expected names and rejects enumeration and unknown reads. Fixture rows omit authentication material. Fake Buffer accepts only `undefined` and returns inert objects with no bytes. Fake crypto records ordering and returns `undefined`; the original addition produces unusable `NaN`, which the fake client validates. No real or fixture credential, key, ciphertext or environment value exists. This does not test cryptographic correctness or primary-key precedence when a value is present.

The VM exit callback synchronously flushes the trace, then calls the disposable child's real `process.exit`. Explicit source exits therefore stop immediately and skip `finally`, matching Node termination. Ordinary throws are caught outside the VM for trace assertions; their child status is deliberately not treated as the CLI's native unhandled-rejection status. OS socket shutdown, actual database cleanup and external effects are unmodeled.

The ICAL fake records the source's property calls, UTC flags and timing; it does not verify the real library's encoding or escaping. Readbacks are handwritten synthetic property strings. The folded-summary case uses CRLF followed by a space, and a separate unfolding precondition verifies that its logical property equals the submitted title. Delays run as controlled microtasks without elapsed time. The shared filename registry detects concurrent collisions without implementing a real CalDAV server.

## KNOWN GAP list

- A successful create is abandoned when a later update throws. Desired assertion: a cleanup delete occurs once after the created event and update rejection.
- Delete verification ignores a remaining event with an opaque href and the smoke UID only in its data. Desired assertion: exit 1 after that final readback.
- Concurrent runs in the same millisecond create the same filename because the UID contains only `Date.now()`. Desired assertion: two distinct resource names.
- Update verification accepts an unrelated title containing `UPDATED`, such as `NOT UPDATED`. Desired assertion: exit 1 instead of accepting that title.
- Update verification rejects a valid folded `SUMMARY` because the regex reads only its first physical line. Desired assertion: complete the lifecycle after the expected logical title is returned.

All five were inverted individually by copying the gap file and replacing only `test.failing(` with `test(`. Each failed at its intended final assertion; earlier preconditions passed. To reproduce without changing a committed file, create a temporary owned copy:

```sh
python3 - <<'PY'
from pathlib import Path
root = Path('src/__tests__/burn4-tg3r4-a05')
source = root / 'burn4-gaps.test.ts'
target = root / 'burn4-inverse.test.ts'
with target.open('x') as handle:
    handle.write(source.read_text().replace('test.failing(', 'test('))
PY
./node_modules/.bin/jest --runInBand --runTestsByPath src/__tests__/burn4-tg3r4-a05/burn4-inverse.test.ts --cacheDirectory /tmp/prism-burn4-a05-jest
```

The inverse command must exit 1 with five failing assertions: missing cleanup delete, missing delete-verification exit, one filename instead of two, missing title-verification exit and incomplete folded-title lifecycle. Remove only the temporary copy afterward:

```sh
python3 - <<'PY'
from pathlib import Path
Path('src/__tests__/burn4-tg3r4-a05/burn4-inverse.test.ts').unlink()
PY
```

Needs-decision list: none. SQL shutdown masking an earlier rejection and immediate delete readback are recorded as current behavior or limitations, without proposing policy changes.
