# Manual display-auth source audit

This adds the advisory guardrail proposed in `docs/planning.md` and `docs/arch-review-v4.md` H4/A5. A contributor can inspect whether an exported mutation handler reaches `getDisplayAuth` through the supported local call graph. The command reads source as data, without importing or executing routes. It uses the existing TypeScript dependency and changes no application behavior, package script, ESLint configuration or CI policy.

```sh
node scripts/burn4-display-auth-audit.mjs --root /path/to/checkout
node scripts/burn4-display-auth-audit.mjs --root /path/to/checkout --check --json src/app/api/example/route.ts
node scripts/burn4-display-auth-audit.mjs --root /path/to/checkout --check --exceptions audit-exceptions.json
```

`--root` is mandatory. With no file arguments, discovery is limited to `src/app/api/**/route.{ts,tsx,js,jsx}` under that root, skipping `.git` and `node_modules` at every depth. Explicit inputs are root-relative TypeScript or JavaScript files and are sorted and deduplicated. Symlink files and ancestors, outside paths and nonregular source inputs are refused. Paths are literal and canonical, with no glob expansion, backslashes, colon or dot segments. Literal Next route segments such as `[id]`, `[...slug]` and `[[...slug]]` are accepted. The limit is 5000 selected files and 512 KiB per source or exception manifest. Empty selection is an input error. This is a local contributor tool for a stable filesystem, not a sandbox against concurrent filesystem replacement.

The source-only TypeScript host supplies the single input file. It disables library and import resolution and never reads imported application modules or application environment values. Named imports from `@/lib/auth` and `@/lib/auth/requireAuth`, their `.ts`/`.js`/`index` spellings, and relative paths resolving lexically to those modules retain lexical symbol identity. Namespace imports, literal member access, import-equals namespaces and unshadowed literal CommonJS require namespaces are supported. An imported function named `getDisplayAuth` from an unknown module is conservatively incomplete when reached.

Supported edges include immutable const alias chains, function declarations, arrows, function expressions, direct calls, IIFEs, invoked nested helpers, recursive helper cycles and exported handler aliases. Roots are POST, PUT, PATCH and DELETE. Each finding gives the original source call location, root method and one deterministic representative helper path. GET/HEAD/OPTIONS-only and dead helper bodies are excluded. Conditions are not evaluated; both branches and reached parameter default initializers are conservatively inspected, including defaults that a supplied argument might bypass.

Auth-carrying forms outside this model produce incomplete diagnostics. These include mutable or destructured callable aliases, object/array storage, parameter or binding defaults that carry callables, callback or returned callable escapes, unknown computed access, `.bind`/`.call`/`.apply`, class invocation, dynamic imports, unknown wrappers and reexported/CommonJS handler roots. A modeled local call returning an auth result is consumed normally. A helper returning an auth callable remains incomplete. The audit does not prove that a finding lacks another authorization check, inspect external helper bodies, evaluate top-level execution or validate application types. A clean report applies only to this bounded local model.

Exit status is 0 for a complete advisory scan, or a complete check with no unexcepted findings; 1 for unexcepted findings under `--check`; and 2 for input, parse or incomplete-analysis diagnostics in either mode. JSON retains analyzed files, all findings, exceptions, diagnostics and limitations. Text has the same locations and exception reasons. Parser and malformed JSON errors omit source snippets.

An exception file is an array of exact file/method/reason objects. For example, the existing documented barcode scan flow intentionally permits display-session writes (`docs/features/global-input-system.md`, section 5.2):

```json
[
  {
    "file": "src/app/api/shopping/scan/route.ts",
    "method": "POST",
    "reason": "Documented display-session barcode scan workflow"
  }
]
```

No exemption is built in. A reason records a review decision and does not prove a route safe. Reasons must be nonblank; unknown fields/methods, duplicate identities, wildcards and stale entries are errors. Matching is against raw findings in the selected files before suppression. An exception retains each finding with its trimmed reason, waives only its exact method, and cannot waive incompleteness. Exceptions outside an explicit file selection are stale.

The four exports are `analyzeSource(file, text)`, `applyExceptions(rawFindings, manifest)`, `auditFiles(root, selectedFiles, manifest)` and `runCli(args)`. `analyzeSource` returns findings and diagnostics. The file API requires an explicit nonempty root and throws for invalid inputs. `runCli` returns an exit code and text/JSON output; only direct entrypoint execution writes stdout and sets the process exit code. Importing the module performs no discovery.

All package checks use disposable synthetic route trees. API child drivers import only the new script, receive source fixtures over stdin, and use an empty child environment with a synthetic cwd. Entry tests supply the synthetic root explicitly. No existing route is scanned, imported, executed or used as a coverage target. No browser, database, service, network, credential fixture or real environment value is used.

Run from the repository root with Node 24 and existing repository dependencies:

```sh
node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r5-b09/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b09/burn4-analyzer.test.ts src/__tests__/burn4-tg3r5-b09/burn4-exceptions.test.ts src/__tests__/burn4-tg3r5-b09/burn4-files-cli.test.ts
node node_modules/eslint/bin/eslint.js scripts/burn4-display-auth-audit.mjs src/__tests__/burn4-tg3r5-b09/*.ts src/__tests__/burn4-tg3r5-b09/*.mjs src/__tests__/burn4-tg3r5-b09/burn4-jest.config.cjs --no-ignore --max-warnings 0
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r5-b09/burn4-tsconfig.json
```

Strict TypeScript includes JSDoc/checkJs for the new runtime script and fixture driver, plus strict test/harness types. It does not typecheck any existing application source. The final run passes 133 ordinary cases with zero failures or skips; no expected-failure cases are needed for this new implementation. KNOWN GAP list: none. Needs-decision list: none.
