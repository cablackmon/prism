import { loadUtility } from './burn4-vm-fixture';

type BrowserFetchModule = typeof import('@/lib/utils/browserFetch');

function fixture(settings: Record<string, string> = {}) {
  const page = {
    setUserAgent: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    setViewport: jest.fn<Promise<void>, [{ width: number; height: number }]>()
      .mockResolvedValue(undefined),
    goto: jest.fn<Promise<void>, [string, { waitUntil: string; timeout: number }]>()
      .mockResolvedValue(undefined),
    waitForSelector: jest.fn<Promise<void>, [string, { timeout: number }]>()
      .mockResolvedValue(undefined),
    waitForNetworkIdle: jest.fn<Promise<void>, [{ idleTime: number; timeout: number }]>()
      .mockResolvedValue(undefined),
    content: jest.fn<Promise<string>, []>().mockResolvedValue('<html>Synthetic recipe</html>'),
  };
  const browser = {
    newPage: jest.fn().mockResolvedValue(page),
    close: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };
  const launch = jest.fn().mockResolvedValue(browser);
  const harness = loadUtility<BrowserFetchModule>('browserFetch', {
    settings,
    dependencies: { 'puppeteer-core': { __esModule: true, default: { launch } } },
  });
  return { ...harness, page, browser, launch, fetch: harness.exports.browserFetch };
}

