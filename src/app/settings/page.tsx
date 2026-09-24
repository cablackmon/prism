/**
 *
 * The settings page for configuring Prism.
 *
 * SECTIONS:
 * - Family Members: Add, edit, remove family members
 * - Display: Theme, layout preferences
 * - Integrations: Connect external calendars, services
 * - Security: PIN management, session settings
 * - About: Version info, help links
 *
 */

import { Suspense } from 'react';
import { SettingsPinGate } from './SettingsPinGate';

/**
 * PAGE METADATA
 */
export const metadata = {
  title: 'Settings',
  description: 'Configure your KYST family dashboard.',
};

/**
 * SETTINGS PAGE COMPONENT
 */
export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsPinGate />
      </Suspense>
    </main>
  );
}

/**
 * SETTINGS SKELETON
 */
function SettingsSkeleton() {
  return (
    <div className="flex h-screen flex-col p-4">
      <div className="mb-6 h-8 w-32 animate-pulse rounded bg-muted" />
      <div className="max-w-2xl space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-6 w-40 animate-pulse rounded bg-muted" />
            <div className="h-24 animate-pulse rounded bg-muted/50" />
          </div>
        ))}
      </div>
    </div>
  );
}
