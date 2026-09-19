import { chromium, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.PRISM_URL || 'http://127.0.0.1:33185';
const outputDir = path.resolve('docs/evidence/nox-11685');
const expectedSocket = 'wss://cb-threadripper.tail3a8e2d.ts.net:8445/voice';

async function installVoiceMocks(page: Page) {
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const fixtures: Record<string, unknown> = {
      '/api/setup/status': { complete: true },
      '/api/family': { members: [] },
      '/api/layouts': { layouts: [] },
      '/api/auth/session': { user: null },
      '/api/settings': { settings: {} },
    };
    const fixture = fixtures[pathname];
    await route.fulfill({
      status: fixture ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify(fixture || { error: 'No fixture for optional data' }),
    });
  });
  await page.route('**/api/nox-voice/ticket', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: expectedSocket, token: 'screenshot-only-ticket' }),
    });
  });

  // tsx names transformed class methods with this helper; define it in the browser realm first.
  await page.addInitScript({ content: 'globalThis.__name = (target) => target;' });
  await page.addInitScript(() => {
    type Listener = (event: { data?: string | ArrayBuffer }) => void;

    class FakeTrack {
      stop() {}
    }
    class FakeStream {
      getTracks() {
        return [new FakeTrack()];
      }
    }
    class FakeWebSocket {
      static OPEN = 1;
      static instances: FakeWebSocket[] = [];
      binaryType = 'blob';
      readyState = 0;
      private listeners = new Map<string, Listener[]>();
      private requestId = '';

      constructor(public url: string) {
        FakeWebSocket.instances.push(this);
        queueMicrotask(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatch('open', {});
        });
      }

      addEventListener(type: string, listener: Listener) {
        this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
      }

      send(data: string | ArrayBuffer) {
        if (typeof data !== 'string') return;
        const message = JSON.parse(data) as { type: string; requestId?: string };
        if (message.type === 'auth') {
          queueMicrotask(() =>
            this.message({
              type: 'ready',
              contract: 1,
              pipeline: 'pipecat',
              audioFormat: 'pcm16',
            })
          );
        } else if (message.type === 'start' && message.requestId) {
          this.requestId = message.requestId;
        } else if (message.type === 'end_of_speech') {
          const requestId = this.requestId;
          queueMicrotask(() => {
            this.message({
              type: 'transcript.delta',
              requestId,
              text: 'What is on the calendar today?',
            });
            this.message({ type: 'answer.delta', requestId, text: 'Dinner is at six, ' });
            this.message({ type: 'answer.delta', requestId, text: 'and pickup is at four.' });
            this.message({ type: 'audio.start', requestId, format: 'pcm16' });
          });
        }
      }

      close() {
        this.readyState = 3;
      }

      private message(payload: Record<string, unknown>) {
        this.dispatch('message', { data: JSON.stringify(payload) });
      }

      private dispatch(type: string, event: { data?: string | ArrayBuffer }) {
        for (const listener of this.listeners.get(type) || []) listener(event);
      }
    }

    class FakeAudioContext {
      state = 'running';
      sampleRate = 48_000;
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createAnalyser() {
        return {
          fftSize: 256,
          getByteTimeDomainData(samples: Uint8Array) {
            samples.forEach((_, index) => {
              samples[index] = index % 2 ? 141 : 115;
            });
          },
        };
      }
      createScriptProcessor() {
        return { connect() {}, disconnect() {}, onaudioprocess: null };
      }
      createGain() {
        return { gain: { value: 1 }, connect() {}, disconnect() {} };
      }
      createBuffer(_channels: number, length: number, rate: number) {
        return {
          duration: length / rate,
          getChannelData: () => new Float32Array(length),
        };
      }
      createBufferSource() {
        return {
          buffer: null,
          onended: null,
          connect() {},
          start() {},
          stop() {},
        };
      }
    }

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => new FakeStream() },
    });
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: FakeWebSocket });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  });
}

function channel(value: number) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: number[]) {
  return 0.2126 * channel(rgb[0]!) + 0.7152 * channel(rgb[1]!) + 0.0722 * channel(rgb[2]!);
}

