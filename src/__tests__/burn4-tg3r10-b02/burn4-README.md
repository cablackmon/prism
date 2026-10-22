# Weekend place location editor

Open `/weekend/locations` to edit a saved Weekend place. Select a place, enter decimal coordinates or search by name, review the fields and press **Save location**. Search results include the full location name to distinguish places with similar names. A search result fills the draft without saving it.

The page uses the existing same-origin place list, location search and place update APIs. It saves only latitude, longitude, place name and address. Both blank coordinates remove the coordinates. Place name and address are independent optional fields. Search addresses longer than 500 characters are shortened with a visible notice before saving.

The source requirement is `docs/features/WEEKEND.md`, line 126. The existing form keeps its initial location without exposing location inputs. This new page provides a direct persisted workflow using new files. Existing navigation has no added link, so visit the URL directly. Pasted map links and POI discovery remain outside this page.

## Validation

Run only the two new test files from the repository root:

```sh
node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r10-b02/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r10-b02/burn4-model.test.ts src/__tests__/burn4-tg3r10-b02/burn4-editor.test.tsx
node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r10-b02/burn4-tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js --no-config-lookup --config src/__tests__/burn4-tg3r10-b02/burn4-eslint.config.mjs src/app/weekend/locations/page.tsx src/app/weekend/locations/burn4-location-editor.tsx src/app/weekend/locations/burn4-location-model.ts src/__tests__/burn4-tg3r10-b02/burn4-fixtures.ts src/__tests__/burn4-tg3r10-b02/burn4-model.test.ts src/__tests__/burn4-tg3r10-b02/burn4-editor.test.tsx --max-warnings 0
```

The focused run has 126 ordinary passing cases, zero named expected failures, zero skipped cases and zero failing cases. Every runtime export has behavior coverage. The tests cover strict response decoding, bounds and paired coordinate validation, legitimate zero coordinates, clearing, selection, reset, location-only saves, save-response confirmation, user permission and request failures, retry, malformed responses, result selection, truncation and untrusted text rendering. Deferred promises deliberately ignore abort to check request fencing on new queries, changed selection, Strict Mode replacement loads, saves and unmount.

All HTTP requests are replaced with local synthetic responses before rendering. Existing handlers, providers, caches, databases and existing application hooks are never imported or executed. Jest uses only the owned configuration and TypeScript project, with no root setup files. Validation is scoped to the three new runtime files and their test files.

## Behavior and limits

Save freezes selection, editable fields, search and reset until the request settles. A synchronous lock also fences duplicate submissions before React rerenders. A failed save preserves the exact draft. A successful response must confirm the selected identifier and all four submitted location fields before replacing the draft or announcing success.

Aborting a browser request stops its result from changing this page. It does not establish whether the server already committed a save. Retrying a location-only update writes the same explicit fields again. The existing API has no revision check, so this page does not protect against another session editing the same location concurrently.

The existing API controls access. Its unauthenticated place-list behavior can return an empty list; the page cannot distinguish that from an empty household. The existing geocoder can return an empty result when its provider fails; the page cannot distinguish that from no matching places. Searches go through the existing proxy only after the user submits a place name. Manual coordinates need no search.

No live provider, actual database transaction, physical browser layout, screen reader, application build or whole-suite behavior was tested. Existing source is unchanged. No public sharing or new permission mechanism is introduced.

## KNOWN GAP

None found in the new files. Existing endpoint limits are described above.

## Needs decision

None within this package.
