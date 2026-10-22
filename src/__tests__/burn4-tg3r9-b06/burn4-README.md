# Searchable read-only contacts directory

Written basis: `docs/planning.md:38` describes a read-only contacts mirror, and `docs/features/ICLOUD.md:14` names the planned family contacts page. This package adds a standalone browser surface over contacts that the host already has permission to display. It does not parse, import, merge, sync or renormalize contacts.

`Burn4ContactDirectory` renders source filtering, name/email/phone search, result counts, 20-row pages, incomplete-source notices and selected contact details. Native labeled controls, pressed result buttons, unique control/region IDs, a live result status and empty/error states provide keyboard and assistive-technology semantics. A selected contact always comes from current props. Removing or hiding that row clears the selection; invalid replacement data removes the entire prior display and resets local state.

## Host example

```tsx
import { Burn4ContactDirectory } from '../../components/contacts/burn4-contact-directory';

const sources = [{
  schemaVersion: 1,
  sourceId: 'synthetic-household',
  label: 'Household',
  complete: false,
  contacts: [{
    identity: 'opaque-person-1',
    displayName: 'Alex Example',
    emails: ['alex@example.invalid'],
    phones: ['+1 (555) 010-1234'],
  }],
}];

// The host owns authorization, retrieval and snapshot freshness.
<Burn4ContactDirectory sources={sources} />;
```

The `sources` prop deliberately accepts unknown data and fails closed on invalid shape, duplicate source IDs, duplicate identities within a source, control characters or exceeded limits. It accepts the display subset of a normalized snapshot with a caller-supplied `label`. Extra metadata is ignored, including UID, record IDs, notes and photos. Missing optional channel arrays become empty arrays; empty names/channels receive display fallbacks. Original supplied strings, repeated channels and distinct people are preserved. The result is an immutable allowlisted projection, without getters or copies for unsupported fields.

`createContactDirectory`, `searchContactDirectory` and `pageContactDirectory` can also support another read-only view. Selection keys encode the tuple `[sourceId, identity]`, so delimiter-like IDs, identical opaque IDs across books and people sharing a name/phone remain separate. Names sort by NFC/lowercase search key, then exact source ID and exact identity using code-point order; source labels use the same search-key order with exact source-ID ties. Neither the display data nor identity is normalized.

Search trims surrounding query whitespace, uses NFC/lowercase literal substrings for name/email/phone, and additionally compares ASCII digits for queries containing only digits and common phone punctuation/whitespace. It performs no regular-expression, fuzzy, country-code or email-equivalence inference. Source labels, IDs and unsupported fields are not searchable. A punctuation-only query has no digits wildcard. Source filtering uses a nullable source ID, with no reserved source-ID strings.

Limits are exported as `CONTACT_DIRECTORY_LIMITS`: 16 sources, 1,000 contacts per source, 4,000 total contacts, 50 channels of each kind per contact, 500 code units per name/channel, 200 per source ID/query, 100 per source label, 1,000 per opaque identity, and 1,000,000 total code units across supported supplied strings. There are at most 20 result rows per page. Direct invalid page/query/filter requests raise `ContactDirectoryError` with a fixed code and no supplied values. Large fixtures are unnecessary to check these boundaries.

## Focused validation

Run from this package's worktree with the shared installed dependency directory temporarily linked as `node_modules`:

```sh
timeout 180s node --max-old-space-size=1024 node_modules/jest/bin/jest.js --config src/__tests__/burn4-tg3r9-b06/burn4-jest.config.cjs --runInBand --no-cache --runTestsByPath src/__tests__/burn4-tg3r9-b06/burn4-contact-directory.test.ts src/__tests__/burn4-tg3r9-b06/burn4-contact-directory-ui.test.tsx
timeout 180s node --max-old-space-size=1024 node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r9-b06/burn4-tsconfig.json --noEmit --incremental false
timeout 180s node --max-old-space-size=1024 node_modules/eslint/bin/eslint.js --no-config-lookup --no-ignore --config src/__tests__/burn4-tg3r9-b06/burn4-eslint.config.mjs --max-warnings=0 src/lib/burn4-contact-directory.ts src/components/contacts/burn4-contact-directory.tsx src/__tests__/burn4-tg3r9-b06/burn4-contact-directory.test.ts src/__tests__/burn4-tg3r9-b06/burn4-contact-directory-ui.test.tsx src/__tests__/burn4-tg3r9-b06/burn4-jest.config.cjs src/__tests__/burn4-tg3r9-b06/burn4-eslint.config.mjs
```

The owned Jest config uses only explicit package tests and an explicit owned tsconfig path. It imports no root config, setup, preset, app runtime or parser. Strict scoped TypeScript covers both runtime files and both tests. All fixtures are synthetic and offline. Test counts and exact-head evidence are recorded in the PR and lane result after execution.

## Limits

No existing app route, navigation, authentication, provider, persistence, import pipeline or earlier burn module is wired or executed. The host supplies authorized current snapshots and their completeness flags. The UI cannot certify live synchronization or permissions. There are no edit/delete/merge/export actions, external links, clipboard access, call/email launch, network requests, images or background storage.

The display subset is name, email, phone and source label. No addresses, birthdays, organizations, custom channel labels or photos are modeled. Tests establish model behavior and React/jsdom rendering, not browser layout, physical keyboard activation, screen-reader performance, real-device behavior or actual iCloud compatibility. No full suite or production build is claimed. KNOWN GAP defects: none found. Needs-decision: none within this standalone scope.