describe('browserFetch with an offline Chromium fixture', () => {
  test('configures a browser, extracts HTML and always closes it after success', async () => {
    const f = fixture();
    expect(await f.fetch('https://recipes.example.invalid/synthetic')).toBe('<html>Synthetic recipe</html>');
    expect(f.launch).toHaveBeenCalledWith(expect.objectContaining({
      executablePath: '/usr/bin/chromium-browser',
      headless: true,
      timeout: 30_000,
      args: expect.arrayContaining(['--no-sandbox', '--disable-dev-shm-usage']),
    }));
    expect(f.browser.newPage).toHaveBeenCalledTimes(1);
    expect(f.page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Chrome/131.0.0.0'));
    expect(f.page.setViewport).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    expect(f.page.goto).toHaveBeenCalledWith('https://recipes.example.invalid/synthetic', {
      waitUntil: 'domcontentloaded', timeout: 30_000,
    });
    expect(f.page.waitForSelector).toHaveBeenCalledWith('script[type="application/ld+json"]', {
      timeout: 25_000,
    });
    expect(f.page.waitForNetworkIdle).not.toHaveBeenCalled();
    expect(f.page.content).toHaveBeenCalledTimes(1);
    expect(f.browser.close).toHaveBeenCalledTimes(1);
    expect(f.browser.close.mock.invocationCallOrder[0])
      .toBeGreaterThan(f.page.content.mock.invocationCallOrder[0]!);
    expect(f.errorLog).not.toHaveBeenCalled();
  });

  test('honors a synthetic executable override without reading the real process', async () => {
    const f = fixture({ PUPPETEER_EXECUTABLE_PATH: '/offline-fixture/chromium' });
    await f.fetch('https://recipes.example.invalid/synthetic');
    expect(f.launch.mock.calls[0]?.[0].executablePath).toBe('/offline-fixture/chromium');
  });

  test('returns null when the Puppeteer import is unavailable without launching anything', async () => {
    const f = loadUtility<BrowserFetchModule>('browserFetch');
    expect(await f.exports.browserFetch('https://recipes.example.invalid/synthetic')).toBeNull();
    expect(f.requireDependency).toHaveBeenCalledWith('puppeteer-core');
    expect(f.errorLog).not.toHaveBeenCalled();
  });

  test('retries an unavailable import on a later call', async () => {
    const f = loadUtility<BrowserFetchModule>('browserFetch');
    await f.exports.browserFetch('https://recipes.example.invalid/first');
    await f.exports.browserFetch('https://recipes.example.invalid/second');
    expect(f.requireDependency).toHaveBeenCalledTimes(2);
  });

  test('reuses the imported module but opens and closes a fresh browser per request', async () => {
    const f = fixture();
    await f.fetch('https://recipes.example.invalid/first');
    await f.fetch('https://recipes.example.invalid/second');
    expect(f.requireDependency).toHaveBeenCalledTimes(1);
    expect(f.launch).toHaveBeenCalledTimes(2);
    expect(f.browser.newPage).toHaveBeenCalledTimes(2);
    expect(f.browser.close).toHaveBeenCalledTimes(2);
  });

  test('waits for network idle when structured data has not appeared', async () => {
    const f = fixture();
    f.page.waitForSelector.mockRejectedValue(new Error('Synthetic selector timeout'));
    expect(await f.fetch('https://recipes.example.invalid/synthetic')).toBe('<html>Synthetic recipe</html>');
    expect(f.page.waitForNetworkIdle).toHaveBeenCalledWith({ idleTime: 2_000, timeout: 10_000 });
    expect(f.browser.close).toHaveBeenCalledTimes(1);
    expect(f.errorLog).not.toHaveBeenCalled();
  });

  test('extracts available content after both challenge wait strategies time out', async () => {
    const f = fixture();
    f.page.waitForSelector.mockRejectedValue(new Error('Synthetic selector timeout'));
    f.page.waitForNetworkIdle.mockRejectedValue(new Error('Synthetic idle timeout'));
    expect(await f.fetch('https://recipes.example.invalid/synthetic')).toBe('<html>Synthetic recipe</html>');
    expect(f.page.content).toHaveBeenCalledTimes(1);
    expect(f.browser.close).toHaveBeenCalledTimes(1);
    expect(f.errorLog).not.toHaveBeenCalled();
  });

  test('returns null on launch failure without trying to close an uncreated browser', async () => {
    const f = fixture();
    f.launch.mockRejectedValue(new Error('Synthetic launch failure'));
    expect(await f.fetch('https://recipes.example.invalid/synthetic')).toBeNull();
    expect(f.errorLog).toHaveBeenCalledWith('Browser fetch failed:', 'Synthetic launch failure');
    expect(f.browser.newPage).not.toHaveBeenCalled();
    expect(f.browser.close).not.toHaveBeenCalled();
  });

  test('closes the browser after newPage fails', async () => {
    const f = fixture();
    f.browser.newPage.mockRejectedValue(new Error('Synthetic newPage failure'));
    expect(await f.fetch('https://recipes.example.invalid/synthetic')).toBeNull();
    expect(f.page.goto).not.toHaveBeenCalled();
    expect(f.browser.close).toHaveBeenCalledTimes(1);
    expect(f.errorLog).toHaveBeenCalledWith('Browser fetch failed:', 'Synthetic newPage failure');
  });

  test.each(['setUserAgent', 'setViewport', 'goto', 'content'] as const)
    ('returns null and closes the browser after %s fails', async (method) => {
      const f = fixture();
      f.page[method].mockRejectedValue(new Error(`Synthetic ${method} failure`));
      expect(await f.fetch('https://recipes.example.invalid/synthetic')).toBeNull();
      expect(f.browser.close).toHaveBeenCalledTimes(1);
      expect(f.errorLog).toHaveBeenCalledWith('Browser fetch failed:', `Synthetic ${method} failure`);
      if (method !== 'content') expect(f.page.content).not.toHaveBeenCalled();
    });

  test('handles non-Error dependency failures and still cleans up', async () => {
    const f = fixture();
    f.page.goto.mockRejectedValue('Synthetic navigation refusal');
    expect(await f.fetch('https://recipes.example.invalid/synthetic')).toBeNull();
    expect(f.errorLog).toHaveBeenCalledWith('Browser fetch failed:', 'Synthetic navigation refusal');
    expect(f.browser.close).toHaveBeenCalledTimes(1);
  });

  test('does not replace successful HTML when browser close fails', async () => {
    const f = fixture();
    f.browser.close.mockRejectedValue(new Error('Synthetic cleanup failure'));
    expect(await f.fetch('https://recipes.example.invalid/synthetic')).toBe('<html>Synthetic recipe</html>');
    expect(f.browser.close).toHaveBeenCalledTimes(1);
    expect(f.errorLog).not.toHaveBeenCalled();
  });

  test('does not mask an original navigation failure when cleanup also fails', async () => {
    const f = fixture();
    f.page.goto.mockRejectedValue(new Error('Synthetic navigation failure'));
    f.browser.close.mockRejectedValue(new Error('Synthetic cleanup failure'));
    expect(await f.fetch('https://recipes.example.invalid/synthetic')).toBeNull();
    expect(f.errorLog).toHaveBeenCalledTimes(1);
    expect(f.errorLog).toHaveBeenCalledWith('Browser fetch failed:', 'Synthetic navigation failure');
  });

  test('waits for asynchronous cleanup before settling the fetch promise', async () => {
    const f = fixture();
    let finishClose: () => void = () => { throw new Error('Close fixture has not started'); };
    const closeStarted = new Promise<void>((resolveStarted) => {
      f.browser.close.mockImplementation(() => new Promise<void>((resolveClose) => {
        finishClose = resolveClose;
        resolveStarted();
      }));
    });
    const settled = jest.fn();
    const pending = f.fetch('https://recipes.example.invalid/synthetic').then((html) => {
      settled(html);
      return html;
    });
    await closeStarted;
    expect(settled).not.toHaveBeenCalled();
    finishClose();
    await expect(pending).resolves.toBe('<html>Synthetic recipe</html>');
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
