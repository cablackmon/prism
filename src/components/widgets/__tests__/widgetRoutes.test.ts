import { getWidgetRoute, WIDGET_REGISTRY, WIDGET_ROUTE_MAP } from '../widgetRegistry';

describe('widget page routes', () => {
  it('classifies every registered widget as a page route or explicit no-op', () => {
    expect(Object.keys(WIDGET_ROUTE_MAP).sort()).toEqual(Object.keys(WIDGET_REGISTRY).sort());

    for (const widgetId of Object.keys(WIDGET_REGISTRY)) {
      const route = WIDGET_ROUTE_MAP[widgetId as keyof typeof WIDGET_ROUTE_MAP];
      expect(route === null || route.startsWith('/')).toBe(true);
    }
  });

  it('maps widgets to their full-function pages', () => {
    expect(WIDGET_ROUTE_MAP).toEqual({
      clock: null,
      weather: null,
      calendar: '/calendar',
      tasks: '/tasks',
      messages: '/messages',
      chores: '/chores',
      shopping: '/shopping',
      meals: '/meals',
      birthdays: '/calendar',
      photos: '/photos',
      points: '/goals',
      wishes: '/wishes',
      busTracking: null,
      travel: '/travel',
    });
  });

  it('fails closed for an unknown widget id', () => {
    expect(getWidgetRoute('unknown-widget')).toBeNull();
  });
});
