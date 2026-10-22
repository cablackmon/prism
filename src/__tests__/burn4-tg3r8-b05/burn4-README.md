# Explicit-input notification badges

`scripts/burn4-notification-badges.mjs` exports `planNotificationBadges(input)` and `createNotificationBadgeController(ports, options)`. The controller actually invokes injected badge functions and a synchronous fallback renderer. Importing the module performs no work.

Written basis: `docs/features/MOBILE.md:194-196` and `docs/planning.md:72` leave PWA badges for unapproved chores and unread messages planned. The module supplies policy and a callable delivery boundary. It does not activate badges in Prism's current UI, provider, or service worker.

## Inputs and policy

All time is supplied as nonnegative safe integer milliseconds in `nowMs` and record timestamps. Each snapshot supplies `status`, `complete`, `forUserId`, and `records`. The maximum is 10,000 records per source, including duplicates, and 256 code units per ID. An over-limit or malformed source becomes unknown rather than being silently truncated. Invalid top-level context suppresses personal attention.

```js
const input = {
  schemaVersion: 1,
  nowMs: 1_000,
  viewer: { id: 'parent-a', role: 'parent' },
  mode: 'normal',
  messages: {
    status: 'ready', complete: true, forUserId: 'parent-a',
    records: [{
      id: 'message-a', authorId: 'parent-b', createdAtMs: 100,
      expiresAtMs: null, readByViewer: false,
    }],
  },
  completions: {
    status: 'ready', complete: true, forUserId: 'parent-a',
    records: [{
      id: 'completion-a', choreId: 'chore-a', completedAtMs: 100,
      requiresApproval: true, approvedById: null, approvedAtMs: null,
    }],
  },
};
```

Parents receive pending approval records plus unread messages. Children receive unread messages only; the completion payload is not inspected for a child. Logged-out and guest viewers, and `away` or `babysitter` modes, receive no personal counts. These visibility choices extend the parent approval and message privacy rules described in `docs/HELP.md:31-44` and `docs/features/MESSAGES.md:154`.

A completion counts if it requires approval, is not future-completed, and has neither approval marker. Either `approvedById` or `approvedAtMs` excludes it, including an approval whose user was subsequently removed. Distinct completion IDs for the same chore count separately. Due dates, points, and list display state do not determine approval.

A message counts if `readByViewer` is explicitly false, its author is another viewer, its creation time is not in the future, and it has no expiry or an expiry strictly greater than `nowMs`. Exact duplicate IDs collapse; conflicting duplicates make that source unknown. Message and completion IDs use separate namespaces. Presentation flags and ordering do not change counts.

The self-authored exclusion, personal parent/child icon scope, completion-based count, and ignored edit/pin/importance metadata are proposed attention policies for this new boundary. They are not claimed as policies already implemented by the app.

## Caller-owned read state and completeness

The current message schema and hook contain no persisted per-viewer receipt state. The caller must supply `readByViewer` for every record and the correct `forUserId`. This module does not infer unread state from timestamps, mark records read, persist receipts, or automatically reset read state on edits. A missing read boolean or another viewer's snapshot produces unknown attention.

`complete: true` is an explicit caller assertion that the snapshot covers the source needed for the attention count. The current paginated messages widget and limited completion history alone do not prove completeness. The controller does not fetch more pages, use an API total as unread count, or treat a partial list as an exact zero.

`planNotificationBadges(input)` returns:

- `readiness`: `exact`, `unknown`, or `suppressed`.
- `ownerId`: validated viewer ID, or null under suppression.
- `counts`: `{ unapprovedChores, unreadMessages, total }` when exact, otherwise null.
- `diagnostics`: bounded code/path pairs without record values or raw exception text.

Parent counts require both relevant sources to be exact. Child counts require only messages. Suppressed plans do not access source payloads. Throwing accessors/proxy reads during unknown-input inspection produce a sanitized suppressed context, so they cannot escape `update()` before privacy cleanup. Inputs are not modified.

## Injected delivery

The host supplies bound native methods and a synchronous fallback renderer. A browser adapter can bind its available badge methods here; no browser globals are read inside this module. The following synthetic host illustrates the callable boundary:

