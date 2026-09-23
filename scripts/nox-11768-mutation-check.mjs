/**
 * Mutation receipts for the guards added in response to the Codex review of
 * PR #20 (NOX-11768).
 *
 * Each entry reverts one fix to the behaviour Codex flagged, re-runs the
 * diagnostics suite, and records which tests failed. A guard whose revert keeps
 * the suite green is not tested, however many assertions surround it.
 *
 * Two rules this harness exists to enforce, both learned the hard way:
 *   - There is an unmutated baseline. Grepping for failures without one scores
 *     a broken sandbox as a perfect kill rate.
 *   - A mutant that does not compile is scored `void`, not `killed`. A
 *     typecheck error fails every test for reasons unrelated to the guard.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BENCH = 'src/lib/diagnostics/gpuBenchmark.ts';

/** Each mutation names the Codex finding it reverts and the guard it empties. */
const MUTATIONS = [
  {
    id: 'P1-fallback-validity',
    finding: 'Validate WebGL2 before selecting the fallback',
    file: BENCH,
    from: `  const webgl2Verdict = evaluateBackend('WebGL2', webgl2);`,
    to:
      `  const webgl2Verdict = evaluateBackend('WebGL2', { ...webgl2, ` +
      `measurementFenced: true, renderedBlank: false, resolutionStatus: 'matched', ` +
      `sampleInvalidReason: null });`,
    note: 'restores fps-only selection of the WebGL2 fallback',
  },
  {
    id: 'P1-clamped-resolution',
    finding: 'Verify rendering at the measured resolution',
    file: BENCH,
    from: `  return actual.width >= requested.width && actual.height >= requested.height
    ? 'matched'
    : 'clamped';`,
    to: `  return 'matched';`,
    note: 'stops noticing a drawing buffer the driver shrank',
  },
  {
    id: 'P2-zero-readback',
    finding: 'Treat known all-zero readbacks as unavailable',
    file: BENCH,
    // Re-anchored after round 2 restructured `classifyReadback`. Removing the
    // all-zero branch now means a black frame is `blank` unconditionally, which
    // is the original defect: a healthy backend vetoed by a broken readback.
    from: `    if (control === 'broken') {`,
    to: `    if (false as boolean) {`,
    note: 'calls a SwiftShader all-zero readback a genuinely blank canvas',
  },
  {
    id: 'P2-hidden-tab',
    finding: 'Exclude visibility-interrupted runs from the decision',
    file: BENCH,
    from: `    sampleInvalidReason: match.interruptedByVisibilityChange
      ? 'the tab was hidden during the run, which stalls the frame loop and invalidates the sample'
      : null,`,
    to: `    sampleInvalidReason: null,`,
    note: 'feeds a run measured behind a hidden tab into the gate',
  },
  // --- round 2 (review at 4fef46a) ---------------------------------------
  {
    id: 'P1-credit-unproven-black',
    finding: 'Reject all-zero frames unless readback failure is independently proven',
    file: BENCH,
    from: `    if (control === 'broken') {`,
    to: `    if (control === 'broken' || control === 'untested') {`,
    note: 'restores crediting every all-zero frame, proven or not',
  },
  {
    id: 'P1-control-defaults-permissive',
    finding: 'Reject all-zero frames unless readback failure is independently proven',
    file: BENCH,
    // The fail-closed default is a separate guard from the branch above: with
    // the branch intact, a permissive default still credits every backend whose
    // control never ran.
    from: `  control: ReadbackControl = 'untested'`,
    to: `  control: ReadbackControl = 'broken'`,
    note: 'makes an unprobed backend credit its own black frames',
  },
  {
    id: 'P1-control-assumes-working',
    finding: 'Reject all-zero frames unless readback failure is independently proven',
    file: BENCH,
    from: `  if (uniqueColors === 0 || flatColor === null) return 'broken';`,
    to: `  if (uniqueColors === 0 || flatColor === null) return 'working';`,
    note: 'treats a control that returned no pixels as proof readback works',
  },
];

function runSuite() {
  try {
    const out = execSync('npx jest src/lib/diagnostics --silent 2>&1', {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { out, failed: 0 };
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    const m = out.match(/Tests:\s+(\d+) failed/);
    return { out, failed: m ? Number(m[1]) : -1 };
  }
}

function typechecks() {
  try {
    execSync('npx tsc --noEmit 2>&1', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function failedTestNames(out) {
  return [...out.matchAll(/✕\s+(.+)/g)].map((m) => m[1].trim());
}

console.log('=== baseline (unmutated) ===');
const baseline = runSuite();
const basePassed = baseline.out.match(/Tests:\s+(?:.*?)(\d+) passed/);
if (baseline.failed !== 0) {
  console.error(`BASELINE IS NOT GREEN (${baseline.failed} failing). Mutation scores are void.`);
  process.exit(1);
}
console.log(`baseline green: ${basePassed ? basePassed[1] : '?'} passed\n`);

const results = [];
for (const mutation of MUTATIONS) {
  const original = readFileSync(mutation.file, 'utf8');
  if (!original.includes(mutation.from)) {
    results.push({
      ...mutation,
      verdict: 'VOID',
      detail: 'anchor not found — mutation not applied',
    });
    console.log(`VOID   ${mutation.id} — anchor not found`);
    continue;
  }
  writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
  try {
    if (!typechecks()) {
      results.push({ ...mutation, verdict: 'VOID', detail: 'mutant does not typecheck' });
      console.log(`VOID   ${mutation.id} — mutant does not typecheck`);
      continue;
    }
    const mutated = runSuite();
    const names = failedTestNames(mutated.out);
    if (mutated.failed > 0) {
      results.push({ ...mutation, verdict: 'KILLED', failed: mutated.failed, tests: names });
      console.log(`KILLED ${mutation.id} — ${mutated.failed} test(s) fail`);
      for (const n of names) console.log(`         ✕ ${n}`);
    } else {
      results.push({ ...mutation, verdict: 'SURVIVED', detail: 'suite stayed green' });
      console.log(`SURVIVED ${mutation.id} — suite stayed green. THE GUARD IS UNTESTED.`);
    }
  } finally {
    writeFileSync(mutation.file, original);
  }
}

console.log('\n=== restored baseline ===');
const restored = runSuite();
console.log(restored.failed === 0 ? 'baseline green again' : `RESTORE FAILED (${restored.failed})`);

const killed = results.filter((r) => r.verdict === 'KILLED').length;
console.log(`\n${killed}/${MUTATIONS.length} mutations killed`);
writeFileSync('proof/nox-11768/mutation-receipts.json', JSON.stringify(results, null, 2));
process.exit(killed === MUTATIONS.length && restored.failed === 0 ? 0 : 1);
