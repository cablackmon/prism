import { collections, fakePage, loadCleanup, reply } from './burn4-cleanup-harness';

describe.each(collections)('$method selection and response handling', (resource) => {
  const cleanup = loadCleanup();
  const remove = cleanup[resource.method];

  test.each(['wrapped', 'raw'])('deletes from a %s array', async (shape) => {
    const records = [
      { id: 'unrelated', [resource.field]: 'Other fixture' },
      { id: 'matching', [resource.field]: 'Target fixture' },
    ];
    const page = fakePage(shape === 'wrapped' ? { [resource.key]: records } : records);
    await expect(remove(page, 'Target fixture')).resolves.toBe(true);
    expect(page.request.get).toHaveBeenCalledTimes(1);
    expect(page.request.get).toHaveBeenCalledWith(
      resource.path === 'events'
        ? '/api/events?startDate=2025-12-01&endDate=2026-02-28'
        : `/api/${resource.path}`,
    );
    expect(page.request.delete).toHaveBeenCalledTimes(1);
    expect(page.request.delete).toHaveBeenCalledWith(`/api/${resource.path}/matching`);
  });

  test.each(['wrapped', 'raw'])('returns false for an empty %s array', async (shape) => {
    const page = fakePage(shape === 'wrapped' ? { [resource.key]: [] } : []);
    await expect(remove(page, 'Target fixture')).resolves.toBe(false);
    expect(page.request.delete).not.toHaveBeenCalled();
  });

  test('does not delete a nonmatching record', async () => {
    const page = fakePage({ [resource.key]: [{ id: 'other', [resource.field]: 'Other fixture' }] });
    await expect(remove(page, 'Target fixture')).resolves.toBe(false);
    expect(page.request.delete).not.toHaveBeenCalled();
  });

  test('does not treat a differently cased value as a match', async () => {
    const page = fakePage([{ id: 'other', [resource.field]: 'target fixture' }]);
    await expect(remove(page, 'Target fixture')).resolves.toBe(false);
    expect(page.request.delete).not.toHaveBeenCalled();
  });

  test('returns false for a failed list response without parsing it', async () => {
    const response = reply({ [resource.key]: [{ id: 'unsafe', [resource.field]: 'Target' }] }, false);
    const page = fakePage();
    page.request.get.mockResolvedValue(response);
    await expect(remove(page, 'Target')).resolves.toBe(false);
    expect(response.json).not.toHaveBeenCalled();
    expect(page.request.delete).not.toHaveBeenCalled();
  });

  test('returns false when the matching delete response fails', async () => {
    const page = fakePage([{ id: 'matching', [resource.field]: 'Target fixture' }]);
    page.request.delete.mockResolvedValue(reply(undefined, false));
    await expect(remove(page, 'Target fixture')).resolves.toBe(false);
  });

  test('propagates a list request rejection without deletion', async () => {
    const failure = new Error('fixture lookup unavailable');
    const page = fakePage();
    page.request.get.mockRejectedValue(failure);
    await expect(remove(page, 'Target fixture')).rejects.toBe(failure);
    expect(page.request.delete).not.toHaveBeenCalled();
  });

  test('propagates a JSON rejection without deletion', async () => {
    const failure = new Error('fixture response cannot be decoded');
    const response = reply();
    response.json.mockRejectedValue(failure);
    const page = fakePage();
    page.request.get.mockResolvedValue(response);
    await expect(remove(page, 'Target fixture')).rejects.toBe(failure);
    expect(page.request.delete).not.toHaveBeenCalled();
  });

  test('propagates a delete request rejection', async () => {
    const failure = new Error('fixture deletion unavailable');
    const page = fakePage([{ id: 'matching', [resource.field]: 'Target fixture' }]);
    page.request.delete.mockRejectedValue(failure);
    await expect(remove(page, 'Target fixture')).rejects.toBe(failure);
  });

  test.each([null, {}, { unexpected: [] }, { [resource.key]: {} }])(
    'rejects an invalid success payload without deleting: %p',
    async (payload) => {
      const page = fakePage(payload);
      await expect(remove(page, 'Target fixture')).rejects.toThrow();
      expect(page.request.delete).not.toHaveBeenCalled();
    },
  );
});

describe('title and content matching', () => {
  const cleanup = loadCleanup();

  test.each([
    { method: 'deleteTaskByTitle' as const, key: 'tasks' },
    { method: 'deleteEventByTitle' as const, key: 'events' },
  ])('$method deletes the first exact match only', async ({ method, key }) => {
    const page = fakePage({ [key]: [
      { id: 'prefix', title: 'Target fixture extended' },
      { id: 'first', title: 'Target fixture' },
      { id: 'second', title: 'Target fixture' },
    ] });
    await expect(cleanup[method](page, 'Target fixture')).resolves.toBe(true);
    expect(page.request.delete.mock.calls).toEqual([[`/api/${key}/first`]]);
  });

  test('message selection skips missing/null content and chooses the first substring match', async () => {
    const page = fakePage({ messages: [
      { id: 'missing' },
      { id: 'null', message: null },
      { id: 'first', message: 'Before Target fixture after' },
      { id: 'second', message: 'Target fixture' },
    ] });
    await expect(cleanup.deleteMessageByContent(page, 'Target fixture')).resolves.toBe(true);
    expect(page.request.delete.mock.calls).toEqual([['/api/messages/first']]);
  });

  test('a nonempty wrapped collection takes precedence over an unrelated root property', async () => {
    const page = fakePage({ tasks: [{ id: 'chosen', title: 'Target' }], title: 'Target' });
    await expect(cleanup.deleteTaskByTitle(page, 'Target')).resolves.toBe(true);
    expect(page.request.delete).toHaveBeenCalledWith('/api/tasks/chosen');
  });
});

describe.each([
  { method: 'deleteShoppingList' as const, path: 'shopping-lists' },
  { method: 'deleteShoppingItem' as const, path: 'shopping-items' },
])('$method direct deletion', ({ method, path }) => {
  const cleanup = loadCleanup();

  test.each([true, false])('returns the delete HTTP outcome %s without a lookup', async (ok) => {
    const page = fakePage();
    const response = reply(undefined, ok);
    page.request.delete.mockResolvedValue(response);
    await expect(cleanup[method](page, 'fixture-id')).resolves.toBe(ok);
    expect(page.request.get).not.toHaveBeenCalled();
    expect(page.request.delete.mock.calls).toEqual([[`/api/${path}/fixture-id`]]);
    expect(response.json).not.toHaveBeenCalled();
  });

  test('preserves a delete transport error', async () => {
    const failure = new Error('fixture transport failure');
    const page = fakePage();
    page.request.delete.mockRejectedValue(failure);
    await expect(cleanup[method](page, 'fixture-id')).rejects.toBe(failure);
    expect(page.request.get).not.toHaveBeenCalled();
  });
});
