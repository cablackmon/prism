# Hostname scanner contract coverage

This package runs the unchanged `scripts/scan-hostnames.sh` only inside disposable local git fixture repositories. Each fixture contains synthetic text and a local index. No commits, remotes, network or real repository data are needed. Every child receives `env: {}` and starts through the fixed absolute `/usr/bin/git` or `/bin/bash` executable. The fixture is removed in a `finally` block.

Coverage includes tracked and untracked inputs, current working content versus staged content, source extensions, exact root path exclusions and nested boundary controls. Comment markers, TLD filtering, hostname extraction, allowlist equality and subdomain boundaries, hostname spelling, per-line counts, multiple files, paths containing spaces and missing tracked files have explicit assertions.

Run from the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q11/burn4-hostnames.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r2-q11/burn4-hostnames-fixture.ts src/__tests__/burn4-tg3r2-q11/burn4-hostnames.test.ts --max-warnings 0
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r2-q11/burn4-tsconfig.json
```

The strict TypeScript check covers only the tests and fixture harness. It does not type-check the shell source. The tests require the Unix command-line tools used by the unchanged scanner, including git, grep, xargs with `-d`, awk, wc and sed. Some awk implementations emit a specific escaped-dot warning when reading the scanner's escaped allowlist argument. Output assertions permit empty stderr or that exact warning; unrelated diagnostics remain failures.

Known gap: hostname allowlisting is case-sensitive. Both `EXAMPLE.COM` and `DOCS.EXAMPLE.COM` are rejected while their lowercase equivalents are allowed. Two expected-failure tests cover equality and subdomain matching for this one defect. Disposable inverse probes confirm each failure occurs at the intended clean-exit assertion. Separate observation probes verify the actual hostname violation diagnostics.

Scope: the scanner deliberately checks comment markers only at the start of a line after whitespace and uses a narrow public TLD list. Inline trailing comments, block opening delimiters and unsupported final labels are tested as current documented scope, without being labeled defects. Missing tracked files are ignored by the scanner; the tests record that behavior without claiming content was examined.

Needs decision: none. Production source is unchanged.
