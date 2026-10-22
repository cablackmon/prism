# Documentation metadata boundaries

These tests render unchanged `overrides/main.html` with actual installed Jinja2, a tiny inherited base and synthetic site/page values. Standard Python `HTMLParser` and `json.loads` inspect semantic output. No parser mirrors the template. Tests cover every documented page=None 404 fallback, independent page/title/description/URL precedence, inherited head content, OG/Twitter agreement, site identity in JSON-LD, image paths, Unicode and repeated-render isolation.

Prerequisites are the repository's existing Jest/TypeScript/ESLint dependencies and `/usr/bin/python3` with system-installed Jinja2. This run uses Python 3.12 and Jinja2 3.1.2. Nothing is downloaded or installed by the tests. The Python bridge uses `-I -B`, an empty child environment, no shell and a timeout. The renderer reads only the fixed repository override as template source, uses `DictLoader`, performs no asset/URL fetch, and guards network, subprocess and filesystem mutations. Rendered data stays in memory. No MkDocs/Material build, full theme, browser or external service runs.

The environment matches pinned MkDocs 1.6.1 core settings. [Theme.get_env](https://github.com/mkdocs/mkdocs/blob/1.6.1/mkdocs/theme.py#L158) calls `Environment(loader=loader, auto_reload=False)`, retaining `autoescape=False` and default `Undefined`. [Template context construction](https://github.com/mkdocs/mkdocs/blob/1.6.1/mkdocs/commands/build.py#L29) supplies `page=None` for standalone/error templates. MkDocs strict mode counts build warnings/errors; it does not enable `StrictUndefined`.

Upstream tag 1.6.1 resolves to commit `bb7e8b62185b11d9f59bb7f50b13c15134f62f8a`. Source blob SHAs are `b45f1079203e60443de699c20f742a5e97830239` for `mkdocs/theme.py` and `f111bcdc050ab0de4acf3afdf4ef80ef4bbb2f9a` for `mkdocs/commands/build.py`. Upstream source was inspected as data during planning; no upstream code is included or executed by this package.

Run from the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b12/burn4-template-fallbacks.test.ts src/__tests__/burn4-tg3r5-b12/burn4-template-roundtrip.test.ts src/__tests__/burn4-tg3r5-b12/burn4-template-gaps.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r5-b12/*.ts --max-warnings=0
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r5-b12/burn4-tsconfig.json
/usr/bin/python3 -I -B -c 'import ast,pathlib; path=pathlib.Path("src/__tests__/burn4-tg3r5-b12/burn4-render.py"); ast.parse(path.read_text(encoding="utf8"),filename=str(path))'
```

The accepted run has 38 cases: 29 ordinary passes and nine confirmed expected-failure cases, with no failures/skips. Focused lint, strict new-test/harness TypeScript and Python syntax/runtime checks pass. TypeScript does not validate Python or the Jinja template; real Python/Jinja execution supplies runtime evidence.

The nine KNOWN GAP cases represent two underlying encoding defects:

- HTML attribute values are interpolated without escaping. Quotes truncate title/description attributes, and literal entity text is decoded into a different value. Four cases pin those contexts.
- JSON-LD values lack JSON/script-safe serialization. Quotes and literal newlines produce invalid JSON, backslash sequences silently change semantic values, and an embedded closing-script delimiter truncates raw script data. Five cases pin those outcomes.

JSON parsing errors are captured as data before explicit desired-behavior assertions. To run all nine assertions directly without expected-failure inversion:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r5-b12/burn4-template-gaps.test.ts --globals '{"burn4DirectGap":true}'
```

That probe must exit 1 with exactly nine equality or parse-error-null assertion failures. Runtime/setup errors do not establish the documented gap proof. Source fixes are outside this new-files-only package. Needs-decision: none.
