# Offline UI audit sweep behavior

This package covers the six private helpers and registered callbacks in unchanged `e2e/ui-audit.spec.ts`. It adds direct behavior evidence for registration, setup/teardown, actual localStorage initialization, deferred Page operations, error propagation, screenshot/report linkage, mixed-severity counts and sorting, and independent full synthetic sweeps.

The four test files pass 55 cases: 52 ordinary cases and three confirmed expected-failure cases. There are zero failures or skips in the normal run. The expected failures cover two source defects:

- KNOWN GAP: HTTP error pages are accepted as successful route findings. Fake navigation resolves with real-API-shaped 404 and 500 responses. The source ignores the response, grades the error page and returns an ordinary finding. Two cases cover one defect.
- KNOWN GAP: baseline dashboard findings claim 100 percent before stored zoom is reset. A synthetic dashboard beginning at 125 percent keeps that effective zoom during all five screenshots labeled 100 percent. The first scale update occurs only after those baseline probes. One case covers this defect.

The ordinary characterization cases also show both actual outcomes. Direct inverse probes replace only the `test.failing` wrappers in a disposable copy and select the three KNOWN GAP cases. Both HTTP cases fail because the promise resolves instead of rejecting; the baseline case fails its equality assertion between actual scale125 and declared scale100. The original source is unchanged. Needs-decision list: none.

Run from the repository root:

```sh
./node_modules/.bin/jest --config src/__tests__/burn4-tg3r5-b10/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b10/burn4-lifecycle.test.ts src/__tests__/burn4-tg3r5-b10/burn4-probe.test.ts src/__tests__/burn4-tg3r5-b10/burn4-report.test.ts src/__tests__/burn4-tg3r5-b10/burn4-gaps.test.ts
./node_modules/.bin/eslint --no-ignore --max-warnings 0 src/__tests__/burn4-tg3r5-b10/burn4-*.ts src/__tests__/burn4-tg3r5-b10/burn4-jest.config.cjs
./node_modules/.bin/tsc --project src/__tests__/burn4-tg3r5-b10/burn4-tsconfig.json --noEmit
```

The harness reads only the audit spec, transpiles its unchanged text, and appends a named helper exposure statement in an isolated VM. Every import is replaced by an explicit allowlisted fake except the pure path module. Unknown imports are rejected. The Playwright fake registers callbacks and implements skip termination, so disabled lifecycle runs stop before Page actions. An enabled run uses only the explicitly authorized private synthetic `E2E_HAS_TEST_DB='1'` control. The private environment returns absence for the two backend field checks needed by the fallback branch and rejects all other reads, mutation and enumeration. No actual environment is read, copied or passed to tested code.

Auth and reset modules are never imported or executed. Fake login receives a synthetic Page and synthetic parent label only. Fake subprocess dispatch recognizes the fixed lookup/update forms, changes only an in-memory zoom state and emits semantic events without storing or logging command/SQL text. Configured backend branches remain outside this credential-free harness. Fake filesystem writes, screenshots and logs stay in memory. Both source and storage-callback VMs disable string/wasm code generation and have one-second synchronous timeouts; the fake Page uses controlled promises instead of real timers. Only dashboard screenshots model the SSR zoom described by the source.

Strict scoped TypeScript checks the new tests and harness. The audit source is loaded as text, so it and its real imports are outside that typecheck. Focused ESLint passes with zero warnings. The custom Jest config bypasses repository setup and discovers only this package. No Playwright runtime, browser, real helper, SQL command, storage service, network, screenshot bytes or original E2E runner starts. Real browser rendering, deployment behavior and actual database/provider behavior are outside these checks.

Navigation semantics were checked against the installed primary Playwright type documentation in `playwright-core/types/types.d.ts`, under `goto`: valid HTTP errors including 404 and 500 resolve and require response status inspection. The baseline contract comes from the audit source's SSR-scale comment, its initial findings labeled100 and its later NULL default reset. Supporting inspection of the reset helper confirms it resets tasks, shopping, chore completions and modes without changing layout scale; that helper remains inert and outside this package's coverage target.
