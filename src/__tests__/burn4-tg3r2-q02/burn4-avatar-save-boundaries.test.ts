import {
  AVATAR_ROOT,
  FIRST_ID,
  avatarFixture,
  deferred,
} from './burn4-avatar-fixture';

const input = Buffer.from('offline avatar fixture');

describe('avatar save failure boundaries', () => {
  test('awaits validated directory creation before decoding any image', async () => {
    const fixture = avatarFixture();
    const directory = deferred<unknown>();
    fixture.mkdir.mockReturnValueOnce(directory.promise);

    const saving = fixture.storage.saveAvatar(input, FIRST_ID);
    expect(fixture.guard).toHaveBeenCalledTimes(1);
    expect(fixture.guard).toHaveBeenCalledWith(FIRST_ID);
    expect(fixture.events).toEqual([`guard:${FIRST_ID}`]);
    expect(fixture.mkdir).toHaveBeenCalledWith(AVATAR_ROOT, { recursive: true });
    expect(fixture.sharp).not.toHaveBeenCalled();

    directory.resolve(undefined);
    await expect(saving).resolves.toBe(`${FIRST_ID}.jpg`);
    expect(fixture.sharp).toHaveBeenCalledWith(input);
  });

  test('propagates directory rejection unchanged without decoding or deleting', async () => {
    const fixture = avatarFixture();
    const error = Object.assign(new Error('avatar directory unavailable'), { code: 'EACCES' });
    fixture.mkdir.mockRejectedValueOnce(error);

    await expect(fixture.storage.saveAvatar(input, FIRST_ID)).rejects.toBe(error);
    expect(fixture.guard.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.mkdir.mock.invocationCallOrder[0]!
    );
    expect(fixture.sharp).not.toHaveBeenCalled();
    expect(fixture.unlink).not.toHaveBeenCalled();
  });

  test.each([
    ['decode', ['decode']],
    ['rotate', ['decode', 'rotate']],
    ['resize', ['decode', 'rotate', 'resize']],
    ['jpeg', ['decode', 'rotate', 'resize', 'jpeg']],
    ['toFile', ['decode', 'rotate', 'resize', 'jpeg', 'toFile']],
  ] as const)('propagates a synchronous %s failure and stops the pipeline', async (stage, steps) => {
    const fixture = avatarFixture();
    const error = new Error(`${stage} fixture failure`);
    fixture.failureByInput.set(input, { stage, error });

    await expect(fixture.storage.saveAvatar(input, FIRST_ID)).rejects.toBe(error);
    expect(fixture.events).toEqual([`guard:${FIRST_ID}`, 'mkdir', ...steps]);
    expect(fixture.sharp).toHaveBeenCalledTimes(1);
    expect(fixture.unlink).not.toHaveBeenCalled();
  });

  test('returns only after the writer completes and propagates its exact asynchronous error', async () => {
    const fixture = avatarFixture();
    const write = deferred<unknown>();
    const error = Object.assign(new Error('avatar output volume full'), { code: 'ENOSPC' });
    fixture.completionByInput.set(input, write.promise);
    const onResult = jest.fn();
    const saving = fixture.storage.saveAvatar(input, FIRST_ID);
    const observed = saving.then(onResult, (reason: unknown) => reason);
    await fixture.waitForWrite(input);

    expect(fixture.pipelines).toHaveLength(1);
    expect(fixture.pipelines[0]!.toFile).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
    write.reject(error);
    await expect(observed).resolves.toBe(error);
    expect(onResult).not.toHaveBeenCalled();
    expect(fixture.unlink).not.toHaveBeenCalled();
  });
});
