import path from 'path';

type AvatarStorage = typeof import('@/lib/services/avatar-storage');
type Stage = 'decode' | 'rotate' | 'resize' | 'jpeg' | 'toFile';

type Pipeline = {
  input: Buffer;
  rotate: jest.Mock<Pipeline, []>;
  resize: jest.Mock<Pipeline, [number, number, { fit: string }]>;
  jpeg: jest.Mock<Pipeline, [{ quality: number }]>;
  toFile: jest.Mock<Promise<unknown>, [string]>;
};

export const AVATAR_ROOT = '/burn4/avatar-fixture';
export const FIRST_ID = '11111111-2222-4333-8444-555555555555';
export const SECOND_ID = '66666666-7777-4888-8999-000000000000';

export function avatarPath(id: string): string {
  return path.join(AVATAR_ROOT, `${id}.jpg`);
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function avatarFixture() {
  jest.resetModules();
  const events: string[] = [];
  const pipelines: Pipeline[] = [];
  const failureByInput = new Map<Buffer, { stage: Stage; error: Error }>();
  const completionByInput = new Map<Buffer, Promise<unknown>>();
  const writeSignals = new Map<Buffer, ReturnType<typeof deferred<void>>>();
  const getWriteSignal = (input: Buffer) => {
    let signal = writeSignals.get(input);
    if (!signal) {
      signal = deferred<void>();
      writeSignals.set(input, signal);
    }
    return signal;
  };
  const guard = jest.fn<void, [string]>((id) => {
    events.push(`guard:${id}`);
  });
  const mkdir = jest.fn<Promise<unknown>, [string, { recursive: boolean }]>(() => {
    events.push('mkdir');
    return Promise.resolve(undefined);
  });
  const unlink = jest.fn<Promise<void>, [string]>((filePath) => {
    events.push(`unlink:${filePath}`);
    return Promise.resolve();
  });
  const getRoot = jest.fn(() => AVATAR_ROOT);
  const sharp = jest.fn<Pipeline, [Buffer]>((input) => {
    const step = (stage: Stage) => {
      events.push(stage);
      const failure = failureByInput.get(input);
      if (failure?.stage === stage) throw failure.error;
    };
    step('decode');
    const pipeline: Pipeline = {
      input,
      rotate: jest.fn(() => {
        step('rotate');
        return pipeline;
      }),
      resize: jest.fn<Pipeline, [number, number, { fit: string }]>(() => {
        step('resize');
        return pipeline;
      }),
      jpeg: jest.fn<Pipeline, [{ quality: number }]>(() => {
        step('jpeg');
        return pipeline;
      }),
      toFile: jest.fn<Promise<unknown>, [string]>(() => {
        step('toFile');
        getWriteSignal(input).resolve(undefined);
        return completionByInput.get(input) ?? Promise.resolve(undefined);
      }),
    };
    pipelines.push(pipeline);
    return pipeline;
  });

  jest.doMock('sharp', () => ({ __esModule: true, default: sharp }));
  jest.doMock('fs', () => ({ promises: { mkdir, unlink } }));
  jest.doMock('@/lib/config/runtime', () => ({ getAvatarsRoot: getRoot }));
  jest.doMock('@/lib/utils/safePathId', () => ({ assertSafePathId: guard }));
  const storage = jest.requireActual<AvatarStorage>('@/lib/services/avatar-storage');

  return {
    storage,
    events,
    pipelines,
    failureByInput,
    completionByInput,
    waitForWrite: (input: Buffer) => getWriteSignal(input).promise,
    guard,
    mkdir,
    unlink,
    getRoot,
    sharp,
  };
}
