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

import { GpuCapabilityView } from '../GpuCapabilityView';

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
});
