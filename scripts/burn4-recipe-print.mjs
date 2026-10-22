import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ITEMS = 500;
const MAX_STEPS = 1000;
const MAX_TAGS = 64;

/** @typedef {{text: string} | {heading: string}} Ingredient */
/**
 * @typedef {Object} Recipe
 * @property {string} name
 * @property {Ingredient[]} ingredients
 * @property {string[]} steps
 * @property {string[]} tags
 * @property {string | undefined} description
 * @property {string | undefined} cuisine
 * @property {string | undefined} category
 * @property {string | undefined} notes
 * @property {string | undefined} sourceText
 * @property {string | undefined} sourceHref
 * @property {number | undefined} prepTime
 * @property {number | undefined} cookTime
 * @property {number | undefined} servings
 */

/** @param {unknown} value @param {string} field @returns {Record<string, unknown>} */
function record(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field}: expected an object.`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} field @param {number} limit @returns {string | undefined} */
function optionalText(value, field, limit) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${field}: expected a string or null.`);
  if (value.length > limit) throw new Error(`${field}: exceeds ${limit} UTF-16 code units.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || !value.isWellFormed()) {
    throw new Error(`${field}: contains unsupported control characters or invalid Unicode.`);
  }
  return value.trim() ? value : undefined;
}

/** @param {unknown} value @param {string} field @param {number} minimum @returns {number | undefined} */
function optionalInteger(value, field, minimum) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${field}: expected a safe integer of at least ${minimum}.`);
  }
  return value;
}

/** @param {unknown} input @returns {Recipe} */
function validate(input) {
  const data = record(input, 'recipe');
  const name = optionalText(data.name, 'name', 512);
  if (name === undefined) throw new Error('name: expected a nonempty string.');
  if (!Array.isArray(data.ingredients)) throw new Error('ingredients: expected an array.');
  if (data.ingredients.length > MAX_ITEMS) throw new Error(`ingredients: exceeds ${MAX_ITEMS} entries.`);
  const ingredients = Array.from(data.ingredients, (value, index) => {
    const field = `ingredients[${index}]`;
    const entry = record(value, field);
    const keys = Object.keys(entry);
    const key = keys[0];
    if (keys.length !== 1 || (key !== 'text' && key !== 'heading')) {
      throw new Error(`${field}: expected exactly one text or heading field.`);
    }
    const text = optionalText(entry[key], `${field}.${key}`, 4096);
    if (text === undefined) throw new Error(`${field}.${key}: expected a nonempty string.`);
    return key === 'text' ? { text } : { heading: text };
  });
  const instructions = optionalText(data.instructions, 'instructions', 65536);
  const steps = instructions?.split(/\r\n|\r|\n/u).filter(line => line.trim()) ?? [];
  if (steps.length > MAX_STEPS) throw new Error(`instructions: exceeds ${MAX_STEPS} nonempty lines.`);
  const rawTags = data.tags ?? [];
  if (!Array.isArray(rawTags)) throw new Error('tags: expected an array or null.');
  if (rawTags.length > MAX_TAGS) throw new Error(`tags: exceeds ${MAX_TAGS} entries.`);
  const tags = Array.from(rawTags, (value, index) => {
    const text = optionalText(value, `tags[${index}]`, 128);
    if (text === undefined) throw new Error(`tags[${index}]: expected a nonempty string.`);
    return text;
  });
  const sourceText = optionalText(data.url, 'url', 4096);
  let sourceHref;
  if (sourceText !== undefined) {
    if (!/^https?:\/\//iu.test(sourceText) || /[\s\\]/u.test(sourceText)) {
      throw new Error('url: expected an absolute http or https URL without whitespace or backslashes.');
    }
    let parsed;
    try { parsed = new URL(sourceText); } catch { throw new Error('url: expected a valid http or https URL.'); }
    if (!parsed.hostname || parsed.username || parsed.password
      || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      throw new Error('url: expected an http or https URL without user information.');
    }
    sourceHref = parsed.href;
  }
  return {
    name, ingredients, steps, tags, sourceText, sourceHref,
    description: optionalText(data.description, 'description', 65536),
    cuisine: optionalText(data.cuisine, 'cuisine', 512),
    category: optionalText(data.category, 'category', 512),
    notes: optionalText(data.notes, 'notes', 65536),
    prepTime: optionalInteger(data.prepTime, 'prepTime', 0),
    cookTime: optionalInteger(data.cookTime, 'cookTime', 0),
    servings: optionalInteger(data.servings, 'servings', 1),
  };
}

