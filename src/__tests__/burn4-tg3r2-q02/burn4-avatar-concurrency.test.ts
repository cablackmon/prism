import {
  FIRST_ID,
  SECOND_ID,
  avatarFixture,
  avatarPath,
  deferred,
} from './burn4-avatar-fixture';

const firstInput = Buffer.from('first offline image');
const secondInput = Buffer.from('second offline image');

describe('independent avatar save operations', () => {
  test('keeps inputs, destinations and completion separate when writers finish out of order', async () => {
    const fixture = avatarFixture();
    const firstWrite = deferred<unknown>();
    const secondWrite = deferred<unknown>();
    fixture.completionByInput.set(firstInput, firstWrite.promise);
    fixture.completionByInput.set(secondInput, secondWrite.promise);
    const completions: string[] = [];
    const first = fixture.storage.saveAvatar(firstInput, FIRST_ID)
      .then((filename) => { completions.push(filename); return filename; });
    const second = fixture.storage.saveAvatar(secondInput, SECOND_ID)
      .then((filename) => { completions.push(filename); return filename; });
    await Promise.all([fixture.waitForWrite(firstInput), fixture.waitForWrite(secondInput)]);

    expect(fixture.mkdir).toHaveBeenCalledTimes(2);
    expect(fixture.sharp.mock.calls).toEqual([[firstInput], [secondInput]]);
    expect(fixture.pipelines).toHaveLength(2);
    expect(fixture.pipelines[0]).not.toBe(fixture.pipelines[1]);
    expect(fixture.pipelines[0]!.toFile).toHaveBeenCalledWith(avatarPath(FIRST_ID));
    expect(fixture.pipelines[1]!.toFile).toHaveBeenCalledWith(avatarPath(SECOND_ID));
    expect(completions).toEqual([]);

    secondWrite.resolve(undefined);
    await expect(second).resolves.toBe(`${SECOND_ID}.jpg`);
    expect(completions).toEqual([`${SECOND_ID}.jpg`]);
    firstWrite.resolve(undefined);
    await expect(first).resolves.toBe(`${FIRST_ID}.jpg`);
    expect(completions).toEqual([`${SECOND_ID}.jpg`, `${FIRST_ID}.jpg`]);
  });

  test('a failed writer rejects only its own save while a concurrent writer can succeed', async () => {
    const fixture = avatarFixture();
    const firstWrite = deferred<unknown>();
    const secondWrite = deferred<unknown>();
    const error = new Error('first output failed');
    fixture.completionByInput.set(firstInput, firstWrite.promise);
    fixture.completionByInput.set(secondInput, secondWrite.promise);
    const first = fixture.storage.saveAvatar(firstInput, FIRST_ID);
    const firstOutcome = first.catch((reason: unknown) => reason);
    const second = fixture.storage.saveAvatar(secondInput, SECOND_ID);
    await Promise.all([fixture.waitForWrite(firstInput), fixture.waitForWrite(secondInput)]);

    firstWrite.reject(error);
    await expect(firstOutcome).resolves.toBe(error);
    expect(fixture.pipelines[1]!.toFile).toHaveBeenCalledWith(avatarPath(SECOND_ID));
    secondWrite.resolve(undefined);
    await expect(second).resolves.toBe(`${SECOND_ID}.jpg`);
    expect(fixture.unlink).not.toHaveBeenCalled();
  });

  test('one directory failure does not poison another in-flight directory request', async () => {
    const fixture = avatarFixture();
    const firstDirectory = deferred<unknown>();
    const secondDirectory = deferred<unknown>();
    const error = new Error('first directory request failed');
    fixture.mkdir.mockReturnValueOnce(firstDirectory.promise)
      .mockReturnValueOnce(secondDirectory.promise);
    const first = fixture.storage.saveAvatar(firstInput, FIRST_ID);
    const firstOutcome = first.catch((reason: unknown) => reason);
    const second = fixture.storage.saveAvatar(secondInput, SECOND_ID);

    expect(fixture.sharp).not.toHaveBeenCalled();
    firstDirectory.reject(error);
    await expect(firstOutcome).resolves.toBe(error);
    expect(fixture.sharp).not.toHaveBeenCalled();
    secondDirectory.resolve(undefined);
    await expect(second).resolves.toBe(`${SECOND_ID}.jpg`);
    expect(fixture.sharp.mock.calls).toEqual([[secondInput]]);
    expect(fixture.pipelines[0]!.toFile).toHaveBeenCalledWith(avatarPath(SECOND_ID));
  });
});
