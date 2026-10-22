# Experimental freeform pixel-layout editor

This standalone component gives a dashboard designer a rendered canvas, pointer and keyboard move/resize handles, exact numeric rectangle entry, draft reset and an injected save boundary. It implements a new pixel schema from the freeform roadmap item in docs/planning.md:31. Placement and save/reset operations are grounded in docs/features/DASHBOARD.md:19-30,125-129.

Existing dashboard coordinates are grid cells, not pixels. This component does not accept or convert the existing grid schema. It imports only React and its own new model. Existing dashboard, registry, routes, templates, persistence and prior burn implementations are unchanged and are not imported or tested.

## Host contract

`Burn4FreeformLayoutEditor` takes `snapshot: unknown` and `onCommit(command): void | Promise<void>`. Supply an authorized snapshot using this independent schema:

```ts
{
  schemaVersion: 1,
  layoutId: 'kitchen-pixels',
  revision: 4,
  canvas: { width: 1000, height: 500 },
  items: [{
    id: 'clock', label: 'Clock', x: 100, y: 50,
    width: 200, height: 100, minWidth: 20, minHeight: 10
  }]
}
```

Canvas dimensions are integers from 1 through 16384. Snapshots contain at most 128 uniquely identified widgets. IDs and layout identity have at most 128 text units, labels at most 120, with nonempty text and no control characters. Revisions are nonnegative safe integers. Rectangles fit inside the explicit canvas and honor caller-supplied positive minimum sizes. Overlap is allowed. The model copies, allowlists and deeply freezes snapshots. It rejects sparse arrays and invalid geometry.

The editor keeps an unsaved local rectangle draft. Arrow keys move or resize one pixel, Shift+Arrow changes ten, and exact numeric entry requires Apply coordinates. Unapplied fields block saving. Pointer gestures scale each axis by the measured rendered canvas bounds and remain clamped to the canvas. Escape, pointer cancellation or lost capture restores that gesture's starting draft. Capture is released on completion, reload, host conflict and unmount. No global document properties or listeners are changed. If capture or canvas measurement is unavailable, use keys or coordinates.

Saving creates a deeply frozen `{ expectedRevision, candidate }`, where candidate revision is expectedRevision + 1. The host must apply that comparison atomically and publish the authoritative result through snapshot. The callback result alone never acknowledges a save. Only exact normalized equality with the candidate, including layout ID, revision, canvas, item order, labels, minimum sizes and all rectangles, acknowledges it. Object property insertion order does not matter.

While a command is submitting, awaiting acknowledgement or rejected, edits remain locked. Retrying sends the same command and candidate object identities. An exact host acknowledgement wins even if the callback is pending or later rejects. Callback settlement after acknowledgement, explicit Reload latest, a layout identity change or unmount is ignored.

A changed snapshot at the same or an older revision conflicts. A newer noncandidate snapshot conflicts when there is a draft, unapplied input or an uncertain command. Conflict remains until explicit Reload latest, even if a matching candidate later appears. Reload adopts the latest valid supplied snapshot and discards the local command view. It cannot cancel an already issued host write. A clean editor accepts a newer host snapshot. Invalid host data displays an error and disposes the previous editor. A changed layout identity starts a separate editor lifetime.

The host owns globally meaningful request IDs, replay protection, authorization and durable storage. Retaining a command object inside this mount does not establish global exactly-once behavior or persistence. The revision limit prevents overflow. A host requiring remount-safe retries must retain its own command ledger.

## Run only this package

From the package worktree with the shared dependency link temporarily present:

```sh
timeout 180s node --max-old-space-size=1024 node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r9-b08/burn4-jest.config.cjs --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r9-b08/burn4-geometry.test.ts src/__tests__/burn4-tg3r9-b08/burn4-editor.test.tsx src/__tests__/burn4-tg3r9-b08/burn4-editor-lifecycle.test.tsx
timeout 180s node --max-old-space-size=1024 node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r9-b08/burn4-tsconfig.json --noEmit --incremental false
timeout 180s node --max-old-space-size=1024 node_modules/eslint/bin/eslint.js --no-config-lookup --config src/__tests__/burn4-tg3r9-b08/burn4-eslint.config.mjs --max-warnings=0 src/lib/burn4-freeform-layout.ts src/components/layout/burn4-freeform-layout-editor.tsx src/__tests__/burn4-tg3r9-b08/burn4-geometry.test.ts src/__tests__/burn4-tg3r9-b08/burn4-editor.test.tsx src/__tests__/burn4-tg3r9-b08/burn4-editor-lifecycle.test.tsx src/__tests__/burn4-tg3r9-b08/burn4-jest.config.cjs src/__tests__/burn4-tg3r9-b08/burn4-eslint.config.mjs
```

The explicit owned TypeScript config includes both runtime files, all tests and both executable configs. Node16 resolution supports the ESLint parser package's exported types; isolatedModules is enabled for ts-jest. Jest uses the explicit owned config path, empty setup arrays and no root preset. Lint has no root configuration lookup.

Counts: 112 ordinary passing cases across three focused suites; zero failed, skipped or expected-failure cases. Strict scoped types and focused lint pass with zero lint warnings. Tests are synthetic offline fixtures and jsdom, with no application services, database, environment values, network or real family data. Every runtime export has behavior coverage. Known gaps: none in this new code. Needs-decision: none within this package.

## Limits

This is a standalone experimental editor, with no current app/grid/widget wiring or migration. It shows labels and controls rather than rendering actual widget contents. It does not add widgets, avoid overlaps, style widgets, share layouts, persist data or enforce authorization. The host must provide valid snapshots and atomic revision handling. Visual layout, real outside-pointer routing, physical keyboard/touch activation, screen-reader behavior and browser/device compatibility need a real browser check. jsdom proves the event handlers and controlled state transitions only. No whole suite or upstream feature completion is claimed.