function contrast(foreground: number[], background: number[]) {
  const [bright, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (bright! + 0.05) / (dark! + 0.05);
}

function parseRgb(color: string) {
  const values = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  assert(values?.length === 3, `Expected an RGB color, received ${color}`);
  return values;
}

async function capture(width: number, height: number, label: string) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL,
      viewport: { width, height },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => console.error(`[${label}] page error:`, error));
    await installVoiceMocks(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const mic = page.getByRole('button', { name: 'Ask NOX by voice' });
    await mic.waitFor({ state: 'visible' });
    await page.waitForTimeout(250);
    await mic.focus();
    const idleAudit = await mic.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        label: button.getAttribute('aria-label'),
        pressed: button.getAttribute('aria-pressed'),
        width: rect.width,
        height: rect.height,
        boxShadow: style.boxShadow,
        bottom: Math.round(innerHeight - rect.bottom),
        right: Math.round(innerWidth - rect.right),
      };
    });
    assert(idleAudit.width >= 56 && idleAudit.height >= 56, 'Mic target must be at least 56x56');
    assert.notEqual(idleAudit.boxShadow, 'none', 'Focused mic must have a visible focus ring');
    await page.screenshot({ path: path.join(outputDir, `${label}-idle.png`), fullPage: true });

    await mic.click();
    const stop = page.getByRole('button', { name: 'Stop and send voice question' });
    try {
      await stop.waitFor({ state: 'visible', timeout: 5_000 });
    } catch (error) {
      console.error(
        `[${label}] voice controls after tap:`,
        await page.locator('[data-voice-assistant-active]').evaluate((element) => ({
          text: element.textContent?.replace(/\s+/g, ' ').trim(),
          labels: Array.from(element.querySelectorAll('button')).map((button) =>
            button.getAttribute('aria-label')
          ),
        }))
      );
      throw error;
    }
    await page.getByRole('status').getByText('Listening…').waitFor();
    await page.screenshot({ path: path.join(outputDir, `${label}-listening.png`), fullPage: true });

    await stop.click();
    const status = page.getByRole('status');
    await status.getByText('What is on the calendar today?').waitFor();
    await status.getByText('Dinner is at six, and pickup is at four.').waitFor();
    await status.getByText('NOX is speaking').waitFor();
    await page.screenshot({ path: path.join(outputDir, `${label}-answer.png`), fullPage: true });

    const answerAudit = await status.evaluate((element) => {
      const panelStyle = getComputedStyle(element);
      const answer = Array.from(element.querySelectorAll('p')).find((node) =>
        node.textContent?.includes('Dinner is at six')
      )!;
      const answerStyle = getComputedStyle(answer);
      const close = element.querySelector<HTMLButtonElement>(
        'button[aria-label="Close voice assistant"]'
      )!;
      const closeRect = close.getBoundingClientRect();
      return {
        live: element.getAttribute('aria-live'),
        atomic: element.getAttribute('aria-atomic'),
        answerColor: answerStyle.color,
        panelColor: panelStyle.backgroundColor,
        closeWidth: closeRect.width,
        closeHeight: closeRect.height,
        text: element.textContent?.replace(/\s+/g, ' ').trim(),
      };
    });
    const close = page.getByRole('button', { name: 'Close voice assistant' });
    await close.focus();
    await page.keyboard.press('Tab');
    const forwardFocus = await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label')
    );
    await page.keyboard.press('Shift+Tab');
    const reverseFocus = await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label')
    );
    assert.equal(forwardFocus, 'Interrupt and ask NOX');
    assert.equal(reverseFocus, 'Close voice assistant');
    const ratio = contrast(parseRgb(answerAudit.answerColor), parseRgb(answerAudit.panelColor));
    assert(ratio >= 4.5, `Answer contrast ${ratio.toFixed(2)}:1 must meet WCAG AA`);
    assert(
      answerAudit.closeWidth >= 44 && answerAudit.closeHeight >= 44,
      'Close target must be 44x44'
    );

    console.log(
      JSON.stringify({
        viewport: `${width}x${height}`,
        idle: idleAudit,
        status: answerAudit,
        focusOrder: ['Close voice assistant', forwardFocus],
        answerContrast: `${ratio.toFixed(2)}:1`,
      })
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  assert(
    ['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname),
    'Use a local preview only'
  );
  await fs.mkdir(outputDir, { recursive: true });
  await capture(1920, 1080, 'desktop');
  await capture(390, 844, 'mobile');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
