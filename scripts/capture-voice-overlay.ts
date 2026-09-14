import { chromium, type Page } from '@playwright/test';
import path from 'node:path';

const baseURL = process.env.PRISM_URL || 'http://127.0.0.1:3000';
const outputDir = path.resolve('docs/evidence/nox-11593');

async function installVoiceMocks(page: Page) {
  await page.addInitScript(() => {
    class FakeTrack {
      stop() {}
    }
    class FakeStream {
      getTracks() {
        return [new FakeTrack()];
      }
    }
    class FakeRecorder {
      static isTypeSupported() {
        return true;
      }
      state: RecordingState = 'inactive';
      mimeType = 'audio/webm;codecs=opus';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) } as BlobEvent);
        this.onstop?.();
      }
    }
    class FakeAudioContext {
      currentTime = 0;
      destination = {};
      createOscillator() {
        return {
          type: 'sine',
          frequency: { setValueAtTime() {} },
          connect() {},
          start() {},
          stop() {},
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
        };
      }
      createAnalyser() {
        return {
          fftSize: 256,
          getByteTimeDomainData(samples: Uint8Array) {
            samples.fill(128);
          },
        };
      }
      createMediaStreamSource() {
        return { connect() {} };
      }
      close() {
        return Promise.resolve();
      }
    }
    class FakeAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url?: string) {}
      play() {
        return Promise.resolve();
      }
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => new FakeStream() },
    });
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FakeRecorder });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
    Object.defineProperty(window, 'Audio', { configurable: true, value: FakeAudio });
  });
}

async function capture(width: number, height: number, label: string) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await installVoiceMocks(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const mic = page.getByRole('button', { name: 'Ask NOX by voice' });
  await mic.waitFor({ state: 'visible' });

  await mic.evaluate((button) => {
    (button.parentElement as HTMLElement).style.display = 'none';
  });
  await page.screenshot({ path: path.join(outputDir, `${label}-before.png`) });
  await mic.evaluate((button) => {
    (button.parentElement as HTMLElement).style.removeProperty('display');
  });
  await page.screenshot({ path: path.join(outputDir, `${label}-idle.png`) });
  await mic.focus();
  const idleAudit = await mic.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      label: button.getAttribute('aria-label'),
      width: rect.width,
      height: rect.height,
      focusOutline: style.outlineStyle,
      focusRingWidth: style.getPropertyValue('--tw-ring-offset-width'),
    };
  });

  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('prism:voice-assistant', {
        detail: { owner: 'wake', phase: 'listening' },
      })
    );
  });
  await page.getByRole('status').getByText('Listening…').waitFor();
  await page.screenshot({ path: path.join(outputDir, `${label}-listening.png`) });

  await page.evaluate(() => {
    const wav = new Uint8Array([
      82, 73, 70, 70, 38, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 64,
      31, 0, 0, 128, 62, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97, 2, 0, 0, 0, 0, 0,
    ]);
    window.dispatchEvent(
      new CustomEvent('prism:voice-assistant', {
        detail: {
          owner: 'wake',
          answer: 'Today is Sunday, August 30th.',
          audioUrl: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })),
        },
      })
    );
  });
  await page.getByRole('status').getByText('Today is Sunday, August 30th.').waitFor();
  await page.waitForTimeout(650);
  await page.screenshot({ path: path.join(outputDir, `${label}-answer.png`) });

  const statusAudit = await page.getByRole('status').evaluate((status) => ({
    live: status.getAttribute('aria-live'),
    text: status.textContent?.replace(/\s+/g, ' ').trim(),
  }));
  console.log(JSON.stringify({ viewport: `${width}x${height}`, idleAudit, statusAudit }));
  await browser.close();
}

async function main() {
  await capture(1440, 900, 'desktop');
  await capture(390, 844, 'mobile');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
