/**
 * @jest-environment jsdom
 */

/**
 * The view has one behaviour worth a test on its own: it must actually run.
 *
 * `/diag/gpu` is only ever observed through the kiosk screenshot lane, which
 * can navigate to a URL but cannot click a button, so a page that mounts
 * without starting its benchmark produces a screenshot of nothing and the gate
 * has no numbers.
 *
 * jsdom has no WebGL2 or WebGPU, so both backends report themselves
 * unavailable and the run ends in ESCALATE. That is the correct outcome here —
 * what is under test is that the run reaches an outcome at all.
 */

import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { GpuCapabilityView, REPORT_STORAGE_KEY } from '../GpuCapabilityView';
import * as renderers from '@/lib/diagnostics/gpuRenderers';

// See gpuRenderers.test.ts: jsdom 30 does not expose MessageChannel, which the
// measurement loop uses to yield between frames.
if (typeof globalThis.MessageChannel === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  globalThis.MessageChannel = require('node:worker_threads').MessageChannel;
}

describe('GpuCapabilityView', () => {
  it('completes a run under StrictMode double-mounting', async () => {
    // React 18 StrictMode aborts the first run in the effect's cleanup and calls
    // setup again immediately. Guarded by a boolean that the aborted run had not
    // cleared yet, the replacement returned without starting: the page sat on
    // "Probing adapters…" forever, with the button disabled, and never
    // benchmarked in development.
    render(
      <StrictMode>
        <GpuCapabilityView />
      </StrictMode>
    );

    // `getByText` throws until the node exists, so reaching the assertion is
    // itself the proof the run finished. jest-dom matchers are not set up in
    // this repo, hence the plain truthiness check.
    await waitFor(() => expect(screen.getByText('Benchmark complete')).toBeTruthy(), {
      timeout: 40_000,
    });
  }, 60_000);

  it('publishes nothing when the run was cancelled before the report was assembled', async () => {
    // The round-4 P2, taken at the boundary it actually costs something: the
    // publish. `measureRun` now throws after its closing readback, which is what
    // closes the hole in practice — but that check lives one module away, and the
    // view's own contract is that a cancelled run writes neither React state nor
    // localStorage. Asserted here by making `runBackend` do the one thing the bug
    // required: resolve a complete-looking report *after* the signal aborted.
    //
    // This is the scenario, not a contrivance: an abort landing during the final
    // resolution's readback is precisely a `runBackend` that resolves normally
    // after cancellation, and it was reachable because the view re-checked the
    // signal nowhere between the backend loop and `setItem`.
    window.localStorage.removeItem(REPORT_STORAGE_KEY);

    // An object rather than a `let`: TypeScript cannot see the assignment inside
    // the mock callback and narrows a reassigned local to `never` at the read.
    const seen: { signal: AbortSignal | null } = { signal: null };
    const spy = jest
      .spyOn(renderers, 'runBackend')
      .mockImplementation(async (factory, _mesh, _resolutions, _mountCanvas, _onRunComplete, signal) => {
        seen.signal = signal ?? null;
        // Resolves only once cancelled, so the view is guaranteed to be holding a
        // finished-looking report from an abandoned run.
        await new Promise<void>((resolve) => {
          if (signal?.aborted) return resolve();
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return {
          backend: factory.backend,
          available: true,
          error: null,
          runs: [],
          benchmarkedAdapter: 'stub adapter',
          readbackControl: 'untested',
        };
      });

    try {
      const { unmount } = render(<GpuCapabilityView />);
      // Wait until the run is genuinely inside `runBackend`; unmounting earlier
      // would exercise one of the pre-existing entry guards instead, and the test
      // would pass without the publish path ever being reached.
      await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 40_000 });

      unmount();
      // Two macrotask turns: one for the abort listener to resolve, one for the
      // view's continuation to reach the publish block.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Guards the anchor: if the signal never aborted, the view was not in the
      // state this test is about and the localStorage assertion below would pass
      // for the wrong reason.
      expect(seen.signal?.aborted).toBe(true);
      expect(window.localStorage.getItem(REPORT_STORAGE_KEY)).toBeNull();
    } finally {
      spy.mockRestore();
      window.localStorage.removeItem(REPORT_STORAGE_KEY);
    }
  }, 60_000);
});
