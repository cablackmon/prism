# Offline contacts mirror preparation

`scripts/burn4-contacts-import.mjs` prepares caller-supplied records for the read-only contacts mirror backlog in `docs/planning.md:38` and `docs/features/ICLOUD.md:14`. It does not fetch contacts, authenticate, persist a mirror, or deliver the planned contacts page.

```js
import { prepareContactsMirror } from './scripts/burn4-contacts-import.mjs';

const report = prepareContactsMirror({
  schemaVersion: 1,
  sourceId: 'synthetic-address-book',
  complete: true,
  records: [{
    recordId: 'synthetic-resource-a',
    format: 'contact',
    contact: {
      uid: 'synthetic-uid-a',
      displayName: 'Example Person',
      emails: ['example@example.invalid'],
      phones: ['+1 555 0100'],
    },
  }],
});
```

A vCard record instead supplies `{recordId, format: 'vcard', vcardText}`. Each text contains one VCARD with version 3.0 or 4.0. The existing `ical.js` dependency handles syntax, folding, escapes, and parameters. The adapter extracts UID, FN, EMAIL, and TEL string values. It requires one usable FN and at most one UID. It is a supported-field adapter, not a complete vCard standards validator. Unknown fields are syntactically parsed by the dependency but excluded from the model; URI values are never resolved. TEL URI text such as `tel:+15550100` is retained literally.

Text uses Unicode NFC and surrounding whitespace trimming. Internal spaces and case remain meaningful. Emails and phones are deduplicated exactly after normalization and sorted by code-point order. No phone-country inference, email-equivalence inference, fuzzy matching, or cross-source identity is performed.

An identity encodes `[sourceId, 'uid', uid]`, or `[sourceId, 'record', recordId]` when UID is absent. The explicit stable record ID is required and must not be an array index. Identical supported values with the same UID coalesce, keeping sorted origin record IDs. Conflicting values for an identity, repeated record IDs, invalid supported fields, and malformed cards are quarantined. A malformed optional channel rejects the whole record so invalid data cannot masquerade as intentional field clearing. Recoverable UIDs and known prior origin IDs block matching valid-looking duplicates from ordinary comparison.

The report contains:

- `snapshot`: normalized accepted contacts, source, schema version, and `complete`. An incomplete snapshot is only the accepted subset and must not replace a full mirror.
- `issues` and `conflicts`: quarantine diagnostics without raw parser error content.
- `diff`: comparison status, added contacts, changed contacts with field names and before/after values, unchanged identities, missing prior contacts, and missing-suppression reasons.

Supply a prior generated `snapshot` as `previous` to compare. The prior source must match and its normalized identities and record origins must be unambiguous. An invalid prior snapshot throws `ContactsInputError`, rather than fabricating an empty baseline. Current valid contacts can be compared even when the current export is partial. Quarantined identities receive no ordinary changed/unchanged classification. Missing contacts appear only when the current export is explicitly complete, no record was rejected or conflicted, and the prior snapshot is complete. Without a prior snapshot, no changes are inferred.

All results are read-only proposals. There is no apply, merge, provider write, automatic deletion, database access, or mutation of input objects. Empty or omitted optional channel arrays on an otherwise valid record intentionally mean no channels; malformed supplied arrays are different and cause quarantine.

Bounds: 1,000 current or previous contacts, 256 KiB per vCard, 50 entries per channel list, 200 characters for source/record IDs, 500 characters for UID/name, and 1,000 characters per channel. The CLI limits the explicit UTF-8 JSON file to 2 MiB. Limits do not imply that email or phone text has been validated for deliverability or dialing.

Run the optional adapter with one explicit local JSON file:

```sh
node scripts/burn4-contacts-import.mjs synthetic-input.json
```

It reads that regular file only and writes JSON to stdout. Usage, file, JSON, and envelope failures return status 1 with a static error code on stderr. Per-record problems return status 0 with a structured incomplete report, so callers must inspect completeness and diagnostics. `runContactsImportCli(args, io)` accepts injected read/output/error functions. Tests use those fakes; direct process entry and operating-system file adapters are outside claimed subprocess coverage. No environment configuration or file discovery is used.

Scope limits: no live iCloud/CardDAV synchronization, provider payload parity, UI, persistence, concatenated VCF recovery, addresses, groups, organizations, photos, notes, birthdays, custom extensions, or label model. No unchanged-source defect is claimed, and the KNOWN GAP list is empty.

Focused validation from the package worktree uses only these owned paths:

```sh
timeout 60s node --test --test-concurrency=1 --test-reporter=tap src/__tests__/burn4-tg3r8-b06/burn4-contacts-import.test.mjs src/__tests__/burn4-tg3r8-b06/burn4-contacts-cli.test.mjs
timeout 60s node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --noUncheckedIndexedAccess --types node --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck scripts/burn4-contacts-import.mjs src/__tests__/burn4-tg3r8-b06/burn4-contacts-import.test.mjs src/__tests__/burn4-tg3r8-b06/burn4-contacts-cli.test.mjs
timeout 60s node node_modules/eslint/bin/eslint.js --no-config-lookup --no-ignore --config src/__tests__/burn4-tg3r8-b06/burn4-eslint.config.mjs --max-warnings 0 scripts/burn4-contacts-import.mjs src/__tests__/burn4-tg3r8-b06/burn4-contacts-import.test.mjs src/__tests__/burn4-tg3r8-b06/burn4-contacts-cli.test.mjs src/__tests__/burn4-tg3r8-b06/burn4-eslint.config.mjs
```

Strict checkJs includes new runtime and both tests. The declaration-only skip flag accommodates installed dependency declarations. Root repository configs, existing birthday helpers, existing tests, and production services are not loaded.
