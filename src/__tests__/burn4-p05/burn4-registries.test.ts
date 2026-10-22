import {
  getTaskProvider, taskProviders, microsoftTodoProvider, googleTasksProvider,
} from '@/lib/integrations/tasks';
import {
  getShoppingProvider, shoppingProviders, microsoftTodoShoppingProvider,
} from '@/lib/integrations/shopping';
import {
  getWishItemProvider, wishItemProviders, microsoftTodoWishItemProvider,
} from '@/lib/integrations/wish-items';

jest.mock('@/lib/integrations/tasks/microsoft-todo', () => ({
  microsoftTodoProvider: { providerId: 'microsoft_todo', displayName: 'Task fixture', fetchLists: jest.fn() },
}));
jest.mock('@/lib/integrations/tasks/google-tasks', () => ({
  googleTasksProvider: { providerId: 'google_tasks', displayName: 'Google fixture', fetchLists: jest.fn() },
}));
jest.mock('@/lib/integrations/shopping/microsoft-todo', () => ({
  microsoftTodoShoppingProvider: { providerId: 'microsoft_todo', displayName: 'Shopping fixture', fetchLists: jest.fn() },
}));
jest.mock('@/lib/integrations/wish-items/microsoft-todo', () => ({
  microsoftTodoWishItemProvider: { providerId: 'microsoft_todo', displayName: 'Wish fixture', fetchLists: jest.fn() },
}));

beforeEach(() => jest.clearAllMocks());

test('task registry exposes the original provider objects and selects the requested implementation', () => {
  expect(taskProviders).toEqual({ microsoft_todo: microsoftTodoProvider, google_tasks: googleTasksProvider });
  expect(getTaskProvider('microsoft_todo')).toBe(microsoftTodoProvider);
  expect(getTaskProvider('google_tasks')).toBe(googleTasksProvider);
  expect(microsoftTodoProvider.fetchLists).not.toHaveBeenCalled();
  expect(googleTasksProvider.fetchLists).not.toHaveBeenCalled();
});

test('shopping registry exposes and selects its shopping implementation', () => {
  expect(shoppingProviders).toEqual({ microsoft_todo: microsoftTodoShoppingProvider });
  expect(getShoppingProvider('microsoft_todo')).toBe(microsoftTodoShoppingProvider);
  expect(microsoftTodoShoppingProvider.fetchLists).not.toHaveBeenCalled();
});

test('wish registry exposes and selects its wish implementation', () => {
  expect(wishItemProviders).toEqual({ microsoft_todo: microsoftTodoWishItemProvider });
  expect(getWishItemProvider('microsoft_todo')).toBe(microsoftTodoWishItemProvider);
  expect(microsoftTodoWishItemProvider.fetchLists).not.toHaveBeenCalled();
});

test('shared Microsoft identifiers keep task, shopping and wish providers separate', () => {
  expect(getTaskProvider('microsoft_todo')).not.toBe(getShoppingProvider('microsoft_todo'));
  expect(getShoppingProvider('microsoft_todo')).not.toBe(getWishItemProvider('microsoft_todo'));
  expect(getWishItemProvider('google_tasks')).toBeNull();
  expect(getShoppingProvider('google_tasks')).toBeNull();
});

test.each(['', 'unknown-provider', 'MICROSOFT_TODO', ' microsoft_todo', 'microsoft_todo '])(
  'unsupported provider id %j returns the documented missing-provider value without modifying registries', (id) => {
    const original = [Object.entries(taskProviders), Object.entries(shoppingProviders), Object.entries(wishItemProviders)];
    expect(getTaskProvider(id)).toBeUndefined();
    expect(getShoppingProvider(id)).toBeNull();
    expect(getWishItemProvider(id)).toBeNull();
    expect([Object.entries(taskProviders), Object.entries(shoppingProviders), Object.entries(wishItemProviders)]).toEqual(original);
  },
);

test.failing('KNOWN GAP: task registry accepts inherited constructor as a task provider', () => {
  expect(getTaskProvider('constructor')).toBeUndefined();
});

test.failing('KNOWN GAP: shopping registry accepts inherited constructor as a shopping provider', () => {
  expect(getShoppingProvider('constructor')).toBeNull();
});

test.failing('KNOWN GAP: wish registry accepts inherited constructor as a wish provider', () => {
  expect(getWishItemProvider('constructor')).toBeNull();
});
