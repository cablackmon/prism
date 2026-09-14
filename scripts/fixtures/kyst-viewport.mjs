// Synthetic read-only board data shared by local viewport checks.
export const widgets = [
  ['calendar', 0, 0, 30, 16], ['clock', 30, 0, 8, 4],
  ['weather', 38, 0, 10, 4], ['tasks', 30, 4, 18, 12],
  ['chores', 0, 16, 16, 11], ['points', 16, 16, 11, 11],
  ['messages', 27, 16, 21, 11],
].map(([i, x, y, w, h]) => ({ i, x, y, w, h, visible: true }));
const tasks = Array.from({ length: 25 }, (_, i) => ({
  id: `task-${i}`, title: `Task ${i + 1}: a long family reminder that must wrap inside its card`,
  completed: false, priority: 'medium', assignedTo: null, dueDate: null,
}));
export const fixtures = {
  '/api/setup/status': { complete: true }, '/api/settings': { settings: {} },
  '/api/auth/session': { user: null }, '/api/auth/me': { authenticated: false, user: null },
  '/api/family': { members: [] }, '/api/tasks': { tasks },
  '/api/layouts': { layouts: [{ id: 'viewport-fixture', name: 'Board', isDefault: true,
    orientation: 'landscape', fontScale: 150, widgets, screensaverWidgets: [] }] },
  '/api/events': { events: [] }, '/api/calendars': { calendars: [] },
  '/api/calendar-groups': { groups: [] }, '/api/messages': { messages: [] },
  '/api/chores': { chores: [] }, '/api/goals': { goals: [], progress: [], children: [] },
  '/api/points': { points: [] }, '/api/photos': { photos: [] },
  '/api/shopping-lists': { lists: [] }, '/api/meals': { meals: [] },
  '/api/birthdays': { birthdays: [] }, '/api/task-lists': [],
  '/api/recipes': { recipes: [] }, '/api/away-mode': { enabled: false },
  '/api/babysitter-mode': { enabled: false }, '/api/babysitter-info': { items: [] },
};
