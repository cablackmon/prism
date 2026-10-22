export type ScenarioCase = {
  name: string;
  snapshot: string;
  path: string;
  theme: 'light' | 'dark';
  login: boolean;
  masks: boolean;
  perfMode?: boolean;
  calendar?: { viewType: string; displayMode: string; weekCount: number };
  viewport?: { width: number; height: number };
  modal?: { click: string; selector: string };
  section?: string;
  subsection?: boolean;
  settle?: number;
};

export const scenarioCases: ScenarioCase[] = [];
for (const theme of ['light', 'dark'] as const) {
  const base = { theme, login: true, masks: false };
  scenarioCases.push(
    { ...base, name: `dashboard - ${theme}`, snapshot: `dashboard-${theme}.png`, path: '/', masks: true },
    {
      ...base, name: `dashboard perf-mode - ${theme}`, snapshot: `dashboard-perf-${theme}.png`,
      path: '/', masks: true, perfMode: true,
    },
    { ...base, name: `calendar - ${theme}`, snapshot: `calendar-${theme}.png`, path: '/calendar' },
    { ...base, name: `settings - ${theme}`, snapshot: `settings-${theme}.png`, path: '/settings' },
    {
      ...base, name: `settings - integrations section - ${theme}`,
      snapshot: `settings-integrations-${theme}.png`, path: '/settings', section: 'integrations', settle: 1200,
    },
  );
  for (const [viewType, displayMode, label] of [
    ['month', 'inline', 'month-inline'],
    ['month', 'cards', 'month-cards'],
    ['multiWeek', 'cards', 'multiweek-2w-cards'],
    ['week', 'cards', 'week-cards'],
    ['agenda', 'cards', 'agenda-cards'],
  ] as const) {
    scenarioCases.push({
      ...base, name: `calendar ${label} - ${theme}`, snapshot: `calendar-${label}-${theme}.png`,
      path: '/calendar', masks: true, calendar: { viewType, displayMode, weekCount: 2 },
    });
  }
  scenarioCases.push({
    ...base, name: `AddEventModal - ${theme}`, snapshot: `add-event-modal-${theme}.png`,
    path: '/calendar', settle: 400, modal: { click: 'button:has-text("Add Event")', selector: 'text=/Add Event|New Event/i' },
  });
  for (const section of ['family', 'display', 'integrations']) {
    scenarioCases.push({
      ...base, name: `settings/${section} - ${theme}`, snapshot: `settings-${section}-${theme}.png`,
      path: '/settings', section, subsection: true,
    });
  }
  scenarioCases.push(
    {
      ...base, name: `mobile calendar agenda - ${theme}`, snapshot: `mobile-calendar-agenda-${theme}.png`,
      path: '/calendar', masks: true, viewport: { width: 390, height: 844 },
      calendar: { viewType: 'agenda', displayMode: 'inline', weekCount: 2 },
    },
    {
      ...base, name: `login landing page - ${theme}`, snapshot: `login-landing-${theme}.png`,
      path: '/', masks: true, login: false, settle: 600,
    },
    {
      ...base, name: `PIN modal - ${theme}`, snapshot: `pin-modal-${theme}.png`, path: '/', login: false, settle: 400,
      modal: { click: 'button[aria-label="Log in"]', selector: '.z-\\[10001\\]' },
    },
  );
}
