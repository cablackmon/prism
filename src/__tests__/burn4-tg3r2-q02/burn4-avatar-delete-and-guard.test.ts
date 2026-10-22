import {
  FIRST_ID,
  SECOND_ID,
  avatarFixture,
  avatarPath,
  deferred,
} from './burn4-avatar-fixture';

describe('avatar validation and deletion boundaries', () => {
  test.each(['saveAvatar', 'deleteAvatar', 'getAvatarPath'] as const)(
    '%s forwards the original guard rejection before storage or image work', async (operation) => {
      const fixture = avatarFixture();
      const error = new Error('guard rejected fixture identifier');
      fixture.guard.mockImplementationOnce(() => { throw error; });

      if (operation === 'saveAvatar') {
        await expect(fixture.storage.saveAvatar(Buffer.from('offline fixture'), FIRST_ID))
          .rejects.toBe(error);
      } else if (operation === 'deleteAvatar') {
        await expect(fixture.storage.deleteAvatar(FIRST_ID)).rejects.toBe(error);
      } else {
        let thrown: unknown;
        try {
          fixture.storage.getAvatarPath(FIRST_ID);
        } catch (reason) {
          thrown = reason;
        }
        expect(thrown).toBe(error);
      }
      expect(fixture.guard).toHaveBeenCalledTimes(1);
      expect(fixture.guard).toHaveBeenCalledWith(FIRST_ID);
      expect(fixture.mkdir).not.toHaveBeenCalled();
      expect(fixture.unlink).not.toHaveBeenCalled();
      expect(fixture.sharp).not.toHaveBeenCalled();
    }
  );

  test('path lookup validates every request and leaves an in-flight save alone', async () => {
    const fixture = avatarFixture();
    const directory = deferred<unknown>();
    fixture.mkdir.mockReturnValueOnce(directory.promise);
    const saving = fixture.storage.saveAvatar(Buffer.from('offline fixture'), FIRST_ID);

    expect(fixture.storage.getAvatarPath(SECOND_ID)).toBe(avatarPath(SECOND_ID));
    expect(fixture.storage.getAvatarPath(FIRST_ID)).toBe(avatarPath(FIRST_ID));
    expect(fixture.guard.mock.calls).toEqual([[FIRST_ID], [SECOND_ID], [FIRST_ID]]);
    expect(fixture.mkdir).toHaveBeenCalledTimes(1);
    expect(fixture.sharp).not.toHaveBeenCalled();
    expect(fixture.unlink).not.toHaveBeenCalled();
    directory.resolve(undefined);
    await expect(saving).resolves.toBe(`${FIRST_ID}.jpg`);
  });

  test('delete waits for unlink completion and validates before invoking unlink', async () => {
    const fixture = avatarFixture();
    const removal = deferred<void>();
    fixture.unlink.mockReturnValueOnce(removal.promise);
    const onComplete = jest.fn();
    const deleting = fixture.storage.deleteAvatar(FIRST_ID).then(onComplete);
    await Promise.resolve();

    expect(fixture.guard.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.unlink.mock.invocationCallOrder[0]!
    );
    expect(fixture.unlink).toHaveBeenCalledWith(avatarPath(FIRST_ID));
    expect(onComplete).not.toHaveBeenCalled();
    expect(fixture.mkdir).not.toHaveBeenCalled();
    expect(fixture.sharp).not.toHaveBeenCalled();
    removal.resolve(undefined);
    await deleting;
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test('an absent avatar does not prevent a separate concurrent deletion from completing', async () => {
    const fixture = avatarFixture();
    const firstRemoval = deferred<void>();
    const secondRemoval = deferred<void>();
    fixture.unlink.mockReturnValueOnce(firstRemoval.promise)
      .mockReturnValueOnce(secondRemoval.promise);
    const first = fixture.storage.deleteAvatar(FIRST_ID);
    const second = fixture.storage.deleteAvatar(SECOND_ID);
    expect(fixture.unlink.mock.calls).toEqual([[avatarPath(FIRST_ID)], [avatarPath(SECOND_ID)]]);

    firstRemoval.reject(Object.assign(new Error('avatar absent'), { code: 'ENOENT' }));
    await expect(first).resolves.toBeUndefined();
    secondRemoval.resolve(undefined);
    await expect(second).resolves.toBeUndefined();
  });

  test.failing.each(['EACCES', 'EIO'])(
    'KNOWN GAP: deleteAvatar hides %s storage failure as successful deletion', async (code) => {
      const fixture = avatarFixture();
      const error = Object.assign(new Error('avatar deletion failed'), { code });
      fixture.unlink.mockRejectedValueOnce(error);

      await expect(fixture.storage.deleteAvatar(FIRST_ID)).rejects.toBe(error);
    }
  );
});
