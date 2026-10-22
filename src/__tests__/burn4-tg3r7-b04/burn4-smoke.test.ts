import { loadSpec } from './burn4-harness';

const cases = [
  { name: 'health endpoint returns ok', route: '/api/health', valid: { status: 'ok' }, invalid: { status: 'degraded' } },
  { name: 'family endpoint returns data', route: '/api/family', valid: { members: [] }, invalid: { members: {} } },
  { name: 'tasks endpoint returns data', route: '/api/tasks', valid: { tasks: [] }, invalid: { tasks: 'wrong' } },
  { name: 'chores endpoint returns data', route: '/api/chores', valid: { chores: [] }, invalid: { chores: null } },
];

describe('smoke callbacks reject unsuccessful responses and malformed data', () => {
  test.each(cases)('$route accepts its documented synthetic response', async ({ name, route, valid }) => {
    const spec = loadSpec('smoke', { responses: { [route]: { data: valid } } });
    await spec.run(name);
    expect(spec.events.map((event) => event.kind)).toEqual([`get:${route}`, `status:${route}`, `json:${route}`]);
  });

  test.each(cases)('$route rejects non-OK status before trying to parse its body', async ({ name, route }) => {
    const spec = loadSpec('smoke', { responses: { [route]: { status: 503, jsonFailure: new Error('Must not parse this body') } } });
    await expect(spec.run(name)).rejects.toThrow('Unexpected value');
    expect(spec.events.some((event) => event.kind === `json:${route}`)).toBe(false);
  });

  test.each(cases)('$route rejects a missing required property', async ({ name, route }) => {
    const spec = loadSpec('smoke', { responses: { [route]: { data: {} } } });
    await expect(spec.run(name)).rejects.toThrow();
  });

  test.each(cases)('$route rejects a wrong state or list shape', async ({ name, route, invalid }) => {
    const spec = loadSpec('smoke', { responses: { [route]: { data: invalid } } });
    await expect(spec.run(name)).rejects.toThrow('Unexpected value');
  });

  test.each(cases)('$route propagates request and JSON failures without swallowing them', async ({ name, route }) => {
    const failedRequest = loadSpec('smoke', { failAt: `get:${route}` });
    await expect(failedRequest.run(name)).rejects.toBe(failedRequest.failure);
    expect(failedRequest.events).toHaveLength(1);
    const failure = new Error('Synthetic malformed response');
    const failedJson = loadSpec('smoke', { responses: { [route]: { jsonFailure: failure } } });
    await expect(failedJson.run(name)).rejects.toBe(failure);
  });

  test.each([['homepage loads', 'main'], ['navigation sidebar is visible', 'nav']] as const)('%s requires its visible landmark and propagates failed navigation', async (name, selector) => {
    const success = loadSpec('smoke');
    await success.run(name);
    expect(success.currentPath).toBe('/');
    const invisible = loadSpec('smoke', { visible: { [selector]: false } });
    await expect(invisible.run(name)).rejects.toThrow('Expected visible locator');
    const failedNavigation = loadSpec('smoke', { failAt: 'goto' });
    await expect(failedNavigation.run(name)).rejects.toBe(failedNavigation.failure);
    expect(failedNavigation.events).toHaveLength(1);
  });
});