/** @param {string} value @returns {string} */
function escapeHtml(value) {
  const entities = /** @type {Record<string, string>} */ ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  });
  return value.replace(/[&<>"']/gu, character => entities[character] ?? character);
}

/**
 * Render one documented structured recipe as standalone printable HTML.
 * Unknown application metadata is deliberately excluded. Input is validated
 * before rendering; ingredients and instructions are never interpreted as HTML.
 * @param {unknown} input
 * @returns {string}
 */
export function renderRecipeHtml(input) {
  const recipe = validate(input);
  const details = [
    ['Preparation', recipe.prepTime === undefined ? undefined : `${recipe.prepTime} minutes`],
    ['Cooking', recipe.cookTime === undefined ? undefined : `${recipe.cookTime} minutes`],
    ['Servings', recipe.servings === undefined ? undefined : String(recipe.servings)],
    ['Cuisine', recipe.cuisine], ['Category', recipe.category],
  ].filter((entry) => entry[1] !== undefined).map(([label, value]) =>
    `<div><dt>${escapeHtml(label ?? '')}</dt><dd>${escapeHtml(value ?? '')}</dd></div>`).join('');
  const ingredients = recipe.ingredients.map(entry => 'heading' in entry
    ? `<li class="ingredient-heading"><h3>${escapeHtml(entry.heading)}</h3></li>`
    : `<li>${escapeHtml(entry.text)}</li>`).join('\n');
  const steps = recipe.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(recipe.name)}</title>
<style>
:root { color-scheme: light; font-family: Georgia, serif; color: #111; background: #fff; }
body { margin: 0; padding: 2rem; line-height: 1.5; }
main { max-width: 56rem; margin: 0 auto; }
h1 { line-height: 1.15; overflow-wrap: anywhere; }
h2, h3 { break-after: avoid; page-break-after: avoid; }
h2 { margin-top: 1.5rem; border-bottom: 1px solid #bbb; padding-bottom: .25rem; }
h3 { margin: .8rem 0 .25rem; font-size: 1.05rem; }
p, li, dd { white-space: pre-wrap; overflow-wrap: anywhere; }
dl { display: flex; flex-wrap: wrap; gap: .5rem 2rem; }
dl div { break-inside: avoid; }
dt { font-weight: bold; } dd { margin: 0; }
li { margin-bottom: .4rem; break-inside: avoid; page-break-inside: avoid; }
.ingredient-heading { list-style: none; margin-left: -1.2rem; break-after: avoid; }
.tags { font-family: system-ui, sans-serif; }
a { color: inherit; overflow-wrap: anywhere; }
@page { margin: 18mm; }
@media print {
  body { padding: 0; font-size: 11pt; background: #fff; color: #000; }
  main { max-width: none; }
  h1 { font-size: 22pt; }
  a { text-decoration: none; }
  p { orphans: 3; widows: 3; }
}
</style>
</head>
<body><main>
<header><h1>${escapeHtml(recipe.name)}</h1>
${recipe.description === undefined ? '' : `<p>${escapeHtml(recipe.description)}</p>`}
${details ? `<dl>${details}</dl>` : ''}
${recipe.tags.length ? `<p class="tags">Tags: ${recipe.tags.map(escapeHtml).join(', ')}</p>` : ''}
</header>
${ingredients ? `<section id="ingredients" aria-labelledby="ingredients-title"><h2 id="ingredients-title">Ingredients</h2><ul>${ingredients}</ul></section>` : ''}
${steps ? `<section id="instructions" aria-labelledby="instructions-title"><h2 id="instructions-title">Instructions</h2><ol>${steps}</ol></section>` : ''}
${recipe.notes === undefined ? '' : `<section id="notes" aria-labelledby="notes-title"><h2 id="notes-title">Notes</h2><p>${escapeHtml(recipe.notes)}</p></section>`}
${recipe.sourceHref === undefined ? '' : `<footer><h2>Original recipe</h2><p><a href="${escapeHtml(recipe.sourceHref)}" rel="noreferrer noopener">${escapeHtml(recipe.sourceText ?? '')}</a></p></footer>`}
</main></body>
</html>
`;
}

/** @param {string} path @returns {unknown} */
function readRecipe(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error('Input must be a regular JSON file.');
    if (stat.size > MAX_FILE_BYTES) throw new Error('Input exceeds the 1 MiB file limit.');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_FILE_BYTES) throw new Error('Input exceeds the 1 MiB file limit.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)); }
    catch { throw new Error('Input must contain valid UTF-8.'); }
    try { return JSON.parse(text); } catch { throw new Error('Input is not valid JSON.'); }
  } finally {
    closeSync(descriptor);
  }
}

const usage = 'Usage: node scripts/burn4-recipe-print.mjs <recipe.json>\nPrints standalone recipe HTML to stdout. No files are written.\n';

/** @param {string[]} args @returns {void} */
function main(args) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(usage);
    return;
  }
  const inputPath = args[0];
  if (args.length !== 1 || inputPath === undefined || inputPath.startsWith('-')) {
    process.stderr.write(usage);
    process.exitCode = 2;
    return;
  }
  try {
    const html = renderRecipeHtml(readRecipe(inputPath));
    process.stdout.write(html);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown input error.';
    // Native read errors include paths. Report only their safe error code.
    const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
    process.stderr.write(`Recipe print: ${typeof code === 'string' ? `Cannot read input file (${code}).` : message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stderr.on('error', () => { process.exitCode = 1; });
  process.stdout.on('error', () => {
    process.exitCode = 1;
    process.stderr.write('Recipe print: Cannot write output.\n');
  });
  main(process.argv.slice(2));
}
