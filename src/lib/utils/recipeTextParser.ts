/**
 * Parse raw OCR'd / pasted text into a best-guess recipe shape.
 *
 * Input is whatever the user pastes — typically iOS Live Text from a photo of
 * a recipe card or cookbook page. Output pre-fills the recipe form so the
 * user can correct any mis-classifications before saving.
 *
 * Strategy:
 *   1. First non-blank line that isn't a metadata line → title.
 *   2. Scan every line for prep/cook/total time and servings keywords; pull
 *      those out separately so they don't pollute the ingredient/instruction
 *      buckets.
 *   3. If we find an "Ingredients" / "Instructions" / "Method" header, split
 *      strictly by sections.
 *   4. Otherwise, classify each remaining line: ingredient if it leads with
 *      a number, fraction, or measurement word; instruction otherwise.
 */

export interface ParsedRecipeText {
  name: string;
  ingredients: Array<{ text?: string; heading?: string }>;
  instructions: string;
  prepTime?: number;
  cookTime?: number;
  servings?: number;
}

/**
 * Match section headers used inside ingredient blocks ("Fries:",
 * "For the Sauce", "Meatballs"). Heuristics:
 *   - Short line (≤ 50 chars)
 *   - No leading digit/fraction (so it's not an ingredient)
 *   - Either ends with ":" or starts with "For the"/"For"
 */
function isIngredientHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 50) return false;
  if (/^(\d|[¼½¾⅓⅔⅛⅜⅝⅞])/.test(trimmed)) return false;
  if (/:\s*$/.test(trimmed)) return true;
  if (/^for the\b/i.test(trimmed)) return true;
  if (/^for\s+\S/i.test(trimmed) && trimmed.split(/\s+/).length <= 4) return true;
  return false;
}

function normalizeHeading(line: string): string {
  return line
    .trim()
    .replace(/[:.]+\s*$/, '')
    .replace(/^for the\s+/i, '')
    .trim();
}

// Common measurement words used to detect ingredient lines. Lowercased,
// matched as whole tokens.
const MEASUREMENT_WORDS = new Set([
  'cup',
  'cups',
  'c',
  'tbsp',
  'tbsps',
  'tablespoon',
  'tablespoons',
  't',
  'tb',
  'tsp',
  'tsps',
  'teaspoon',
  'teaspoons',
  'oz',
  'ounce',
  'ounces',
  'lb',
  'lbs',
  'pound',
  'pounds',
  'g',
  'gram',
  'grams',
  'kg',
  'kilogram',
  'kilograms',
  'ml',
  'milliliter',
  'milliliters',
  'l',
  'liter',
  'liters',
  'pinch',
  'pinches',
  'dash',
  'dashes',
  'clove',
  'cloves',
  'can',
  'cans',
  'jar',
  'jars',
  'package',
  'packages',
  'pkg',
  'slice',
  'slices',
  'piece',
  'pieces',
  'stick',
  'sticks',
  'qt',
  'quart',
  'quarts',
  'pt',
  'pint',
  'pints',
  'gal',
  'gallon',
  'gallons',
]);

// Words that stay lowercase in title-case, EXCEPT at the start or end of the
// title. Standard AP/Chicago style minus the conjunctions you wouldn't
// commonly find in a recipe name.
const TITLE_CASE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'into',
  'nor',
  'of',
  'on',
  'or',
  'over',
  'per',
  'the',
  'to',
  'up',
  'via',
  'vs',
  'with',
]);

