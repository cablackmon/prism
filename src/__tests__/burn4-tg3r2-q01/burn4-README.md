# Goal reorder request and transaction coverage

These tests execute the unchanged POST handler in
`src/app/api/goals/reorder/route.ts`. They retain real NextRequest parsing,
NextResponse responses and Zod validation. Authentication, database, schema,
Drizzle predicates, cache invalidation and logging use isolated local fakes.
No service, filesystem data, environment value or real family data is used.

The 27 cases include 25 ordinary passes and two confirmed expected failures.
They cover authentication response forwarding, permission checks before body
parsing, authentication rejection, nine invalid body shapes, extra field
stripping, unexpected request stream failure, one-based update order, shared
timestamps, subset writes, sequential awaiting, cache completion, failures at
each update position, transaction startup and commit rejection, and cache
failure after a successful database commit.

The in-memory transaction fake stages writes and exposes commit and rollback
events. Assertions check that the route places and awaits its writes inside
that callback and stops on failure. They do not establish PostgreSQL or Redis
behavior. The cache failure case records the current boundary: the route
returns 500 after database writes have committed.

## Run focused checks

Run from the repository root after installing dependencies:

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/__tests__/burn4-tg3r2-q01/burn4-goal-reorder.test.ts
node node_modules/eslint/bin/eslint.js src/__tests__/burn4-tg3r2-q01/burn4-goal-reorder.test.ts --max-warnings 0
node node_modules/typescript/bin/tsc --project src/__tests__/burn4-tg3r2-q01/burn4-tsconfig.json --noEmit
```

The TypeScript project checks the new test and its imported route with
transitive source dependencies. It uses strict checking, no emit and no
incremental cache. Jest's repository transform disables its own diagnostics,
so the separate TypeScript command is required.

## KNOWN GAP list

- Malformed JSON is reported as a server error. A real request containing
  `{"order":` returns 500 instead of the client error 400 and starts no
  transaction.
- Duplicate goal IDs are accepted and overwrite an earlier priority. The
  input `[A, B, A]` returns 200, writes A twice and leaves A at priority 3,
  B at priority 2, and no goal at priority 1 in the fixture. The expected
  behavior rejects the duplicate ordering with 400 before mutations.

Both cases use `test.failing`. A disposable test copy replacing only
`test.failing` with `test` was run separately: all 25 ordinary cases passed
and exactly the two desired-behavior assertions failed. The probe file is
removed and is not part of this package.

## Needs-decision list

None. Production behavior is unchanged. The two confirmed defects remain for
review and source fixes.