```js
import { createNotificationBadgeController } from './scripts/burn4-notification-badges.mjs';

const host = {
  async setAppBadge(count) { /* apply the supplied native count */ },
  async clearAppBadge() { /* clear the native badge */ },
  renderFallback(state) { /* render exact, unknown, or hidden state */ },
};
const controller = createNotificationBadgeController({
  setAppBadge: (count) => host.setAppBadge(count),
  clearAppBadge: () => host.clearAppBadge(),
  renderFallback: (state) => host.renderFallback(state),
});
await controller.update(input);
await controller.dispose();
```

Native setting requires both `setAppBadge(count)` and `clearAppBadge()`. Either may return void or a promise. Unsupported capability uses visible fallback; a clearer supplied without a setter can still perform privacy cleanup. Missing capability cannot clear native state. A known successful owner/count can be supplied as `options.initialApplied`; it is copied, not retained by reference.

Every update immediately publishes its safe fallback: `exact` with a count, `unknown` with null, or `hidden` with null. Exact successful native delivery then hides fallback. Zero attention uses `clearAppBadge()`, and an already successful identical owner/count avoids redundant native writes. A failed set or clear keeps the current safe fallback and returns a controlled diagnostic. There is no automatic retry timer; a later update can try again.

Unknown same-owner input holds the last successfully applied native state and publishes an unknown fallback without a number. Unknown state after an owner change clears previous native attention where possible. A user change clears before setting the new count. Privacy suppression attempts to clear native state and never exposes the underlying count in fallback, even when clearing fails.

`update()` resolves with `applied`, `fallback`, `held`, `superseded`, or `disposed`, plus controlled diagnostics. `disposed` reports lifecycle completion, not proof that a rejected native clear succeeded. Old update results contain no attention count. Host exception messages are not returned. Fallback renderer throws are caught and diagnosed, but the controller cannot force a failed renderer to change the host UI.

## Async and lifecycle guarantees

One worker serializes native effects. New snapshots supersede old queued work, and the job identity fences completion callbacks. Obsolete updates resolve `superseded`; only the newest live update can publish a completion/failure fallback. Synchronous native throws, promise rejections, and callbacks that reenter `update()` or `dispose()` are handled. Caller input is reduced to a plan immediately, so later mutation of a snapshot does not alter queued work.

An in-flight native call cannot be canceled. Once it settles, the worker corrects native state to the newest desired plan, including privacy clearing. A transient stale native badge remains possible before that correction. A host promise that never settles prevents later serialized native effects and disposal completion; no timeout or cancellation support is invented.

`dispose()` immediately publishes hidden fallback once, prevents future sets/callback publications, waits for outstanding native work, then attempts one final clear. Repeated disposal returns the same promise. Updates after disposal resolve `disposed` without invoking ports. The caller must have one owner for the shared native badge; independent controllers or other writers are not coordinated.

## Scoped verification

The tests use Node built-ins, synthetic IDs/timestamps, explicit per-viewer state, and manually settled promises. They use no app sources, browser, service, filesystem discovery, environment access, network, timers, child processes, or root test/lint/type configs.

```text
timeout 60 node --test --test-reporter=tap --test-concurrency=1 src/__tests__/burn4-tg3r8-b05/burn4-policy.test.mjs src/__tests__/burn4-tg3r8-b05/burn4-controller.test.mjs
timeout 60 ./node_modules/.bin/tsc --allowJs --checkJs --strict --noUncheckedIndexedAccess --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --types node scripts/burn4-notification-badges.mjs src/__tests__/burn4-tg3r8-b05/burn4-policy.test.mjs src/__tests__/burn4-tg3r8-b05/burn4-controller.test.mjs
timeout 60 ./node_modules/.bin/eslint --no-config-lookup --no-ignore --config src/__tests__/burn4-tg3r8-b05/burn4-eslint.config.mjs --max-warnings 0 scripts/burn4-notification-badges.mjs src/__tests__/burn4-tg3r8-b05/burn4-policy.test.mjs src/__tests__/burn4-tg3r8-b05/burn4-controller.test.mjs src/__tests__/burn4-tg3r8-b05/burn4-eslint.config.mjs
```

KNOWN GAP: none asserted in unchanged sources. Integration limits: no current app/provider/service-worker wiring, background execution, persisted receipts, production completeness adapter, browser compatibility validation, host cancellation, or coordination with other badge writers. No full-suite or production behavior pass is claimed.
