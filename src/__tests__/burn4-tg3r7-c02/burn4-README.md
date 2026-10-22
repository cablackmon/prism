# Offline Weekend Ideas suggestions

`scripts/burn4-weekend-suggest.mjs` ranks a supplied local list of outing ideas
using an explicit date, hemisphere, weather and preferences. This implements a
standalone part of the Suggest backlog in `docs/planning.md:74` and
`docs/features/WEEKEND.md:128`. The weights below are this new tool's policy.
Existing application behavior is unchanged.

Save a scenario as a UTF-8 JSON file, then run:

```sh
node scripts/burn4-weekend-suggest.mjs scenario.json
node scripts/burn4-weekend-suggest.mjs --help
```

Example input:

```json
{
  "date": "2026-06-06",
  "hemisphere": "north",
  "weather": { "temperatureC": 20, "precipitation": true },
  "preferences": {
    "preferredTags": ["family"],
    "seasonalTags": { "summer": ["seasonal"] },
    "preferFavorites": true,
    "preferUnvisited": true,
    "limit": 3
  },
  "places": [
    { "id": "park", "name": "Synthetic Park", "status": "backlog", "isFavorite": false, "tags": ["outdoor", "family", "seasonal"] },
    { "id": "gallery", "name": "Synthetic Gallery", "status": "visited", "isFavorite": true, "tags": ["indoor", "family"] }
  ]
}
```

The gallery scores 8 and the park scores 6 in this wet-weather example. Changing
only precipitation to `false` gives the park 10 and the gallery 6.

## Input contract

`date`, `hemisphere` and `places` are required. Dates must be exactly ASCII
`YYYY-MM-DD`, with a real Gregorian date in years 0001 through 9999. No timestamp,
date padding, year zero, system clock or timezone conversion is used.
Hemisphere is exactly `north` or `south`.

North meteorological seasons are March through May spring, June through August
summer, September through November autumn, and December through February winter.
South uses the opposite season. This is an explicit calendar convention rather
than a local climate forecast.

Weather is optional or `null`. When present, it requires a finite `temperatureC`
from -100 through 100 and a boolean `precipitation`. These are supplied
observations; the tool never fetches weather.

Each place requires `id`, `name`, `status`, `isFavorite` and `tags`. Status is
`backlog` or `visited`, and `isFavorite` must be boolean. The projection matches
the existing WeekendPlace shape. IDs trim surrounding whitespace, retain case
and must be unique after trimming. Names trim surrounding whitespace while
preserving internal text and Unicode. Tags trim, lowercase without a locale,
and deduplicate in first-occurrence order. Custom tag strings are supported.

Preferences are optional. An explicit `null` is invalid. Omitted fields use:

| Field | Default | Meaning |
| --- | --- | --- |
| `requiredTags` | `[]` | Every listed tag must be present. |
| `excludedTags` | `[]` | Any matching tag excludes the place. |
| `preferredTags` | `[]` | Each match contributes +4. |
| `seasonalTags` | All four lists empty | A map of spring/summer/autumn/winter tag arrays. |
| `preferFavorites` | `false` | Favorite places contribute +2 when enabled. |
| `preferUnvisited` | `false` | Backlog places contribute +1 when enabled. |
| `status` | `all` | Hard filter: all, backlog or visited. |
| `limit` | `3` | An integer from 1 through 20, applied after sorting. |

Required and excluded tags cannot overlap after normalization. Preferred or
seasonal tags may also be excluded: the hard exclusion wins. Array fields must
be arrays when present, including empty arrays; explicit `null` is invalid.
Both preference booleans require booleans, and numeric strings are invalid.

Bounds apply to raw input before trimming or deduplication: at most 1000 places,
200 UTF-16 code units per ID, 500 per name, 80 per tag, and 50 raw entries in each
tag list. A lowercase tag must also remain within 80 units. Duplicate raw tags
still count toward the 50-entry bound. This makes work bounded even when every
tag is identical. The CLI file limit is separately 2 MiB of UTF-8 bytes.

The direct APIs consume own data fields. Arrays use their bounded own numeric
entries, never a custom iterator. Sparse, inherited or accessor entries reject;
accessors on known object fields also reject without invocation. Unknown keys,
getters and iterator metadata are ignored. Unknown application metadata is never
copied into normalized input or output. Unexpected proxy traps produce a generic
value-free validation error.

## Ranking and reasons

Status and tag filters run first. Weather never removes a candidate. Scores are
the sum of these independently configured contributions:

| Contribution | Weight | Reason code |
| --- | --- | --- |
| Each matching preferred tag | +4 | `preferred-tag`, with `tag` |
| Each matching tag in the derived season's list | +3 | `seasonal-tag`, with `tag` |
| Enabled favorite preference and favorite place | +2 | `favorite` |
| Enabled unvisited preference and backlog place | +1 | `unvisited` |
| Adverse weather and indoor-only exposure | +2 | `indoor-weather` |
| Adverse weather and outdoor-only exposure | -2 | `outdoor-weather` |
| Dry weather from 5 through 30 C and outdoor-only exposure | +2 | `outdoor-weather` |

