# Calendar event, overlay and measurement behavior

These offline tests exercise current master source at `5452b7c6cef8f9b3d9b5e936c748822e2a28535a`:

- `InlineCalendarEvent.tsx`: event clicks stop at the day-cell boundary, callbacks follow rerendered events, time visibility follows event/options, and display preferences reach time and past-event helpers.
- `OverlayItemsCell.tsx`: kind filtering, chores/tasks/meals ordering, equal IDs across kinds, click routing, completion/approval/cooking metadata, and owner/group/fallback color precedence.
- `DroppableOverlayCell.tsx`: unavailable/empty buckets and real-child delegation of drag IDs, density, layout, inclusion, color and item clicks.
- `CardHeightProbe.tsx`: measurement ref attachment, initial unknown height, changed-height reports, stable-height suppression, replacement callbacks, layout updates and unmount detachment.

The existing `SpanningEventRows.test.tsx` covers three Inline styling cases. This package adds interaction and lifecycle coverage. All four target components execute real source. Excluded `WeekItemCard`, clock/provider/color helpers, the utility barrel and the measurement hook use local fakes. Tests verify the props delivered to those boundaries and the real DOM/effect behavior of the target components. They do not test actual drag sensors, ResizeObserver, CSS layout, provider internals, or timezone algorithms.

## Run only this package

From the repository root with dependencies already installed:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath \
  src/__tests__/burn4-p13/burn4-inline-calendar-event.test.tsx \
  src/__tests__/burn4-p13/burn4-overlay-cells.test.tsx \
  src/__tests__/burn4-p13/burn4-card-height-probe.test.tsx

node node_modules/eslint/bin/eslint.js \
  src/__tests__/burn4-p13/burn4-inline-calendar-event.test.tsx \
  src/__tests__/burn4-p13/burn4-overlay-cells.test.tsx \
  src/__tests__/burn4-p13/burn4-card-height-probe.test.tsx \
  src/__tests__/burn4-p13/burn4-card-fixture.tsx

node node_modules/typescript/bin/tsc \
  --project src/__tests__/burn4-p13/burn4-tsconfig.json --pretty false
```

Validation: 3 suites, 19 ordinary passing cases, 0 expected failures, 0 skipped. Focused ESLint and package-only TypeScript checks pass with no diagnostics. No full-suite or repository-wide typecheck is claimed. All fixtures are synthetic and offline; no environment values, credentials, service calls, browser launches, or data providers are used.

To collect focused coverage, append these arguments to the Jest command:

```sh
--coverage \
--collectCoverageFrom=src/components/calendar/cells/InlineCalendarEvent.tsx \
--collectCoverageFrom=src/components/calendar/cells/OverlayItemsCell.tsx \
--collectCoverageFrom=src/components/calendar/cells/DroppableOverlayCell.tsx \
--collectCoverageFrom=src/components/calendar/cells/CardHeightProbe.tsx \
--coverageDirectory=/tmp/prism-burn4-p13-coverage
```

All four target modules reach 100% statements, branches, functions and lines. Dependency behavior behind the local fakes is outside this measurement.

## KNOWN GAP defects

None identified. No expected-failure tests or negative-probe claims are included.

## Needs decision

None.
