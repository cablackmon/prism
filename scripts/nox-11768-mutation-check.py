#!/usr/bin/env python3
"""Mutation receipts for the NOX-11768 round-3 fixes.

Each entry reverts one fix and names the single test that must fail as a
result. Scoring is per test (`jest -t`), not per file: a sibling test's
accidental kill would otherwise hide a fix whose own test cannot see it.

A mutant that fails to *run* is scored `void`, not `killed` — ts-jest is
configured with `diagnostics: false`, so a mutation that breaks the code
outright would still "fail" the test while proving nothing.
"""

import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RENDERERS = "src/lib/diagnostics/gpuRenderers.ts"
BENCH = "src/lib/diagnostics/gpuBenchmark.ts"
VIEW = "src/components/diagnostics/GpuCapabilityView.tsx"

RENDERERS_TEST = "src/lib/diagnostics/__tests__/gpuRenderers.test.ts"
BENCH_TEST = "src/lib/diagnostics/__tests__/gpuBenchmark.test.ts"
VIEW_TEST = "src/components/diagnostics/__tests__/GpuCapabilityView.test.tsx"

MUTANTS = [
    {
        "id": "M1",
        "finding": "P1 control-threw must not prove broken readback",
        "file": RENDERERS,
        "edits": [
            (
                "  } catch {\n    return 'untested';\n  }\n}\n\nexport async function inspectCanvasPixels(",
                "  } catch {\n    return 'broken';\n  }\n}\n\nexport async function inspectCanvasPixels(",
            )
        ],
        "test_file": RENDERERS_TEST,
        "test_name": "reports untested when the control could not be observed at all",
    },
    {
        "id": "M2",
        "finding": "P1 an unconfirmed clear cannot establish broken readback",
        "file": RENDERERS,
        "edits": [
            (
                "    if (verdict === 'broken' && !clearConfirmed) return 'untested';\n",
                "",
            )
        ],
        "test_file": RENDERERS_TEST,
        "test_name": "reports untested when the control drew but its clear never completed",
    },
    {
        "id": "M3",
        "finding": "P1 unreadable canvas creditable only when control proved readback broken",
        "file": BENCH,
        "edits": [
            (
                "  return control === 'broken' ? 'readbackBroken' : 'unverified';",
                "  return 'readbackBroken';",
            )
        ],
        "test_file": BENCH_TEST,
        "test_name": "refuses an unreadable canvas when nothing proved why it could not be read",
    },
    {
        "id": "M4",
        "finding": "P2 the gate reads the control belonging to its own run",
        "file": BENCH,
        "edits": [
            (
                "classifyContentCredit(match.pixelCheck, match.readbackControl)",
                "classifyContentCredit(match.pixelCheck, runs[runs.length - 1].readbackControl)",
            )
        ],
        "test_file": BENCH_TEST,
        "test_name": "reads the control from the same run as the pixel check, not from a sibling",
    },
    {
        "id": "M5",
        "finding": "P1 cancellation propagates instead of becoming report.error",
        "file": RENDERERS,
        "edits": [
            ("    if (isBenchmarkCancelled(runError)) throw runError;\n", "")
        ],
        "test_file": RENDERERS_TEST,
        "test_name": "propagates cancellation instead of returning a partial report",
    },
    {
        "id": "M6",
        "finding": "P2 the control is taken at the measured resolution",
        "file": RENDERERS,
        "edits": [
            (
                "  renderer.resize(resolution.width, resolution.height);",
                "  // MUTANT: probe before the resize, as the pre-fix code effectively did.",
            ),
            (
                "  const readbackControl = await probeReadbackControl(renderer, canvas);",
                "  const readbackControl = await probeReadbackControl(renderer, canvas);\n"
                "  renderer.resize(resolution.width, resolution.height);",
            ),
        ],
        "test_file": RENDERERS_TEST,
        "test_name": "draws the control after each resize, so it validates the measured surface",
    },
    {
        "id": "M7",
        "finding": "P2 StrictMode replacement run actually starts",
        "file": VIEW,
        "edits": [
            (
                "  const run = useCallback(async (signal: AbortSignal) => {\n    if (signal.aborted) return;\n",
                "  const run = useCallback(async (signal: AbortSignal) => {\n"
                "    if (runningRef.current) return;\n    runningRef.current = true;\n",
            ),
            (
                "  const runChainRef = useRef<Promise<void>>(Promise.resolve());",
                "  const runChainRef = useRef<Promise<void>>(Promise.resolve());\n"
                "  const runningRef = useRef(false);",
            ),
            (
                "      setPhase('failed');\n      setStatus('Failed.');\n    }\n  }, []);",
                "      setPhase('failed');\n      setStatus('Failed.');\n"
                "    } finally {\n      runningRef.current = false;\n    }\n  }, []);",
            ),
            (
                "    runChainRef.current = runChainRef.current\n"
                "      .catch(() => {\n"
                "        // A previous run's failure is its own to report; it must not stop the\n"
                "        // next one from starting.\n"
                "      })\n"
                "      .then(() => run(controller.signal));",
                "    void run(controller.signal);",
            ),
        ],
        "test_file": VIEW_TEST,
        "test_name": "completes a run under StrictMode double-mounting",
    },
]