function titleCase(text: string): string {
  const words = text.trim().split(/\s+/);
  return words
    .map((word, idx) => {
      const lower = word.toLowerCase();
      const isFirst = idx === 0;
      const isLast = idx === words.length - 1;
      // After a colon or em-dash, also capitalize regardless of stop-word status.
      const prevWord = idx > 0 ? words[idx - 1]! : '';
      const startsClause = /[:—–-]$/.test(prevWord);
      if (!isFirst && !isLast && !startsClause && TITLE_CASE_STOP_WORDS.has(lower)) {
        return lower;
      }
      // Preserve interior caps like "BBQ" or "PB&J" — only flip the first
      // letter when the input is all lowercase.
      if (word !== lower) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

const SECTION_HEADERS = {
  ingredients: /^(ingredients?|what you('|')?ll need)\s*:?\s*$/i,
  instructions:
    /^(instructions?|directions?|method|steps?|preparation|how to make|to make)\s*:?\s*$/i,
  notes: /^(notes?|tips?)\s*:?\s*$/i,
};

// "prep: 20 min", "prep time 1 hour 30 min", etc. The trailing portion is
// captured loosely and then re-parsed by `extractMinutes`.
const TIME_PATTERNS = [
  { key: 'prep' as const, re: /^prep(?:\s*time)?\s*[:\-]?\s*(.+)$/i },
  { key: 'cook' as const, re: /^cook(?:ing)?(?:\s*time)?\s*[:\-]?\s*(.+)$/i },
  { key: 'bake' as const, re: /^bak(?:e|ing)(?:\s*time)?\s*[:\-]?\s*(.+)$/i },
  { key: 'total' as const, re: /^total(?:\s*time)?\s*[:\-]?\s*(.+)$/i },
];

const SERVINGS_PATTERNS = [
  /^(?:serves|servings?|yield|makes)\s*[:\-]?\s*(?:about\s+)?(\d+)/i,
  /^(\d+)\s+servings?\b/i,
];

// Bullets / numbering to strip from the start of a line before assignment.
const LEADING_BULLET = /^\s*(?:[•·▪●○*\-–—]|\d+[.)]|\(\d+\)|[a-z][.)])\s+/i;

function extractMinutes(value: string): number | undefined {
  // Strip everything after a comma or "+" so "30 min, plus chilling" → "30 min".
  const trimmed = value.split(/[,+]/)[0]!.trim();
  let total = 0;
  let matched = false;

  const hourMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:h(?:rs?|ours?)?|hours?|hr)\b/i);
  if (hourMatch) {
    total += Math.round(parseFloat(hourMatch[1]!) * 60);
    matched = true;
  }

  const minMatch = trimmed.match(/(\d+)\s*(?:m(?:ins?|inutes?)?|mins?|minutes?)\b/i);
  if (minMatch) {
    total += parseInt(minMatch[1]!, 10);
    matched = true;
  }

  // Bare number with no unit and no hour match → assume minutes.
  if (!matched) {
    const bare = trimmed.match(/^(\d+)\b/);
    if (bare) {
      total = parseInt(bare[1]!, 10);
      matched = true;
    }
  }

  return matched && total > 0 ? total : undefined;
}

