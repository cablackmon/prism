export type CalendarObject = { url: string; data?: string; etag?: string };
export type Operation = { name: string; detail?: unknown };
export type EventRecord = {
  properties: Record<string, unknown>;
  components: EventRecord[];
};
export type RunTrace = {
  calls: Operation[];
  logs: string[];
  errors: string[];
  envReads: string[];
  components: EventRecord[];
  pauses: { stage: string; calls: string[] }[];
  exit?: number;
  error?: string;
  helper?: string;
  done?: boolean;
};
export type Options = {
  missingArg?: boolean;
  noSource?: boolean;
  noCalendar?: boolean;
  calendarUrl?: string;
  firstDataMissing?: boolean;
  config?: null | { serverUrl?: string; server_url?: string };
  fail?: string;
  endFails?: boolean;
  responseFailure?: 'create' | 'update' | 'delete';
  location?: string | null;
  readback?: 'url' | 'data';
  missingRead?: 1 | 2;
  readData?: 'missing' | 'no-summary' | 'stale' | 'unrelated' | 'folded';
  finalRead?: 'present-url' | 'present-data' | 'empty';
  defer?: string;
  copies?: number;
  timeOffset?: number;
  helper?: 'event' | 'decrypt';
  optionalFields?: boolean;
  forbiddenProbe?: string;
};
export type Result = {
  runs: RunTrace[];
  collisions: number;
  status: number;
};
