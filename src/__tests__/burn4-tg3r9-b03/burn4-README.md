# Offline trip route GeoJSON

The Travel guide documents Pacific trip polylines taking the long way around
the globe and suggests manually splitting a trip. This package supplies a
reusable antimeridian-safe geometry builder and an offline JSON-to-GeoJSON CLI.
The written basis is `docs/features/TRAVEL.md:89-123,247-249`.

Existing production globe drawing remains unchanged. This package does not
claim that the current Travel page renders differently. It imports none of
the application's travel, photo, provider, database or map modules.

## Input and use

Node 24 or newer is required. There are no additional runtime dependencies.
Pass one explicit local UTF-8 JSON file:

```sh
node scripts/burn4-trip-route-geometry.mjs ./synthetic-trip.json
node scripts/burn4-trip-route-geometry.mjs --help
```

The script prints one newline-terminated GeoJSON FeatureCollection to stdout.
It does not modify the input or write an output file. It makes no network
requests and does not read environment values. URLs, stdin and option-like
paths are rejected; use `./` before a local filename beginning with `-` or
containing a scheme-like prefix.

Example input:

```json
{
  "trips": [
    {
      "id": "pacific",
      "name": "Pacific crossing",
      "style": "route",
      "stops": [
        {"id": "west", "longitude": 170, "latitude": 20, "sortOrder": 0},
        {"id": "east", "longitude": -160, "latitude": 50, "sortOrder": 1}
      ]
    }
  ]
}
```

The crossing has two line parts: `[170,20]` to `[180,30]` and `[-180,30]`
to `[-160,50]`. Each output feature identifies its trip, zero-based leg index,
and original from/to stop IDs. Optional trip names are retained. Unknown
metadata is ignored and never copied into output.

The pure API accepts explicit plain JSON-shaped values:

```js
import {
  buildTripRouteGeoJSON,
  splitAntimeridianLeg,
  runCli,
  TRIP_ROUTE_LIMITS,
} from './scripts/burn4-trip-route-geometry.mjs';

const collection = buildTripRouteGeoJSON(snapshot);
const geometry = splitAntimeridianLeg([170, 20], [-160, 50]);
```

`runCli(args, io)` accepts injected `readChunks`, `stdout` and `stderr`
adapters. The byte reader is an async iterable of Uint8Array chunks; output
adapters may return promises. It returns 0 for help or success and 2 for
argument, read, JSON, validation or output failure. Validation diagnostics
include field paths and fixed reasons. Raw file contents, input values and
I/O error text are not echoed. A failed stdout write can leave a partial
external stream; the script cannot retract bytes already accepted by it.

## Geometry contract

- Trip IDs are unique within the snapshot. Stop IDs are unique within a trip.
  IDs retain exact nonblank text identity. A stop ID may repeat in another trip.
- Each trip requires `id`, `style` and `stops`. Each stop requires `id`, finite
  numeric latitude/longitude, and safe-integer `sortOrder`. Optional `name`
  must be nonblank text; optional `isHub` must be boolean. At most one stop
  may have `isHub: true`, for any style. Invalid records fail the whole build.
- Stops sort by increasing `sortOrder`; equal values retain input order.
  Trip order is retained. The snapshot is never mutated.
- A route emits one feature per consecutive ordered pair. A loop also closes
  the final stop to the first, including a two-stop out-and-back loop. A hub
  emits one feature per non-hub stop, using the explicit hub or first sorted
  stop. Empty and singleton trips emit no features.
- Each logical leg becomes a LineString or, for an interior crossing, a
  two-part MultiLineString. Every part has two coordinates and a longitude
  jump at most 180 degrees. Paired split endpoints have equal latitude and
  opposite 180-degree representations of the same meridian.
- Exactly 180-degree ties retain the input direction. Boundary endpoints may
  change between +180 and -180 to stay on the adjacent map edge. Splitting
  creates no zero-length fragments. An originally coincident logical leg
  remains its original two coincident points; it is not silently removed.
- Zero latitude/longitude, including the valid 0/0 location, are retained.
  Negative zero normalizes to positive zero.

Crossing latitude is interpolated linearly in longitude/latitude space. This
is a portable line representation, not a great-circle, geodesic, road or
terrain routing engine. Straight lines near a pole can differ substantially
from actual travel. It does not infer hierarchy, travel dates or photo links.
There is no actual MapLibre/browser/screenshot validation in this package.

## Resource limits

`TRIP_ROUTE_LIMITS` is frozen. CLI input is limited to 4 MiB before parsing,
with strict UTF-8 decoding and at most 16,384 chunks, including empty chunks.
The iterable closes on rejection. JSON-shaped API input is already decoded;
it is subject to the structural and expansion limits rather than a byte cap.
Callers must not provide accessor properties or proxies as snapshot data.

There are at most 256 trips, 512 stops per trip and 8,192 total stops. IDs
allow 128 UTF-16 code units and names 256. Validation and stable sorting
operate only on those bounded records. Before allocating features, a
conservative expansion preflight allows at most 8,192 features, 32,768
positions and 16 MiB of estimated serialized output. The estimate reserves
four positions per feature and six bytes per metadata code unit, plus fixed
JSON overhead. It can reject a snapshot whose actual output would be smaller.
These fixed limits are not configurable through input or CLI flags.

## Focused verification

Use the repository's existing development dependencies installed with lifecycle
scripts disabled. The owned configs do not import root Jest, TypeScript or
ESLint configuration. Native tests stay outside default Jest discovery.

```sh
timeout 180s node --max-old-space-size=1024 --test --test-concurrency=1 --test-timeout=10000 src/__tests__/burn4-tg3r9-b03/burn4-geometry.test.mjs src/__tests__/burn4-tg3r9-b03/burn4-validation.test.mjs src/__tests__/burn4-tg3r9-b03/burn4-cli.test.mjs
timeout 180s node --max-old-space-size=1024 node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r9-b03/burn4-tsconfig.json --noEmit --incremental false
timeout 180s node --max-old-space-size=1024 node_modules/eslint/bin/eslint.js --no-config-lookup --config src/__tests__/burn4-tg3r9-b03/burn4-eslint.config.mjs --max-warnings=0 scripts/burn4-trip-route-geometry.mjs src/__tests__/burn4-tg3r9-b03/burn4-test-helpers.mjs src/__tests__/burn4-tg3r9-b03/burn4-geometry.test.mjs src/__tests__/burn4-tg3r9-b03/burn4-validation.test.mjs src/__tests__/burn4-tg3r9-b03/burn4-cli.test.mjs src/__tests__/burn4-tg3r9-b03/burn4-eslint.config.mjs
```

All tests use synthetic data and inert I/O or temporary `/tmp` files removed
in `finally`. Direct-entry child processes use an empty environment. Tests
cover numeric vectors, boundary and tie policy, 2,000 seeded invariant probes,
route/loop/hub identity and order, validation and aggregate expansion limits,
byte/chunk boundaries, failures, Unicode, import silence, read-only file
behavior and a real closed stdout pipe. Test count is 108 ordinary passes,
zero failures, skipped tests or expected-failure cases.

KNOWN GAP: None in the new runtime. The existing production globe
antimeridian defect remains outside this package's integration scope.

Needs-decision: None.