def run_test(test_file: str, test_name: str) -> tuple[bool, str]:
    proc = subprocess.run(
        [
            "npx",
            "jest",
            test_file,
            "-t",
            test_name,
            "--no-cache",
            "--ci",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=600,
    )
    out = proc.stdout + proc.stderr
    return proc.returncode == 0, out


def summarize(out: str) -> str:
    m = re.search(r"Tests:\s+(.*)", out)
    return m.group(1).strip() if m else "no summary line"


def looks_void(out: str) -> bool:
    """A mutant that could not even load proves nothing about the assertion.

    The `Tests:` line is parsed rather than grepped for "0 total": the summary
    block also carries `Snapshots: 0 total`, and matching that scored every
    mutant — including ones that plainly died on their assertion — as void.
    """
    for marker in (
        "Cannot find module",
        "SyntaxError",
        "Your test suite must contain at least one test",
    ):
        if marker in out:
            return True
    tests_line = summarize(out)
    if tests_line == "no summary line":
        return True
    # "1 failed, 1 total" ran; "0 total" did not.
    m = re.search(r"(\d+) total", tests_line)
    return m is None or int(m.group(1)) == 0


def main() -> int:
    results = []

    print("=== BASELINE (unmutated) ===", flush=True)
    for mutant in MUTANTS:
        ok, out = run_test(mutant["test_file"], mutant["test_name"])
        print(f"  {mutant['id']} baseline: {'PASS' if ok else 'FAIL'} — {summarize(out)}")
        if not ok:
            print("    baseline must pass before a kill means anything", flush=True)
            print(out[-3000:])
            return 2

    print("\n=== MUTANTS ===", flush=True)
    for mutant in MUTANTS:
        path = ROOT / mutant["file"]
        backup = path.with_suffix(path.suffix + ".mutbak")
        shutil.copy2(path, backup)
        try:
            source = path.read_text()
            for old, new in mutant["edits"]:
                if old not in source:
                    raise SystemExit(
                        f"{mutant['id']}: anchor not found in {mutant['file']}:\n{old[:200]}"
                    )
                source = source.replace(old, new, 1)
            path.write_text(source)

            ok, out = run_test(mutant["test_file"], mutant["test_name"])
            if looks_void(out):
                verdict = "VOID"
            elif ok:
                verdict = "SURVIVED"
            else:
                verdict = "KILLED"
            results.append(
                {
                    "id": mutant["id"],
                    "finding": mutant["finding"],
                    "test": mutant["test_name"],
                    "verdict": verdict,
                    "summary": summarize(out),
                }
            )
            print(f"  {mutant['id']} {verdict:9s} {mutant['finding']}")
            print(f"      test: {mutant['test_name']}")
            print(f"      {summarize(out)}")
            if verdict != "KILLED":
                print(out[-2500:])
        finally:
            shutil.move(str(backup), str(path))

    # The tree must be byte-identical to where it started.
    diff = subprocess.run(
        ["git", "diff", "--stat", "--", RENDERERS, BENCH, VIEW],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    print("\n=== POST-RUN TREE (vs HEAD, should match the real fix only) ===")
    print(diff.stdout.strip() or "(no diff)")

    killed = sum(1 for r in results if r["verdict"] == "KILLED")
    print(f"\nKILLED {killed}/{len(results)}")
    (ROOT / "nox-11768-mutation-receipts.json").write_text(json.dumps(results, indent=2))
    return 0 if killed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
