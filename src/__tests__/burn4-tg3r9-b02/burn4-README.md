# Shopping contributor view

`docs/features/SHOPPING.md:181` describes a missing shopping contributor display and per-person filter. This package adds a usable controlled React component and a pure projection model. Existing shopping pages, routes and models stay outside this package's execution scope.

## Use

Import `Burn4ShoppingAttribution` from `src/components/shopping/burn4-shopping-attribution`. Supply `snapshot`, `filters` and `onFiltersChange`. A host can use `useState<ShoppingAttributionFilters>` and pass its setter directly. Every interaction requests the next filter; only updated props change the view. To reset on a list change, the host explicitly passes the default filters.

```tsx
const [filters, setFilters] = useState<ShoppingAttributionFilters>({
  contributor: { kind: 'all' },
  checked: 'all',
});
return <Burn4ShoppingAttribution
  snapshot={{
    list: { id: 'groceries', name: 'Groceries' },
    members: [{ id: 'member-a', name: 'Robin' }],
    items: [{
      id: 'item-a', listId: 'groceries', name: 'Milk', checked: false,
      addedBy: { id: 'member-a', name: 'Robin' },
    }],
  }}
  filters={filters}
  onFiltersChange={setFilters}
/>;
```

The standalone `buildShoppingAttributionView(snapshot, filters)` accepts the same data and validates it at runtime. It returns frozen allowlisted rows, contributor options and checked/open/total counts. It throws only `Invalid shopping attribution data.` for invalid data. The component presents a generic alert and can recover when valid props arrive.

Contributor filters are `{kind:'all'}`, `{kind:'unassigned'}` or `{kind:'member',memberId:'...'}`. Member IDs named `all` or `unassigned` remain ordinary exact identities. Status is `all`, `open` or `checked`. Counts measure rows, independently of quantity. Full-list and contributor totals ignore status filters; matched totals reflect both filters. Rows from other lists never affect counts or contributor options, while all input rows still receive shape and identity validation.

Current roster names take precedence. An absent roster identity keeps its supplied name, or displays `Unavailable member` when none exists. For repeated absent identities with conflicting supplied names, the first row's label is used consistently. This is a display policy, not inferred history. A selected identity missing from both roster and rows remains selected with zero matches. NULL/missing `addedBy` means no contributor recorded. The database can erase attribution using SET NULL when a member is removed; this component never reconstructs it. Supplied unknown metadata is neither read nor rendered.

## Bounds and checks

API bounds are 2,000 input rows, 256 roster members, unique row and roster identities, 128 UTF-16 units per identity, 100 per list/member name, 255 per item name and 1,000,000 total validated text units. Identities must be nonblank with no surrounding whitespace. Names are trimmed. All rows and roster entries must be valid even when their list is not selected. These are component limits, not database schema guarantees. Outputs retain caller row order and do not mutate or retain mutable caller records.

Use the repository's existing dependencies. This package installs nothing. From the repository root run only:

```sh
timeout 180s node --max-old-space-size=1024 node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r9-b02/burn4-jest.config.cjs --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r9-b02/burn4-model.test.ts src/__tests__/burn4-tg3r9-b02/burn4-ui.test.tsx
timeout 180s node --max-old-space-size=1024 node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r9-b02/burn4-tsconfig.json --noEmit --incremental false
timeout 180s node --max-old-space-size=1024 node_modules/eslint/bin/eslint.js --no-config-lookup --config src/__tests__/burn4-tg3r9-b02/burn4-eslint.config.mjs --max-warnings=0 src/lib/burn4-shopping-attribution.ts src/components/shopping/burn4-shopping-attribution.tsx src/__tests__/burn4-tg3r9-b02/burn4-fixtures.ts src/__tests__/burn4-tg3r9-b02/burn4-model.test.ts src/__tests__/burn4-tg3r9-b02/burn4-ui.test.tsx src/__tests__/burn4-tg3r9-b02/burn4-jest.config.cjs src/__tests__/burn4-tg3r9-b02/burn4-eslint.config.mjs
```

Tests execute actual new model/UI code against synthetic snapshots in jsdom. Configs load only the owned tests with an explicit owned TypeScript path and empty setup arrays. Strict types include both runtime files. No existing app source, provider, service, environment value, storage, database or network request is used. No full repository suite, build, typecheck or lint pass is claimed. jsdom checks markup, focus and controlled callbacks; actual browser layout and native select keyboard behavior need manual review in a host integration.

KNOWN GAP: None. New-code defects must be fixed before acceptance.

Needs-decision: None. The host owns authorization, loading, persistence and app wiring. The view does not change item attribution or checked state.
