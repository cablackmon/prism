# Offline UI audit board coverage

These tests execute `scripts/ui-audit-board.mjs` without changing the source. TypeScript transpiles its imports to CommonJS, then a VM runs it with an allowlisted filesystem and pure POSIX path functions. The harness reads only the renderer source from disk. The renderer sees an in-memory report, synthetic byte buffers, captured output, a fake console and a fake process exit. It has no real process configuration, filesystem, network or image decoder.

Coverage includes missing reports, empty reports, clean-only reports, ordered flagged cards, all totals, nested screenshot embedding, missing image fallback, escaping of text and image attributes, optional overflow probes, multiple overflow entries, malformed fields, read failures and write failures. Every fixture is synthetic.

Run only these files from the repository root:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q06/burn4-board-renderer.test.ts src/__tests__/burn4-tg3r2-q06/burn4-board-gaps.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r2-q06/burn4-board-harness.ts src/__tests__/burn4-tg3r2-q06/burn4-board-renderer.test.ts src/__tests__/burn4-tg3r2-q06/burn4-board-gaps.test.ts --max-warnings 0
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r2-q06/burn4-tsconfig.json
```

Validation: 37 passing tests comprising 25 ordinary behavior tests and 12 confirmed expected-failure tests. No skipped tests. Focused lint and strict scoped TypeScript pass. TypeScript checks the new tests and harness only. The unchanged JavaScript renderer runs in the VM but is not covered by the scoped type check.

## KNOWN GAP list

- Numeric report interpolation inserts unescaped HTML. Nine cases cover width, height, scale, all four totals, overflow size and element width. A script element supplied in one of these fields appears unchanged in the published HTML.
- Severity interpolation inserts unescaped HTML into the card class, badge and label. A malformed severity can break the attribute boundary and insert a script element.
- Screenshot paths escape the artifact directory. Parent traversal and a sibling directory path both cause an outside file to be read and embedded in the board. Tests use synthetic memory buffers only.

The expected-failure tests use `test.failing` to preserve the desired safety assertions while production stays unchanged. A disposable inversion probe replaced only `test.failing` with `test`: all 12 cases failed on the intended markup or outside-file-read assertion, with no runtime suite errors.

## Needs-decision list

None. Fixing the recorded defects would require a separate production change.

## Limits

These tests inspect generated HTML strings and embedded synthetic bytes. They do not launch a browser, execute the generated HTML, decode an image or run the UI audit sweep. A malformed report currently raises the renderer's existing parse or type error before output is written; the ordinary tests record that failure boundary without requiring a new validation policy.
