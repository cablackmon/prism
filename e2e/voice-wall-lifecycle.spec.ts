import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const BOARD = 'https://kyst-board.fly.dev';
const PROXY = 'https://kyst-wall-proxy.fly.dev';
const VOICE = 'wss://cb-threadripper.tail3a8e2d.ts.net:8445/voice';
const READY_FRAME = {
  type: 'ready',
  contract: 1,
  pipeline: 'pipecat',
  audioFormat: 'pcm16',
};
const VOICE_ASSET_ROOT = process.env.KYST_VOICE_ASSET_ROOT || path.join(process.cwd(), 'public');
const EVIDENCE_DIR = process.env.KYST_VOICE_EVIDENCE_DIR;

type LifecycleOptions = {
  clientAsset?: 'ok' | 'failed';
  bridgeAsset?: 'ok' | 'failed' | 'failed-once';
  bridgeLoadDelayMs?: number;
  suppressInitialBridgeReady?: boolean;
  automaticSocketReady?: boolean;
  fakeCapture?: boolean;
};

type SafeEvent = {
  kind: 'console' | 'pageerror' | 'requestfailed' | 'framenavigated' | 'state';
  value: string;
};

function safeUrl(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function bridgeFixture({ suppressInitialBridgeReady = false } = {}): string {
  return `(() => {
    const parentOrigin = ${JSON.stringify(BOARD)};
    const announceReady = () => window.parent.postMessage(
      { type: 'kyst-voice-bridge-ready' }, parentOrigin
    );
    ${suppressInitialBridgeReady ? '' : 'announceReady();'}
    window.addEventListener('message', async (event) => {
      if (event.origin !== parentOrigin || event.source !== window.parent) return;
      const message = event.data || {};
      if (message.type === 'kyst-voice-ping') return announceReady();
      if (message.type === 'kyst-voice-ask') {
        const requestId = String(message.requestId || '');
        if (!requestId) return;
        await fetch('/ask', { method: 'POST', body: message.audio || '' });
        window.parent.postMessage(
          { type: 'kyst-voice-error', requestId, status: 503, error: 'Fixture batch complete' },
          parentOrigin
        );
        return;
      }
      if (message.type !== 'kyst-voice-stream-ticket') return;
      const requestId = String(message.requestId || '');
      if (!requestId) return;
      const response = await fetch('/voice/stream-ticket', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: '{}',
      });
      const config = await response.json();
      window.parent.postMessage(
        { type: 'kyst-voice-stream-config', ...config, requestId }, parentOrigin
      );
    });
  })();`;
}

async function captureEvidence(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function recordSafeEvents(events: SafeEvent[], name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(
    path.join(EVIDENCE_DIR, `${name}.json`),
    `${JSON.stringify(events, null, 2)}\n`,
    'utf8'
  );
}

async function installLifecycle(
  page: Page,
  options: LifecycleOptions = {}
): Promise<{
  events: SafeEvent[];
  releaseSocketReady: () => void;
  socketAuthentications: () => number;
  socketRoutes: () => number;
  ticketRequests: () => number;
  batchRequests: () => number;
  bridgeRequests: () => number;
  closeSocket: () => Promise<void>;
}> {
  const events: SafeEvent[] = [];
  const wall = await fs.readFile(path.join(VOICE_ASSET_ROOT, 'wall.html'), 'utf8');
  const voiceClient = await fs.readFile(path.join(VOICE_ASSET_ROOT, 'voice-streaming.js'), 'utf8');
  const bridge = bridgeFixture(options);
  let ticketRequestCount = 0;
  let batchRequestCount = 0;
  let bridgeRequestCount = 0;
  let proxyBootstrapSeen = false;
  let socketRoute: WebSocketRoute | null = null;
  let socketAuthenticationCount = 0;
  let socketRouteCount = 0;

  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('NOX_VOICE_STATE ')) {
      events.push({ kind: 'state', value: text.slice('NOX_VOICE_STATE '.length) });
    } else if (message.type() === 'error' || message.type() === 'warning') {
      events.push({ kind: 'console', value: `${message.type()}:${text}` });
    }
  });
  page.on('pageerror', (error) => {
    events.push({ kind: 'pageerror', value: error.message });
  });
  page.on('requestfailed', (request) => {
    events.push({
      kind: 'requestfailed',
      value: `${request.method()} ${safeUrl(request.url())} ${request.failure()?.errorText || ''}`,
    });
  });
  page.on('framenavigated', (frame) => {
    if (/^https:\/\/(kyst-board|kyst-wall-proxy)\.fly\.dev/.test(frame.url())) {
      events.push({ kind: 'framenavigated', value: safeUrl(frame.url()) });
    }
  });

  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      if (window !== window.top) return;
      const status = document.getElementById('voice-status');
      if (!status) return;
      const report = () => console.info(`NOX_VOICE_STATE ${status.textContent || ''}`);
      report();
      new MutationObserver(report).observe(status, { childList: true, subtree: true });
    });
  });

  await page.addInitScript((fakeCapture) => {
    if (!fakeCapture) return;
    const track = { getSettings: () => ({ sampleRate: 48_000 }), stop: () => undefined };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getAudioTracks: () => [track],
          getTracks: () => [track],
        }),
      },
    });
    class FixtureMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      state = 'inactive';
      mimeType: string;
      listeners = new Map<string, Array<(event: { data?: Blob }) => void>>();

      constructor(_stream: unknown, options: { mimeType?: string } = {}) {
        this.mimeType = options.mimeType || 'audio/webm';
      }

      addEventListener(type: string, listener: (event: { data?: Blob }) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
      }

      emit(type: string, event: { data?: Blob } = {}) {
        for (const listener of this.listeners.get(type) || []) listener(event);
      }

      start() {
        this.state = 'recording';
        this.emit('dataavailable', {
          data: new Blob([new Uint8Array(512)], { type: this.mimeType }),
        });
      }

      stop() {
        this.state = 'inactive';
        this.emit('stop');
      }
    }
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: FixtureMediaRecorder,
    });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
    HTMLMediaElement.prototype.play = async () => undefined;
    HTMLMediaElement.prototype.pause = () => undefined;
  }, options.fakeCapture === true);

  await page.routeWebSocket(VOICE, (route) => {
    socketRouteCount += 1;
    socketRoute = route;
    route.onMessage((message) => {
      if (typeof message !== 'string') return;
      const parsed = JSON.parse(message) as { type?: string; token?: string };
      if (parsed.type !== 'auth' || parsed.token !== 'fixture-ticket') return;
      socketAuthenticationCount += 1;
      if (options.automaticSocketReady !== false) {
        route.send(JSON.stringify(READY_FRAME));
      }
    });
  });

  await page.route(`${BOARD}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/household-auth/device') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: {
          'set-cookie': 'kyst_household_session=fixture; Path=/; Secure; HttpOnly; SameSite=Lax',
          'cache-control': 'no-store',
        },
        body: '<script>location.replace("/wall.html?handoff=fixture-handoff")</script>',
      });
      return;
    }
    if (url.pathname === '/wall.html') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: wall });
      return;
    }
    if (url.pathname === '/voice-streaming.js') {
      if (options.clientAsset === 'failed') {
        await route.abort('failed');
      } else {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/javascript', 'cache-control': 'no-store' },
          body: voiceClient,
        });
      }
      return;
    }
    await route.fulfill({ status: 404, body: 'not found' });
  });

  await page.route(`${PROXY}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bootstrap') {
      proxyBootstrapSeen = true;
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: {
          'set-cookie':
            'kyst_household_session=fixture; Path=/; Secure; HttpOnly; SameSite=None; Partitioned',
          'cache-control': 'no-store',
        },
        body: '<script>location.replace("/")</script>',
      });
      return;
    }
    if (url.pathname === '/') {
      if (!proxyBootstrapSeen) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><body>Initial navigation</body></html>',
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><body><main>Board fixture</main><script>
          setTimeout(() => {
            const script = document.createElement('script');
            script.src = '/wall-bridge.js';
            document.body.appendChild(script);
          }, ${Number(options.bridgeLoadDelayMs || 0)});
        </script></body></html>`,
      });
      return;
    }
    if (url.pathname === '/wall-bridge.js') {
      bridgeRequestCount += 1;
      if (
        options.bridgeAsset === 'failed' ||
        (options.bridgeAsset === 'failed-once' && bridgeRequestCount === 1)
      ) {
        await route.abort('failed');
      } else {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: bridge });
      }
      return;
    }
    if (url.pathname === '/voice/stream-ticket') {
      ticketRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: VOICE,
          token: 'fixture-ticket',
          expiresAt: '2099-01-01T00:00:00Z',
        }),
      });
      return;
    }
    if (url.pathname === '/ask') {
      batchRequestCount += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({ status: 404, body: 'not found' });
  });

  return {
    events,
    releaseSocketReady: () => {
      if (!socketRoute) throw new Error('page-owned WebSocket has not connected');
      socketRoute.send(JSON.stringify(READY_FRAME));
    },
    socketAuthentications: () => socketAuthenticationCount,
    socketRoutes: () => socketRouteCount,
    ticketRequests: () => ticketRequestCount,
    batchRequests: () => batchRequestCount,
    bridgeRequests: () => bridgeRequestCount,
    closeSocket: async () => {
      if (!socketRoute) throw new Error('page-owned WebSocket has not connected');
      await socketRoute.close({ code: 1012, reason: 'fixture_close' });
    },
  };
}

test.describe('wall parent + proxy iframe voice lifecycle', () => {
  test('reaches ready only after the page-owned client accepts the exact ready frame', async ({
    page,
  }) => {
    const lifecycle = await installLifecycle(page, { automaticSocketReady: false });
    await page.goto(`${BOARD}/api/household-auth/device?token=fixture`);
    await page.waitForTimeout(600);
    if (EVIDENCE_DIR) await page.locator('#start').click();
    await captureEvidence(page, 'parent-before-stream-ready');
    await recordSafeEvents(lifecycle.events, 'parent-before-stream-ready-events');
    await expect.poll(lifecycle.ticketRequests, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(lifecycle.socketRoutes, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
    await expect
      .poll(lifecycle.socketAuthentications, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(1);

    await expect(page.locator('#voice-status')).not.toHaveText('Tap to ask NOX');
    lifecycle.releaseSocketReady();
    await expect(page.locator('#voice-status')).toHaveText('Tap to ask NOX');
    await expect(page.locator('#voice-status')).toHaveAttribute('role', 'status');
    await expect(page.locator('#mic')).toHaveAttribute('aria-label', 'Ask NOX');
    expect(lifecycle.ticketRequests()).toBeGreaterThanOrEqual(1);
    expect(lifecycle.events.filter((event) => event.kind === 'pageerror')).toEqual([]);
    await recordSafeEvents(lifecycle.events, 'fixed-ready-events');

    if (await page.locator('#start').isVisible()) await page.locator('#start').click();
    await page.locator('#mic').focus();
    await expect(page.locator('#mic')).toBeFocused();
    await captureEvidence(page, 'fixed-desktop-ready');
    await page.setViewportSize({ width: 390, height: 844 });
    await captureEvidence(page, 'fixed-mobile-ready');
  });

  test('recovers after redirect and late bridge load lose the initial announcement and first ping', async ({
    page,
  }) => {
    const lifecycle = await installLifecycle(page, {
      bridgeLoadDelayMs: 500,
      suppressInitialBridgeReady: true,
    });
    await page.goto(`${BOARD}/api/household-auth/device?token=fixture`);

    await expect(page.locator('#voice-status')).toHaveText('Tap to ask NOX', { timeout: 5_000 });
    expect(lifecycle.ticketRequests()).toBe(1);
    expect(lifecycle.events).toContainEqual({
      kind: 'framenavigated',
      value: `${PROXY}/bootstrap`,
    });
    await recordSafeEvents(lifecycle.events, 'fixed-late-bridge-events');
  });

  test('keeps an active parent-owned stream intact across an iframe refresh', async ({ page }) => {
    const lifecycle = await installLifecycle(page, { fakeCapture: true });
    await page.goto(`${BOARD}/api/household-auth/device?token=fixture`);
    await expect(page.locator('#voice-status')).toHaveText('Tap to ask NOX');
    await page.locator('#start').click();
    await expect(page.locator('#start')).toBeHidden();
    await page.locator('#mic').click();
    await expect(page.locator('#voice-status')).toHaveText('Listening… tap to stop');

    await page.locator('#board-frame').evaluate((frame: HTMLIFrameElement, proxy) => {
      frame.src = `${proxy}/?fixture-reload=1`;
    }, PROXY);
    await expect
      .poll(
        () =>
          lifecycle.events.filter(
            (event) => event.kind === 'framenavigated' && event.value === `${PROXY}/`
          ).length
      )
      .toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(100);
    await expect(page.locator('#voice-status')).toHaveText('Listening… tap to stop');
    expect(lifecycle.socketRoutes()).toBe(1);
    await page.locator('#mic').click();
    await recordSafeEvents(lifecycle.events, 'fixed-active-refresh-events');
  });

  test('records through the batch fallback while the streaming socket is unavailable', async ({
    page,
  }) => {
    const lifecycle = await installLifecycle(page, {
      automaticSocketReady: false,
      fakeCapture: true,
    });
    await page.goto(`${BOARD}/api/household-auth/device?token=fixture`);
    await expect.poll(lifecycle.socketAuthentications).toBeGreaterThanOrEqual(1);
    await page.locator('#start').click();
    await expect(page.locator('#start')).toBeHidden();

    await page.locator('#mic').click();
    await expect(page.locator('#voice-status')).toHaveText('Listening… tap to stop');
    await page.locator('#mic').click();
    await expect.poll(lifecycle.batchRequests).toBe(1);
    await recordSafeEvents(lifecycle.events, 'fixed-batch-fallback-events');
  });

  test('preserves the listening control when an authenticated socket closes mid-capture', async ({
    page,
  }) => {
    const lifecycle = await installLifecycle(page, { fakeCapture: true });
    await page.goto(`${BOARD}/api/household-auth/device?token=fixture`);
    await expect(page.locator('#voice-status')).toHaveText('Tap to ask NOX');
    await page.locator('#start').click();
    await expect(page.locator('#start')).toBeHidden();
    await page.locator('#mic').click();
    await expect(page.locator('#voice-status')).toHaveText('Listening… tap to stop');

    await lifecycle.closeSocket();
    await expect(page.locator('#voice-status')).toHaveText('Listening… tap to stop');
    await expect(page.locator('#mic')).toHaveAttribute('aria-label', 'Stop recording');
    await page.locator('#mic').click();
    await expect.poll(lifecycle.batchRequests).toBe(1);
    await recordSafeEvents(lifecycle.events, 'fixed-listening-recovery-events');
  });

  test('a failed client asset reaches a bounded reload-to-retry state instead of loading forever', async ({
    page,
  }) => {
    const lifecycle = await installLifecycle(page, { clientAsset: 'failed' });
    await page.goto(`${BOARD}/api/household-auth/device?token=fixture`);

    await expect(page.locator('#voice-status')).toHaveText(
      'NOX voice is unavailable. Tap to reload.',
      { timeout: 2_000 }
    );
    await expect(page.locator('#mic')).toHaveClass(/unavailable/);
    await expect(page.locator('#mic')).toHaveAttribute('aria-label', 'Reload NOX voice');
    await expect(page.locator('#voice-status')).toHaveAttribute('role', 'status');
    expect(lifecycle.events.some((event) => event.kind === 'requestfailed')).toBe(true);
    await recordSafeEvents(lifecycle.events, 'fixed-client-unavailable-events');

    await page.locator('#start').click();
    await expect(page.locator('#start')).toBeHidden();
    await captureEvidence(page, 'fixed-desktop-client-unavailable');
  });

  test('a failed iframe bridge reaches a bounded tap-to-retry state', async ({ page }) => {
    const lifecycle = await installLifecycle(page, { bridgeAsset: 'failed' });
    await page.goto(`${BOARD}/api/household-auth/device?token=fixture`);

    await expect(page.locator('#voice-status')).toHaveText(
      'NOX voice is unavailable. Tap to retry.',
      { timeout: 7_000 }
    );
    await expect(page.locator('#mic')).toHaveClass(/unavailable/);
    expect(lifecycle.ticketRequests()).toBe(0);
    expect(lifecycle.events.some((event) => event.kind === 'requestfailed')).toBe(true);
    await recordSafeEvents(lifecycle.events, 'fixed-bridge-unavailable-events');
  });

  test('a tap reloads and recovers an iframe whose bridge asset initially failed', async ({
    page,
  }) => {
    const lifecycle = await installLifecycle(page, { bridgeAsset: 'failed-once' });
    await page.goto(`${BOARD}/api/household-auth/device?token=fixture`);
    await expect(page.locator('#voice-status')).toHaveText(
      'NOX voice is unavailable. Tap to retry.',
      { timeout: 7_000 }
    );
    expect(lifecycle.bridgeRequests()).toBe(1);

    await page.locator('#start').click();
    await expect(page.locator('#start')).toBeHidden();
    await page.locator('#mic').click();
    await expect(page.locator('#voice-status')).toHaveText('Tap to ask NOX', { timeout: 5_000 });
    expect(lifecycle.bridgeRequests()).toBe(2);
    await recordSafeEvents(lifecycle.events, 'fixed-bridge-retry-events');
  });

  test('a socket that never accepts the ready contract reaches a bounded tap-to-retry state', async ({
    page,
  }) => {
    test.setTimeout(20_000);
    const lifecycle = await installLifecycle(page, { automaticSocketReady: false });
    await page.goto(`${BOARD}/api/household-auth/device?token=fixture`);

    await expect(page.locator('#voice-status')).toHaveText(
      'NOX voice is unavailable. Tap to retry.',
      { timeout: 15_000 }
    );
    await expect(page.locator('#mic')).toHaveClass(/unavailable/);
    expect(lifecycle.ticketRequests()).toBeGreaterThanOrEqual(3);
    expect(lifecycle.ticketRequests()).toBeLessThanOrEqual(4);
    expect(lifecycle.socketAuthentications()).toBeGreaterThanOrEqual(3);
    expect(lifecycle.socketAuthentications()).toBeLessThanOrEqual(4);
    expect(lifecycle.ticketRequests() - lifecycle.socketAuthentications()).toBeLessThanOrEqual(1);
    await recordSafeEvents(lifecycle.events, 'fixed-stream-unavailable-events');
  });
});
