# Inline widget expanders

`docs/planning.md:31` lists collapsible expander widgets. The new `Burn4LayoutExpander` implements reusable inline disclosures, importing only React. It is ready for callers to use independently; dashboard/grid integration and completion of upstream issue #121 are outside this change.

```tsx
import { Burn4LayoutExpander } from '../../components/ui/burn4-layout-expander';

<Burn4LayoutExpander
  label="Kitchen widgets"
  panels={[
    { id: 'calendar-demo', title: 'Calendar', children: <p>Example calendar</p> },
    { id: 'chores-demo', title: 'Chores', children: <p>Example chores</p> },
  ]}
  defaultOpenIds={['calendar-demo']}
/>
```

Panels have a unique nonblank `id`, nonblank plain-text `title`, React `children` and optional `disabled`. Bodies stay mounted while native `hidden` removes collapsed content from display and the accessibility tree. Child drafts survive toggling; child effects keep running while hidden. Default headings are h3; `headingLevel` accepts 2-6. `label` names the focusable collection fallback and must be nonblank when supplied. `className` attaches to the collection; controls otherwise use native styling.

`mode="multiple"` is the default. Single mode permits one or zero open bodies. Unknown/repeated IDs are ignored/deduplicated; declaration order controls callback order and the winner of conflicting single-mode IDs. Disabled headers cannot request toggles but can remain owner-open.

Use `defaultOpenIds` for local ownership, or `openIds` with `onOpenChange` for controlled ownership. Controlled requests emit fresh ID arrays while supplied props stay authoritative. The callback fires once per accepted activation, never for reconciliation. Ownership stays fixed per mounted instance; use a new React key to change it. Removing panels prunes local open state; later re-addition starts closed. Switching to single mode similarly discards excess local open IDs. Controlled owners retain their own snapshots.

Native buttons provide Enter/Space activation. Arrow Up/Down wrap among enabled headers; Home/End select the first/last. Tab, other keys and modified shortcuts retain native behavior. ARIA links and body nodes survive same-ID reordering. Before a focused body closes, focus is captured and restored after commit to its header, nearest enabled header, or named collection. Removing focused panels chooses the first remaining enabled header or collection. Unrelated focus stays put.

The 58 offline cases exercise controlled/local and batched requests, frozen inputs, callback isolation, mounted drafts, keyboard navigation, ARIA/SSR, reordering/removal, focus recovery and ownership errors. All are ordinary passing cases; expected failures, failures and skipped cases are zero. KNOWN GAP pinned source defects: none.

Run from the repository root with installed dependencies:

```sh
timeout 90 node node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r8-b08/burn4-jest.config.cjs --runInBand --runTestsByPath src/__tests__/burn4-tg3r8-b08/burn4-layout-expander.test.tsx --no-cache
timeout 60 node node_modules/typescript/bin/tsc -p src/__tests__/burn4-tg3r8-b08/burn4-tsconfig.json --noEmit --incremental false
timeout 60 node node_modules/eslint/bin/eslint.js --no-config-lookup --no-ignore --config src/__tests__/burn4-tg3r8-b08/burn4-eslint.config.mjs --max-warnings 0 src/components/ui/burn4-layout-expander.tsx src/__tests__/burn4-tg3r8-b08/burn4-layout-expander.test.tsx src/__tests__/burn4-tg3r8-b08/burn4-jest.config.cjs src/__tests__/burn4-tg3r8-b08/burn4-eslint.config.mjs
```

Owned configs bypass repository setup/configs. TypeScript strictly checks both runtime and tests, with `noUncheckedIndexedAccess`; `skipLibCheck` applies only to dependency declarations. Fixtures are synthetic and no app provider, existing source module, environment, service, storage or network is used. Jest's existing jsdom environment is used with Node export conditions for ReactDOM server rendering.

Limitations: no persistence, registry/grid edits, automatic compaction, mobile wiring or visible app adoption. jsdom checks structural semantics and focus; it cannot establish visual appearance, physical Enter/Space activation, touch behavior or screen-reader announcements. No browser or full application suite was run. Needs decision: future dashboard integration policy.
