# Accessible controls and image fallback behavior

Plan revision 2, round 2 covers five unchanged current master sources:

- `src/components/ui/Emoji.tsx`
- `src/components/ui/progress.tsx`
- `src/components/ui/toaster.tsx`
- `src/components/ui/textarea.tsx`
- `src/app/weekend/components/StarRating.tsx`

Every runtime export is rendered directly. The tested master source SHA is
`5452b7c6cef8f9b3d9b5e936c748822e2a28535a`.

## Run from the repository root

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-p17/burn4-emoji.test.tsx src/__tests__/burn4-p17/burn4-progress-textarea.test.tsx src/__tests__/burn4-p17/burn4-toaster.test.tsx src/__tests__/burn4-p17/burn4-star-rating.test.tsx
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-p17/burn4-emoji.test.tsx src/__tests__/burn4-p17/burn4-progress-textarea.test.tsx src/__tests__/burn4-p17/burn4-toaster.test.tsx src/__tests__/burn4-p17/burn4-star-rating.test.tsx
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-p17/burn4-tsconfig.json --pretty false
```

For focused coverage, add these arguments to Jest:

```sh
--coverage --collectCoverageFrom=src/components/ui/Emoji.tsx --collectCoverageFrom=src/components/ui/progress.tsx --collectCoverageFrom=src/components/ui/toaster.tsx --collectCoverageFrom=src/components/ui/textarea.tsx --collectCoverageFrom=src/app/weekend/components/StarRating.tsx --coverageDirectory=/tmp/prism-burn4-p17-coverage
```

## Behavior covered

- Emoji filenames for surrogate pairs, variation selectors, ZWJ sequences,
  skin tones, flags, keycaps, and families; accessible labels; image errors;
  fallback text; empty input; healthy updates and recovery after failed images.
- Progress indeterminate semantics, ref lifecycle, maximum and accessible
  description forwarding, interaction handlers, visible percentage updates,
  and numeric ARIA behavior using the real installed Radix progress primitive.
- Toaster provider/viewport placement, title text and rich description content,
  optional content, supplied action clicks, one close boundary per record,
  open/duration/variant/lifecycle props, keyed reorder/update, and removal.
- Textarea refs, focus/unmount, labels, multiline defaults, validation props,
  form values, controlled editing, input events, disabled/readonly transitions,
  and keyboard/focus/blur callback forwarding.
- Star rating null/zero/partial/full display, singular/plural accessible names,
  read-only disabling, selection callbacks, controlled parent updates, form
  submission prevention, and current-value accessibility.

Existing widget tests were inspected. They replace Progress with a fake, so
they do not cover the real wrapper or Radix behavior tested here. There were
no direct adequate tests for these five source modules.

All tests run in jsdom. Image loading errors are synthetic events; jsdom does
not load the image resources in this configuration. No network calls, services,
account data, host environment values, sends, or persistence are used.

The utility aggregate is replaced with a class-name join stub to avoid loading
excluded utility dependencies. Toaster renders its real mapping logic against
mocked `useToast` and toast component boundaries because those dependencies are
excluded by another open PR. The tests verify Toaster's content and prop
delegation, not those dependencies' internal close, timer, portal, or animation
behavior. The close mock supplies a query label only for finding its placement.
Progress uses the real Radix implementation. Targeted indicator-transform and
filled-star state assertions are used; there are no CSS snapshots.

## Validation evidence

The focused run has 39 cases: 35 ordinary passes and 4 named expected failures
covering three defect types, with zero skipped and zero snapshots. Jest reports
all 39 passed while the four `test.failing` cases reproduce their defects.
Every gap case also failed its intended ordinary assertion in a separate probe
run. Raw proofs are retained in lane state; temporary probe copies are removed.

Focused ESLint and scoped TypeScript pass with zero diagnostics. All five
target source modules reach 100% statements, lines, functions, and branches in
the focused run, including the defect probes. This does not claim a complete
browser, assistive-technology, visual, application build, or full-suite check.

## KNOWN GAP defects

1. Emoji image failure state persists when `e` changes. A later emoji stays in
   text fallback even if its separate image could load. One expected failure.
2. Progress removes `value` before passing props to Radix Root. Numeric progress
   has no current-value ARIA attribute or formatted value label, and completing
   the task leaves the primitive indeterminate. Two expected failures.
3. Read-only StarRating uses opacity to show the current value but supplies no
   accessible selected state or announced current rating. The probe accepts
   several valid selection/value representations or readable current-value
   text without prescribing a single widget design. One expected failure.

Each gap test asserts the desired behavior. Production sources are unchanged.

## Needs decision

None. Fixes are outside this coverage package.