Weather is `adverse` when precipitation is true or temperature is below 5 or
above 30 C. Otherwise it is `mild-dry`. Exposure is explicit: only the `indoor`
and `outdoor` tags count. Places carrying both tags or neither receive no weather
contribution. Museum, food and other tags never imply indoor exposure. Missing
weather contributes nothing. Zero contributions have no reason record.

Reasons appear in preferred-list order, then current seasonal-list order, then
favorite, unvisited and weather order. Each has `code`, integer `weight` and an
optional matching `tag`. Their weights sum exactly to `score`. A tag configured
as both preferred and seasonal earns both independent contributions.

Results sort by descending score, then original input order. Ties remain stable
after filtering. Negative scores remain eligible. The limit changes the number
returned, without changing considered or eligible counts.

## Output and direct APIs

Success writes one formatted JSON document and one newline to stdout, with empty
stderr. Its exact top-level keys are `date`, `hemisphere`, `season`, `weather`,
`consideredCount`, `eligibleCount` and `suggestions`. Weather is `null` or an object
with `temperatureC`, `precipitation` and `classification`. Each suggestion has
only `id`, `name`, `status`, `isFavorite`, `tags`, `score` and `reasons`.

Notes, addresses, coordinates, URLs, descriptions, source/provider identifiers,
creators, timestamps and arbitrary extra metadata are omitted. The projected
names and tags remain ordinary JSON strings, including quotes and markup.

There are exactly three runtime exports:

```js
import { parseWeekendScenario, suggestWeekend, runCli } from './scripts/burn4-weekend-suggest.mjs';
const normalized = parseWeekendScenario(rawInput);
const result = suggestWeekend(normalized);
```

Both pure functions accept unknown structured input and validate it.
`suggestWeekend(rawInput)` also works directly; passing parser output does not
bypass validation. Neither function mutates input or retains state. Returned
arrays and reason records belong to that call.

`runCli(args, io?)` returns a promised exit status without exiting its host.
Injected `io` has `readFile(path, maxBytes): Promise<Uint8Array>`, `stdout(text)`
and `stderr(text)` functions. Writers may be synchronous or asynchronous. The
reader must enforce regular-file policy if it accesses files. The CLI also
checks the returned byte type and actual byte length before decoding.

Default I/O opens the explicit path read-only and nonblocking, checks the opened
descriptor for a regular file and reported size, then reads at most 2 MiB plus
one sentinel byte. This bounds growth even when stat is stale. The descriptor
closes in a finally path. Symlinks to regular files are accepted. No FIFO is
created or used by tests. These checks do not promise an atomic file snapshot
while another process modifies it.

Only a single path or `--help` is accepted. Prefix a dash-leading filename with
`./`. Help and bad arguments perform no input read. Controlled argument, read,
UTF-8, JSON and schema failures return 1 with empty stdout and a value-free
diagnostic on stderr. Schema messages name fixed field paths and numeric
indexes without echoing values. Output failures return 1; a failed writer may
have emitted a partial document, and an unavailable stderr cannot carry a
diagnostic. Default writes address stdout/stderr descriptors only.

Importing the module performs no tool I/O, output or clock access. It has only
Node builtin dependencies. It reads no environment values, network, database,
application module, account configuration or default input location, and writes
no output file. The executable guard runs the CLI only when invoked directly.

## Focused verification

Run only this package's files, with native tests in one worker at a time:

```sh
node --test --test-reporter=tap --test-concurrency=1 src/__tests__/burn4-tg3r7-c02/burn4-parse.test.mjs src/__tests__/burn4-tg3r7-c02/burn4-ranking.test.mjs src/__tests__/burn4-tg3r7-c02/burn4-cli.test.mjs
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r7-c02/burn4-tsconfig.json
node node_modules/eslint/bin/eslint.js scripts/burn4-weekend-suggest.mjs src/__tests__/burn4-tg3r7-c02/*.mjs --max-warnings 0
```

Tests cover all exports, actual CLI runs with empty child environments, exact
byte boundaries, stale-stat growth and partial reads, import I/O traps, value-free
failures, hand-calculated rankings, dates, thresholds, filters, reasons, purity,
metadata omission and malformed direct inputs. Only synthetic files under an
owned temporary directory are read. The scoped checkJs retains strict root flags
and `noUncheckedIndexedAccess`. Native `.test.mjs` files stay outside default Jest
discovery. No optional runtime or root configuration change is needed.

This standalone tool has no application Suggest button or API route. It does not
fetch forecasts, verify opening hours or venue conditions, estimate travel
distance, book anything, geocode or share data. Scores order the supplied ideas;
they do not certify outing availability or conditions. No KNOWN GAP is accepted
for new tool defects. Needs-decision: none.
