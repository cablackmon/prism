import { deferred, fakePage, loadCleanup, reply, type Reply } from './burn4-cleanup-harness';

const cleanup = loadCleanup();
const chores = [
  { id: 'first', title: 'Target fixture' },
  { id: 'other', title: 'Other fixture' },
  { id: 'second', title: 'Target fixture' },
  { id: 'third', title: 'Target fixture' },
];

test('all matching chore deletions start before the first result settles', async () => {
  const page = fakePage({ chores });
  const started = deferred<void>();
  const pending = [deferred<Reply>(), deferred<Reply>(), deferred<Reply>()];
  page.request.delete.mockImplementation((_path) => {
    const call = page.request.delete.mock.calls.length;
    if (call === pending.length) started.resolve();
    return pending[call - 1]!.promise;
  });
  let settled = false;
  const result = cleanup.deleteChoreByTitle(page, 'Target fixture');
  void result.then(() => { settled = true; });
  await started.promise;
  expect(page.request.delete.mock.calls).toEqual([
    ['/api/chores/first'], ['/api/chores/second'], ['/api/chores/third'],
  ]);
  expect(settled).toBe(false);
  pending[2]!.resolve(reply());
  pending[0]!.resolve(reply());
  await Promise.resolve();
  expect(settled).toBe(false);
  pending[1]!.resolve(reply());
  await expect(result).resolves.toBe(true);
});

test.each([0, 1, 2])('a failed chore HTTP outcome at index %s still attempts every match', async (failed) => {
  const page = fakePage({ chores });
  page.request.delete.mockImplementation(async () => reply(undefined, page.request.delete.mock.calls.length - 1 !== failed));
  await expect(cleanup.deleteChoreByTitle(page, 'Target fixture')).resolves.toBe(false);
  expect(page.request.delete).toHaveBeenCalledTimes(3);
});

test('a rejected chore request rejects the aggregate after all requests have started', async () => {
  const failure = new Error('fixture second deletion failed');
  const page = fakePage(chores);
  const pending = deferred<Reply>();
  page.request.delete
    .mockResolvedValueOnce(reply())
    .mockRejectedValueOnce(failure)
    .mockReturnValueOnce(pending.promise);
  await expect(cleanup.deleteChoreByTitle(page, 'Target fixture')).rejects.toBe(failure);
  expect(page.request.delete).toHaveBeenCalledTimes(3);
  pending.resolve(reply());
});

test('independent calls do not share page requests or selected records', async () => {
  const firstPage = fakePage([{ id: 'first-page', title: 'Target fixture' }]);
  const secondPage = fakePage([{ id: 'second-page', title: 'Target fixture' }]);
  const firstLookup = deferred<Reply>();
  firstPage.request.get.mockReturnValue(firstLookup.promise);
  const first = cleanup.deleteTaskByTitle(firstPage, 'Target fixture');
  await expect(cleanup.deleteTaskByTitle(secondPage, 'Target fixture')).resolves.toBe(true);
  expect(firstPage.request.delete).not.toHaveBeenCalled();
  firstLookup.resolve(reply([{ id: 'first-page', title: 'Target fixture' }]));
  await expect(first).resolves.toBe(true);
  expect(firstPage.request.delete.mock.calls).toEqual([['/api/tasks/first-page']]);
  expect(secondPage.request.delete.mock.calls).toEqual([['/api/tasks/second-page']]);
});
