import { GpuCapabilityView } from '@/components/diagnostics/GpuCapabilityView';

/**
 * GPU capability gate for the NOX hologram avatar (NOX-11768, Phase 0).
 *
 * Unlinked and unindexed: it is reachable only by typing the URL, and — like
 * every other non-public path — the household wall in `src/middleware.ts`
 * gates it. See `src/__tests__/middleware.test.ts` for that coverage.
 */
export const metadata = {
  title: 'GPU capability',
  description: 'Reports GPU adapter capability and translucent-mesh frame rates for this device.',
  robots: { index: false, follow: false },
};

export default function GpuDiagnosticsPage() {
  return <GpuCapabilityView />;
}
