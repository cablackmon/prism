# Offline ICU catalog audit

`scripts/burn4-icu-catalog-audit.mjs` checks translator-edited JSON without starting Prism. It follows the contribution contract in `docs/features/LANGUAGES.md`: keys retain their identity, missing translations fall back to English, and partial catalogs remain usable.

The command accepts an explicit source file and one or more translation files:

```sh
node scripts/burn4-icu-catalog-audit.mjs --source /path/to/en.json /path/to/de.json --json
node scripts/burn4-icu-catalog-audit.mjs --source /path/to/en.json /path/to/de.json --require-complete
```

Use `--` before translation filenames beginning with a dash. `--help` describes the command. Exit status is 0 for a valid audit, 1 for catalog validation/read errors, and 2 for usage or unexpected execution errors. Missing keys are informational by default and become errors with `--require-complete`. Orphan keys produce warnings. Human output is the default; `--json` emits one machine-readable report, including usage errors.

The tool catches duplicate raw JSON keys, including Unicode-escaped duplicates that JSON.parse would silently overwrite. It rejects non-object roots, non-string message leaves, empty messages, an empty source, invalid ICU and namespace/message collisions. ICU traversal checks every nested plural/select branch and rich-text tag. A translation cannot remove a supplied argument, require an unknown argument/tag, or introduce number/date formatting absent from the source contract. Diagnostics include the file, message path, defect code and, for argument/tag errors, the name in `subject`. Duplicate keys also include a one-based line and column. Message paths use JSON Pointer escaping, so literal dots, slashes and tildes retain distinct identities. Diagnostic messages do not include catalog value text or exception contents.

Date and time formats share a date contract, and numeric formats/cardinal/ordinal plurals share a number contract. Select dispatch adds no narrower input requirement and works with existing numbers, dates or plain scalar values. A source can intentionally use both number and date formatting on a timestamp; its translations may retain either formatting contract. A translation can use a typed source argument as a plain value, which permits locales that do not need plural formatting. It can change plural categories, exact selectors, offsets and branch ordering. Number/date mismatch errors mean the translation introduces a formatting interpretation absent from the source, even though some runtime inputs could be coercible. The audit does not prove translated meaning, require identical branch text, validate locale-specific plural categories, simulate fallback rendering, or run application helpers. It uses the installed FormatJS ICU parser's syntax and skeleton handling; it does not render all messages against invented argument values. `translatedMessages` counts present, successfully parsed source/translation message pairs even when a compatibility error exists. `fallbacks` counts missing source message keys across readable translation objects; invalid files are reported independently rather than guessed as full fallback coverage.

Runtime prerequisites are Node.js 24 and the repository dependencies installed from the root lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund
```

No dependency or existing configuration changes are needed. TypeScript supplies the raw JSON AST, and the existing next-intl dependency supplies `@formatjs/icu-messageformat-parser` transitively. The run used Node 24.18.0, TypeScript 5.9.3 and FormatJS ICU parser 3.5.17. If dependency layout changes, promote the parser to a direct dependency before adopting this as a release gate. This draft does not change CI.

Run only the four owned test files, serially:

```sh
node --test --test-concurrency=1 src/__tests__/burn4-tg3r6-b08/burn4-catalog-json.test.mjs src/__tests__/burn4-tg3r6-b08/burn4-catalog-icu.test.mjs src/__tests__/burn4-tg3r6-b08/burn4-catalog-compatibility.test.mjs src/__tests__/burn4-tg3r6-b08/burn4-catalog-cli.test.mjs
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r6-b08/burn4-tsconfig.json
node node_modules/eslint/bin/eslint.js --max-warnings=0 scripts/burn4-icu-catalog-audit.mjs src/__tests__/burn4-tg3r6-b08/burn4-*.mjs
```

Verified result: 87 ordinary tests pass, zero failures, zero skipped tests, and zero KNOWN GAP expected failures. All test catalogs are synthetic. Filesystem cases use disposable `/tmp/burn4-b08-*` directories and remove them in finally blocks. Spawned Node CLI fixtures receive an empty environment. Tests exercise strict JSON, ICU error branches, recursive argument/type/tag compatibility, fallback policy, deterministic reporting, aggregation after file errors, import isolation and CLI status/output paths. They never read existing application catalogs, import claimed app helpers, start services or contact providers. Typecheck uses strict checkJs on the actual tool, tests and helper, with no emit or incremental artifacts. Lint covers the same JavaScript files with zero warnings required.

KNOWN GAP list: none. This is new tooling with ordinary passing behavior assertions, not expected failures for an established application defect.

Needs-decision list: none for this draft. A maintainer can decide later whether to add a CI gate and direct dependency declaration.
