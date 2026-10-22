import { jestDiscovery, observerSetup, type Observer } from './burn4-tooling-harness';

describe('Jest path discovery without importing discovered tests', () => {
  it('discovers TypeScript and TSX unit paths inside src and rejects unrelated files', async () => {
    const unit = await jestDiscovery('jest.config.js');
    expect(unit.accepts('src/__tests__/burn4-synthetic.test.ts')).toBe(true);
    expect(unit.accepts('src/components/__tests__/burn4-synthetic.test.tsx')).toBe(true);
    expect(unit.accepts('src/components/burn4-synthetic.tsx')).toBe(false);
    expect(unit.accepts('scripts/__tests__/burn4-synthetic.test.ts')).toBe(false);
    expect(unit.accepts('src/node_modules/fixture/__tests__/burn4-synthetic.test.ts')).toBe(false);
  });

  it('does not treat browser scenarios or demo recordings as unit test paths', async () => {
    const unit = await jestDiscovery('jest.config.js');
    expect(unit.accepts('e2e/burn4-synthetic.spec.ts')).toBe(false);
    expect(unit.accepts('e2e/demos/scenarios/burn4-synthetic.spec.ts')).toBe(false);
    expect(unit.accepts('src/__tests__/burn4-synthetic.spec.ts')).toBe(false);
  });

  it('restricts integration discovery to the explicitly named database test path', async () => {
    const integration = await jestDiscovery('jest.integration.config.js');
    expect(integration.accepts('src/lib/db/__tests__/integration.test.ts')).toBe(true);
    expect(integration.accepts('src/lib/db/__tests__/burn4-unit.test.ts')).toBe(false);
    expect(integration.accepts('src/lib/db/__tests__/integration.test.tsx')).toBe(false);
    expect(integration.accepts('src/__tests__/burn4-synthetic.test.ts')).toBe(false);
  });

  it('preserves default discovery of the intentionally self-gated integration path', async () => {
    const unit = await jestDiscovery('jest.config.js');
    // Existing integration source documents this overlap and skips unless opted in.
    // Check only its path. The source and its database helper are never imported.
    expect(unit.accepts('src/lib/db/__tests__/integration.test.ts')).toBe(true);
  });

  it('resolves unit browser setup while integration config has no unit setup side effect', async () => {
    const unit = await jestDiscovery('jest.config.js');
    const integration = await jestDiscovery('jest.integration.config.js');
    expect(unit.options.setupFiles).toEqual([expect.stringMatching(/\/jest\.setup\.js$/)]);
    expect(integration.options.setupFiles).toEqual([]);
    expect(integration.options.maxWorkers).toBe(1);
    expect(integration.options.testTimeout).toBe(30_000);
  });
});

describe('ResizeObserver setup in an isolated synthetic global', () => {
  it('calls the callback synchronously with target dimensions and the observer instance', () => {
    const ResizeObserver = observerSetup();
    const callback = jest.fn();
    const observer = new ResizeObserver(callback);
    const target = {};
    observer.observe(target);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith([
      { target, contentRect: { width: 800, height: 600 } },
    ], observer);
  });

  it('reports each new target without retaining the previous entry array', () => {
    const ResizeObserver = observerSetup();
    const callback = jest.fn();
    const observer = new ResizeObserver(callback);
    const first = {};
    const second = {};
    observer.observe(first);
    observer.observe(second);
    expect(callback).toHaveBeenNthCalledWith(1, [{ target: first, contentRect: { width: 800, height: 600 } }], observer);
    expect(callback).toHaveBeenNthCalledWith(2, [{ target: second, contentRect: { width: 800, height: 600 } }], observer);
    expect(callback.mock.calls[0]?.[0]).not.toBe(callback.mock.calls[1]?.[0]);
  });

  it('isolates callbacks between observer instances and separate setup evaluations', () => {
    const First = observerSetup();
    const Second = observerSetup();
    const firstCallback = jest.fn();
    const secondCallback = jest.fn();
    const first = new First(firstCallback);
    const second = new Second(secondCallback);
    first.observe({});
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).not.toHaveBeenCalled();
    second.observe({});
    expect(secondCallback).toHaveBeenCalledTimes(1);
    expect(First).not.toBe(Second);
  });

  it('supports teardown calls without callbacks and can observe again afterward', () => {
    const ResizeObserver = observerSetup();
    const callback = jest.fn();
    const observer: Observer = new ResizeObserver(callback);
    observer.unobserve();
    observer.disconnect();
    expect(callback).not.toHaveBeenCalled();
    observer.observe({});
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
