# Offline triage and release workflow behavior

This package executes the five unchanged Bash blocks in `.github/workflows/needs-reply.yml` and `.github/workflows/release.yml`. The source is extracted at runtime; no workflow source is copied or modified.

The 54 ordinary cases cover event actor and target fallback, owner and bot classification, both source label conditions, exact inert label command arguments, missing targets, command failure suppression, tag/version prefix behavior, extraction-to-config-gate integration, both architectures, supported quoting and whitespace, missing config and version mismatches. Two named expected-failure cases pin one release version parsing defect: a matching valid YAML config is rejected when it uses CRLF line endings or an indented root mapping. An independent existing YAML parser confirms both input documents contain the expected version. Removing `.failing` from those two cases causes both to fail at `expect(result.status).toBe(0)`, with actual status one.

Every Bash child receives an explicit environment containing only synthetic ordinary controls and fixture paths. No inherited environment is read or copied. The only PATH commands are an inert `gh` recorder and local `grep`, `head`, `awk` and `tr`. The recorder writes argv into its fixture and returns a configured exit code; it never contacts GitHub. Temporary files and directories are removed after each case. No hosted workflow, action, Docker build, registry operation, service or database starts.

The context helper accepts only the ordinary paths used by these scripts and rejects nonprimitive values and shell syntax before rendering. It evaluates the source label conditions with a restricted fixture implementation of `||`, `&&`, `==` and `!=`. This checks the source policy for the tested metadata. It does not validate the complete hosted Actions expression engine, event triggers, permissions or third-party action behavior. Failed `gh` calls remain successful steps because the source explicitly uses `|| true`; the tests record this policy without calling it a defect. The release gate does not validate semantic version syntax, and the tests record that limit too.

Run from the repository root with Node >=24, Bash and the repository dependencies installed. `js-yaml` comes from the existing Jest/ESLint dependency tree; no new dependency is added. The custom config keeps test setup local to this package.

```sh
./node_modules/.bin/jest --config src/__tests__/burn4-tg3r5-b04/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b04/burn4-triage.test.ts src/__tests__/burn4-tg3r5-b04/burn4-release.test.ts src/__tests__/burn4-tg3r5-b04/burn4-release-gaps.test.ts
./node_modules/.bin/eslint src/__tests__/burn4-tg3r5-b04/*.ts src/__tests__/burn4-tg3r5-b04/burn4-jest.config.cjs --no-ignore --max-warnings 0
./node_modules/.bin/tsc -p src/__tests__/burn4-tg3r5-b04/burn4-tsconfig.json
```

Strict TypeScript covers the new tests and harness. It does not typecheck YAML or Bash. Only explicit package test paths are run; the repository suite and original workflows are never run.

KNOWN GAP list:

- The release version parser rejects matching valid YAML with CRLF line endings or an indented root mapping. Two confirmed expected-failure cases cover this defect.

Needs-decision list: none.
