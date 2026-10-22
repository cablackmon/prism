# Offline Photos By Trip manifests

The standalone tool groups explicitly supplied photo GPS records into whole-trip albums. Each photo appears once per trip with evidence for every matching pin. It retains all overlapping trips and reports photos that cannot be grouped. It reads one JSON input from stdin and writes a deterministic JSON manifest.

Written basis: `docs/planning.md:35` requests Photos By Trip grouping via travel pins. `docs/features/TRAVEL.md:96-102` describes formal trip stops, and `:128-144` documents the existing Haversine nearby-pin strip with a 50 km default. This tool adds whole-library trip aggregation and overlap reporting; Photos UI integration remains future work.

```sh
node scripts/burn4-photo-trip-group.mjs < input.json
node scripts/burn4-photo-trip-group.mjs --help
```

Synthetic input:

```json
{
  "schemaVersion": 1,
  "radiusKm": 50,
  "photos": [{"id": "photo-a", "latitude": 0, "longitude": 0}],
  "trips": [{
    "id": "trip-a",
    "name": "Example trip",
    "pins": [{"id": "pin-a", "latitude": 0, "longitude": 0}]
  }]
}
```

Import `groupPhotosByTrip(input)` for the pure interface, or `runPhotoTripCli({input, writeOutput, writeError}, args)` for injected async byte streams and writers. Imports perform no I/O. The executable uses stdin/stdout/stderr only; no network, database, file discovery, environment values or app imports.

The input must have `schemaVersion: 1`, `photos` and `trips` arrays. Photo and trip IDs are unique nonempty strings; pin IDs are unique inside their trip. Each trip needs a string `name` and a `pins` array. Pins are associated with trips by explicit nesting; the caller supplies eligible flattened stops and national parks. Labels and names never infer membership. Empty trips remain in output.

GPS coordinates must be finite numeric latitude [-90,90] and longitude [-180,180]. Invalid pin GPS fails the input. Photos with absent/null latitude or longitude become `missing-gps`; otherwise invalid photo GPS becomes `invalid-gps`. Complete valid GPS beyond every radius becomes `no-nearby-trip`. Numeric strings are not coerced. Distinct photo IDs remain distinct even if coordinates coincide.

Radius defaults to the documented 50 km. An explicit finite nonnegative `radiusKm` deliberately changes this offline preview policy; production radius controls are outside scope. Haversine uses a 6371 km spherical Earth, normalizes antimeridian separation, and clamps numerical intermediates. Matching is inclusive against the unrounded distance. Reported `distanceKm` rounds to six decimals; rounded evidence never decides membership.

Capture timestamps, visit dates and extra metadata are unused and omitted from output. Repeat visits to the same place can therefore share photos across different years. Date-based disambiguation needs a separately agreed policy for timezones, missing capture times and overlapping visit windows.

Output fields are `schemaVersion`, `radiusKm`, `groups`, `overlaps` and `ungrouped`. Every group contains `tripId`, `name`, and `photos`; each grouped photo contains `photoId` and `matchedPins` with `pinId`/`distanceKm`. Every overlap lists `photoId` and all `tripIds`. Ungrouped entries contain `photoId` and `reason`. All collections sort by exact string IDs, independent of input order or locale. Caller input is not mutated. CLI JSON has a single trailing newline. Invalid JSON/shape returns status 1 and sanitized stderr without partial stdout.

Explicit local limits: 8 MiB UTF-8 CLI input, 16384 input chunks (including empty chunks), 100000 photos, 1000 trips, 10000 total pins, and 10000000 candidate comparisons (`photos.length * totalPins`). Limits reject requests rather than truncate results. The CLI stops consuming input after byte or chunk overflow. It uses one fixed 8 MiB buffer, copies only nonempty fragments into it and retains no per-chunk buffers or metadata; the chunk cap also bounds pathological empty-fragment work. The manifest also has a conservative 32 MiB serialized-output budget reserved before appending groups, photo memberships, pin evidence, overlap IDs and ungrouped entries. Every string is charged up to six bytes per UTF-16 code unit for worst-case JSON escaping, with fixed overhead for keys, indentation and numbers. This can reject a manifest whose actual JSON would be smaller. The budget also bounds record growth and fails before serialization, with no partial manifest. These are local-tool limits, not production capacity claims.

Focused offline validation, with the shared dependency link available:

```sh
timeout 30s node --test --test-concurrency=1 src/__tests__/burn4-tg3r8-b03/burn4-photo-trip-group.test.mjs

timeout 30s node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --noUncheckedIndexedAccess --types node --module NodeNext --moduleResolution NodeNext --target ES2022 scripts/burn4-photo-trip-group.mjs src/__tests__/burn4-tg3r8-b03/burn4-photo-trip-group.test.mjs src/__tests__/burn4-tg3r8-b03/burn4-eslint.config.mjs

timeout 30s node node_modules/eslint/bin/eslint.js --no-config-lookup --no-ignore --config src/__tests__/burn4-tg3r8-b03/burn4-eslint.config.mjs --max-warnings 0 scripts/burn4-photo-trip-group.mjs src/__tests__/burn4-tg3r8-b03/burn4-photo-trip-group.test.mjs src/__tests__/burn4-tg3r8-b03/burn4-eslint.config.mjs
```

Tests use synthetic coordinates/records and Node built-ins only. Child CLI checks specify `env: {}` and timeouts. No root configs or existing runtime modules load. No expected-failure tests are planned for this entirely new module.

Scope limits: no app UI, persistence, export adapter, hierarchy inference, provider/EXIF access, source-priority deduplication or existing API parity claim. No upstream issue is claimed complete.
