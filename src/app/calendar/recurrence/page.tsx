'use client';

import { useMemo } from 'react';
import AllDayRecurrenceBuilder, { type DownloadCapabilities } from '../../../components/calendar/burn4-all-day-recurrence-builder';

/** Direct local tool: no application data, provider or persistence connection. */
export default function CalendarRecurrencePage() {
  const capabilities = useMemo<DownloadCapabilities>(() => ({
    createBlob: (parts, options) => new Blob(parts, options),
    createObjectURL: blob => URL.createObjectURL(blob),
    revokeObjectURL: url => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement('a'),
    appendAnchor: anchor => document.body.appendChild(anchor as HTMLAnchorElement),
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: handle => window.clearTimeout(handle as number),
  }), []);
  return <main>
    <h1 className="p-4 text-2xl font-semibold">All-day calendar recurrence</h1>
    <AllDayRecurrenceBuilder downloadCapabilities={capabilities} createIdentity={() => ({
      uid: crypto.randomUUID(),
      dtstamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    })} />
  </main>;
}
