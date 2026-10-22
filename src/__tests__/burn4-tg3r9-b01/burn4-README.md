# Regional Weekend backlog map

Visit `/weekend/map` to compare the locations already saved in Weekend Ideas. The route reads `/api/weekend/places` with the current same-origin session. Use the link back to Weekend Ideas to add or edit places. This addition does not change the existing Weekend page or navigation.

The coordinate map fits matching place coordinates across the shortest longitude extent, including regions crossing the antimeridian. Search names or tags, show favorites, switch backlog/visited/all places, select a pin or its list entry, pan, zoom, center on a selection, and fit the results. Arrow keys pan, plus/minus zoom, and Home fits when the map has focus. Zero latitude/longitude values are valid. Places without usable coordinates remain in the list.

The map labels center, geographic extent and axes. Its scale measures great-circle distance between endpoints at the center latitude; the selected-place distance uses a spherical Earth radius of 6,371 km. Context paths break at the longitude seam. This is an outing overview using an equirectangular coordinate plane, without terrain, roads, a downloaded basemap, navigation directions or travel-time estimates. Selection and search work without context outlines.

Optionally select a local GeoJSON Polygon, MultiPolygon, LineString, Feature or FeatureCollection. The file remains in memory and is not uploaded or persisted. The parser discards properties, caps UTF-8 input at 512 KiB, geometries/features at 128, rings/lines at 512, coordinates at 12,000 and parser work at 16,000 steps. Rings must close; coordinates must be two finite longitude/latitude numbers within geographic bounds. Unsupported geometry fails explicitly. Malformed, unreadable, oversized and stale files preserve the last accepted context. Pending files cannot restore a removed layer. Place snapshots allow at most 5,000 unique IDs with bounded displayed text and tags.

API refresh aborts the prior request. Request counters fence late network/JSON results and unmount callbacks. HTTP, JSON, schema and network errors have retry controls; refresh errors retain the last loaded places. Local file reads have separate ordering fences. Independent map instances own their state and accessibility IDs.

Written basis: `docs/features/WEEKEND.md`, roadmap section, specifically regional backlog pins on a map. This implements that map portion. It does not implement POI search, geocoding, place mutations, visits or collaboration.

## Focused verification

Run from the worktree with its temporary link to the lane's shared dependency installation:

```sh
timeout 180s node --max-old-space-size=1024 node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r9-b01/burn4-jest.config.cjs --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r9-b01/burn4-geography.test.ts src/__tests__/burn4-tg3r9-b01/burn4-regional-map.test.tsx

timeout 180s node --max-old-space-size=1024 node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r9-b01/burn4-tsconfig.json --noEmit --incremental false

timeout 180s node --max-old-space-size=1024 node_modules/eslint/bin/eslint.js --no-config-lookup --config src/__tests__/burn4-tg3r9-b01/burn4-eslint.config.mjs --max-warnings=0 src/app/weekend/map/page.tsx src/app/weekend/map/burn4-regional-map.tsx src/app/weekend/map/burn4-geography.ts src/__tests__/burn4-tg3r9-b01/burn4-geography.test.ts src/__tests__/burn4-tg3r9-b01/burn4-regional-map.test.tsx
```

45 ordinary passing tests, no snapshots, skips or expected failures. Tests exercise all new runtime exports and the real rendered page with synthetic snapshots, fake fetch and local in-memory file reads. No existing handler or app source is imported. Jest uses only the owned config, empty setup lists and an explicit owned TypeScript project; ESLint disables config lookup. TypeScript includes all three new runtime sources and both test files with strict checks. No root config/setup is executed.

KNOWN GAP: None found in the new code. Existing application defects and real provider/database/browser behavior are outside this package. Browser layout, SVG painting and physical keyboard/device behavior still need browser review; jsdom verifies interaction/state semantics only. No whole-app build, full suite or live check is claimed.

Needs-decision: None.
