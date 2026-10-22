# Offline recipe print HTML

`scripts/burn4-recipe-print.mjs` turns one local structured recipe JSON file into
a complete printable HTML document on stdout. It implements an offline print
artifact from the recipe print work listed in `docs/planning.md` and
`docs/features/RECIPES.md`. Application print buttons and hosted share links
remain separate work. Existing application and documentation files are unchanged.

## Use

Node 24 is required, matching the repository. The tool uses built-in modules only.

```sh
node scripts/burn4-recipe-print.mjs --help
node scripts/burn4-recipe-print.mjs recipe.json > recipe.html
```

The shell redirects stdout in this example. The tool itself never writes a file.
It reads only the named input file and never connects to a service, reads
environment values, runs a browser, or loads application data.

Example input:

```json
{
  "name": "Synthetic oat bowl",
  "ingredients": [
    { "heading": "Bowl" },
    { "text": "1/2 cup oats" },
    { "text": "1 cup water" }
  ],
  "instructions": "Combine ingredients.\nCook gently.\nServe.",
  "prepTime": 5,
  "cookTime": 10,
  "servings": 2,
  "notes": "Stir before serving.",
  "url": "https://recipes.example.test/oats"
}
```

Name and an ingredients array are required. The array may be empty. Each entry
must contain exactly one nonempty `text` or `heading` string. Other ingredient
shapes or extra ingredient fields are rejected so content is not silently lost.
Optional fields are description, instructions, prepTime, cookTime, servings,
cuisine, category, tags, notes and url. Omitted, null and blank optional text
fields are omitted from output. Tags are an array of nonempty strings, or null.
Unknown top-level application metadata is ignored and never printed.

Times must be nonnegative safe integers in minutes. Servings must be a positive
safe integer. Quantities and servings are printed as supplied, without scaling.
Nonempty instruction lines become ordered steps; blank separator lines are
omitted. Whitespace within each line is preserved. HTML parsing normalizes
carriage returns to line feeds. Text, including Unicode, is escaped rather than
interpreted as markup.

Limits: input 1 MiB of UTF-8; name/cuisine/category 512 UTF-16 code units;
description/instructions/notes 65,536; each ingredient 4,096; source URL 4,096;
500 ingredients; 1,000 nonempty instruction lines; 64 tags of 128 code units.
Unsupported control characters and malformed Unicode are rejected. A UTF-8 BOM
is accepted. Input must be a regular file, including when it changes during the
bounded read; stdin and special files are unsupported.

Source URLs must be absolute http or https, with no whitespace, backslashes or
user information. URL parsing canonicalizes the hyperlink; its original escaped
text stays visible for printing. Only an explicit click follows that link. The
document has inline CSS and a restrictive content policy, with no scripts,
images, external styles, fonts, forms or automatic printing/resource requests.
Image and household/sync metadata are deliberately outside the print contract.

Help exits 0. Argument errors exit 2. Read, UTF-8, JSON, validation and output
failures exit 1 with concise stderr diagnostics. Validation completes before
stdout receives HTML; a broken output sink can already have received some bytes.
Importing the module is silent. Its sole export `renderRecipeHtml(unknown)`
validates the same structured input and returns deterministic HTML or throws a
field-specific error.

## Verify

Tests use Node's native runner and the existing locked root development copy of
JSDOM, with script execution and resource loading disabled. No new dependency or
root configuration is added. If root development dependencies are absent, first
install them with lifecycle scripts disabled:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 --test-reporter=tap src/__tests__/burn4-tg3r6-c01/burn4-render.test.mjs src/__tests__/burn4-tg3r6-c01/burn4-safety.test.mjs src/__tests__/burn4-tg3r6-c01/burn4-cli.test.mjs
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r6-c01/burn4-tsconfig.json
node node_modules/eslint/bin/eslint.js scripts/burn4-recipe-print.mjs src/__tests__/burn4-tg3r6-c01/burn4-dom.mjs src/__tests__/burn4-tg3r6-c01/burn4-render.test.mjs src/__tests__/burn4-tg3r6-c01/burn4-safety.test.mjs src/__tests__/burn4-tg3r6-c01/burn4-cli.test.mjs --max-warnings 0
```

The `.test.mjs` files are outside default root Jest discovery. Scoped strict
checkJs covers the actual source and tests with indexed-access, isolated-module
and casing checks. Tests cover DOM content, exact ingredient/instruction order,
field errors and bounds, hostile markup/URL handling, import safety, deterministic
output, read/JSON/UTF-8 failures, file preservation and a closed stdout pipe.
Child CLIs receive an explicit empty environment and synthetic temporary inputs.

For manual preview, open a generated HTML file locally and use the browser's
Print command. Check page breaks, ingredient headings, long notes and margins
on the intended paper size. Automated checks inspect the DOM and parsed CSS;
actual browser pagination, PDF and paper rendering were not exercised.

Validation: 98 ordinary passing cases, zero failures, skips or expected gaps.
Strict scoped checkJs and focused lint pass. Default root Jest discovery
restricted to the three own test paths returns an empty list.

KNOWN GAP: none confirmed. Needs-decision: none.
