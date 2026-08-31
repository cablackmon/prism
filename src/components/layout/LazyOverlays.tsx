'use client';

import dynamic from 'next/dynamic';

const Screensaver = dynamic(
  () => import('@/components/screensaver/Screensaver').then((m) => ({ default: m.Screensaver })),
  { ssr: false }
);
const AwayModeOverlay = dynamic(
  () =>
    import('@/components/away-mode/AwayModeOverlay').then((m) => ({ default: m.AwayModeOverlay })),
  { ssr: false }
);
const BabysitterModeOverlay = dynamic(
  () =>
    import('@/components/babysitter-mode/BabysitterModeOverlay').then((m) => ({
      default: m.BabysitterModeOverlay,
    })),
  { ssr: false }
);
const VoiceAssistantOverlay = dynamic(
  () =>
    import('@/components/voice/VoiceAssistantOverlay').then((m) => ({
      default: m.VoiceAssistantOverlay,
    })),
  { ssr: false }
);

export function LazyOverlays() {
  return (
    <>
      <BabysitterModeOverlay />
      <AwayModeOverlay />
      <Screensaver />
      <VoiceAssistantOverlay />
    </>
  );
}