function isIngredientLine(line: string): boolean {
  const trimmed = line.replace(LEADING_BULLET, '').trim();
  if (!trimmed) return false;

  // Leading digit, fraction, or unicode fraction → almost certainly an
  // ingredient quantity.
  if (/^(\d+(?:\.\d+)?(?:\s*\d+\/\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\b/.test(trimmed)) {
    return true;
  }

  // Lines starting "a/an/some <measurement>" — e.g. "a pinch of salt".
  const firstWord = trimmed
    .split(/\s+/)[0]!
    .toLowerCase()
    .replace(/[.,:]$/, '');
  if (MEASUREMENT_WORDS.has(firstWord)) return true;

  // "Two cups of flour" — written-out number at start. Cheap check.
  const WRITTEN_NUMBERS = new Set([
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'half',
    'quarter',
  ]);
  if (WRITTEN_NUMBERS.has(firstWord)) {
    const secondWord = trimmed
      .split(/\s+/)[1]
      ?.toLowerCase()
      .replace(/[.,:]$/, '');
    if (secondWord && MEASUREMENT_WORDS.has(secondWord)) return true;
  }

  return false;
}

function stripBullet(line: string): string {
  return line.replace(LEADING_BULLET, '').trim();
}

export function parseRecipeText(raw: string): ParsedRecipeText {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());

  let prepTime: number | undefined;
  let cookTime: number | undefined;
  let totalTime: number | undefined;
  let bakeTime: number | undefined;
  let servings: number | undefined;

  // First pass: pluck metadata lines out so they don't pollute classification.
  const metadataLineIdx = new Set<number>();
  lines.forEach((line, idx) => {
    if (!line) return;

    for (const { key, re } of TIME_PATTERNS) {
      const m = line.match(re);
      if (m) {
        const minutes = extractMinutes(m[1]!);
        if (minutes != null) {
          if (key === 'prep') prepTime = minutes;
          else if (key === 'cook') cookTime = minutes;
          else if (key === 'bake') bakeTime = minutes;
          else totalTime = minutes;
          metadataLineIdx.add(idx);
        }
        return;
      }
    }

    for (const re of SERVINGS_PATTERNS) {
      const m = line.match(re);
      if (m) {
        servings = parseInt(m[1]!, 10);
        metadataLineIdx.add(idx);
        return;
      }
    }
  });

  // Bake-time falls back into cookTime if there's no explicit cook line.
  if (cookTime == null && bakeTime != null) cookTime = bakeTime;
  // If we got a total but no breakdown, drop it into cookTime so the form
  // shows something meaningful.
  if (prepTime == null && cookTime == null && totalTime != null) {
    cookTime = totalTime;
  }

  // Find the title — first non-empty, non-metadata, non-header line.
  let title = '';
  let titleLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line) continue;
    if (metadataLineIdx.has(i)) continue;
    if (
      SECTION_HEADERS.ingredients.test(line) ||
      SECTION_HEADERS.instructions.test(line) ||
      SECTION_HEADERS.notes.test(line)
    )
      continue;
    // A line that's clearly an ingredient shouldn't be the title.
    if (isIngredientLine(line)) continue;
    title = titleCase(line.replace(/^[#*\s]+/, '').trim());
    titleLineIdx = i;
    break;
  }

  // Find section header positions for strict splitting.
  type Section = 'ingredients' | 'instructions' | 'notes';
  const headerIdx: Array<{ idx: number; section: Section }> = [];
  lines.forEach((line, idx) => {
    if (!line || idx === titleLineIdx || metadataLineIdx.has(idx)) return;
    if (SECTION_HEADERS.ingredients.test(line)) headerIdx.push({ idx, section: 'ingredients' });
    else if (SECTION_HEADERS.instructions.test(line))
      headerIdx.push({ idx, section: 'instructions' });
    else if (SECTION_HEADERS.notes.test(line)) headerIdx.push({ idx, section: 'notes' });
  });

  // Ingredients can now be heading entries ({ heading }) or text entries
  // ({ text }) so a recipe like "Fries / Meatballs / Sauce" keeps its
  // structure on save + display.
  const ingredients: Array<{ text?: string; heading?: string }> = [];
  const instructionLines: string[] = [];

  if (headerIdx.length > 0) {
    // Strict mode: split by header positions.
    for (let h = 0; h < headerIdx.length; h++) {
      const { idx, section } = headerIdx[h]!;
      const nextIdx = headerIdx[h + 1]?.idx ?? lines.length;
      for (let i = idx + 1; i < nextIdx; i++) {
        const line = lines[i];
        if (!line || metadataLineIdx.has(i)) continue;
        if (section === 'ingredients') {
          if (isIngredientHeading(line)) {
            ingredients.push({ heading: normalizeHeading(line) });
          } else {
            ingredients.push({ text: stripBullet(line) });
          }
        } else if (section === 'instructions') instructionLines.push(line);
        // notes section is dropped — user can copy from raw text if needed.
      }
    }
  } else {
    // Heuristic mode: per-line classification.
    for (let i = 0; i < lines.length; i++) {
      if (i === titleLineIdx) continue;
      const line = lines[i];
      if (!line || metadataLineIdx.has(i)) continue;
      if (isIngredientLine(line)) {
        ingredients.push({ text: stripBullet(line) });
      } else if (isIngredientHeading(line)) {
        ingredients.push({ heading: normalizeHeading(line) });
      } else {
        instructionLines.push(line);
      }
    }
  }

  // Collapse any orphan numbered prefixes in instructions ("1. Preheat" stays
  // as a numbered list, but if every line has a "Step N:" prefix we strip it).
  const allStepPrefixed =
    instructionLines.length > 1 && instructionLines.every((l) => /^step\s*\d+\s*[:.\-]?/i.test(l));
  const cleanedInstructions = allStepPrefixed
    ? instructionLines.map((l) => l.replace(/^step\s*\d+\s*[:.\-]?\s*/i, ''))
    : instructionLines;

  // Inject line breaks before in-line step markers so OCR'd instructions
  // that arrived as "1. Preheat oven. 2. Mix bowl. 3. Bake." become
  // properly separated steps. Only breaks where the next token *looks* like
  // a step marker (number-dot + capital letter, "Step N", or a bullet
  // followed by a word) so we don't split "Mix 2 tbsp flour".
  const splitOnStepMarkers = (text: string): string =>
    text
      .replace(/\s+(?=\d+[.)]\s+[A-Z])/g, '\n')
      .replace(/\s+(?=Step\s+\d+\b)/gi, '\n')
      .replace(/\s+(?=[•●▪·]\s+\w)/g, '\n')
      .replace(/\n{3,}/g, '\n\n');

  return {
    name: title || 'Untitled Recipe',
    ingredients,
    instructions: splitOnStepMarkers(cleanedInstructions.join('\n')).trim(),
    prepTime,
    cookTime,
    servings,
  };
}
