'use client';
import { useEffect } from 'react';
import { installProbe } from '@/lib/diagnostics/generated-probe';
import pins from '@/lib/diagnostics/generated-pins.json';

type Grant = { id: string; operation: 'measure' | 'scroll'; deadline: number };
// Fixed diagnostic entry, no evaluation strings or navigation/input commands.
export async function runAcceptanceEntry() {
  const w = window as typeof window & {
    __nox11625Entry?: boolean;
    __nox11625AcceptanceProbe?: any;
    __nox11625EntryResult?: unknown;
  };
  if (w.__nox11625Entry) return;
  Object.defineProperty(w, '__nox11625Entry', { value: true });
  const documentId = crypto.randomUUID(),
    endpoint = '/api/kyst-diagnostics';
  let config: any, marker: HTMLDivElement | undefined;
  const call = async (action: string, body: unknown = {}, terminal = false) => {
    if (!terminal && Date.now() >= config.expires) throw new Error('Session expired');
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 5000);
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, session: config.session, document: documentId, body }),
        signal: controller.signal,
      });
      if (!r.ok) throw new Error('Collector ' + r.status + ': ' + (await r.text()));
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  };
  const geometry = () => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    scale: visualViewport?.scale ?? 1,
  });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    const response = await fetch(endpoint, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Entry not active');
    config = await response.json();
    if (!config) return;
    if (
      config.origin !== location.origin ||
      location.pathname !== '/' ||
      window.parent === window ||
      config.build !== pins.build ||
      config.probe !== pins.probe
    )
      throw new Error('Wrong iframe/origin/build/probe');
    const initial = geometry();
    const claim = await call('claim', {
      origin: location.origin,
      pathname: location.pathname,
      iframe: true,
      build: pins.build,
      probe: pins.probe,
      geometry: initial,
    });
    // Wait only for this document's initial hydration; never navigate or dismiss a prompt.
    const readyUntil = Math.min(Date.now() + 15000, config.expires);
    while (
      !document.querySelector('[data-kyst-theme="nox"] .kyst-widget') &&
      Date.now() < readyUntil
    )
      await sleep(250);
    installProbe(config.origin);
    const p = w.__nox11625AcceptanceProbe;
    if (!p) throw new Error('Probe installation failed');
    if (JSON.stringify(initial) !== JSON.stringify(geometry()))
      throw new Error('Entry geometry changed');
    marker = document.createElement('div');
    marker.textContent = 'Diagnostic identity ' + claim.challenge;
    marker.setAttribute('role', 'status');
    marker.dataset.kystDiagnosticIdentity = '';
    Object.assign(marker.style, {
      position: 'fixed',
      left: 'var(--nox-gap)',
      bottom: 'var(--nox-gap)',
      zIndex: '2147483647',
      font: '700 26px var(--nox-mono)',
      color: 'var(--nox-text)',
      background: 'var(--nox-void)',
      padding: 'calc(var(--nox-gap) / 2)',
      maxWidth: 'calc(100% - 2 * var(--nox-gap))',
      overflowWrap: 'anywhere',
      pointerEvents: 'none',
    });
    document.querySelector('[data-kyst-theme="nox"]')!.append(marker);
    await call('ready', { initial, widgets: 7 });
    const running = new Set<string>();
    while (Date.now() < config.expires) {
      if (document.hidden || JSON.stringify(initial) !== JSON.stringify(geometry()))
        throw new Error('Visibility/viewport/scale changed');
      const message = await call('poll');
      if (message.verified) {
        marker?.remove();
        marker = undefined;
      }
      const grant: Grant | undefined = message.grant;
      if (grant) {
        marker?.remove();
        marker = undefined;
      }
      if (!grant) {
        await sleep(1000);
        continue;
      }
      if (running.has(grant.operation) || Date.now() >= grant.deadline)
        throw new Error('Duplicate/expired grant');
      running.add(grant.operation);
      let result: any;
      try {
        if (grant.operation === 'measure') result = await p.measure();
        else if (grant.operation === 'scroll') {
          const pending = p.scrollAndRestore();
          try {
            while (p.output.scroll?.phase === 'moving') await sleep(25);
            if (p.output.scroll?.phase === 'scrolled_capture_window') {
              await call('window', {
                grant: grant.id,
                from: Date.parse(p.output.scroll.captureFrom),
                until: Date.parse(p.output.scroll.captureDeadline),
              });
              while (
                p.output.scroll.phase === 'scrolled_capture_window' &&
                Date.now() < config.expires
              ) {
                const capture = (await call('poll')).capture;
                if (capture) {
                  p.acknowledgeCapture(capture);
                  break;
                }
                await sleep(500);
              }
            }
          } catch (error) {
            p.output.scroll.transportError = String(error);
          }
          // Always await same-node cleanup even on expired/lost collector acknowledgement.
          result = await pending;
        } else throw new Error('Unknown operation');
      } catch (error) {
        result = {
          phase: 'terminal',
          ok: false,
          restoreVerified: false,
          error: String(error),
          completedAt: new Date().toISOString(),
        };
      }
      await call('terminal', { operation: grant.operation, grant: grant.id, result }, true);
      if (!result.ok || !result.restoreVerified)
        throw new Error('Operation/cleanup failed; no continuation');
    }
    w.__nox11625EntryResult = { terminal: true, reason: 'expired' };
  } catch (error) {
    w.__nox11625EntryResult = { terminal: true, error: String(error) };
    console.error('NOX-11625 entry stopped', String(error));
  } finally {
    marker?.remove();
  }
}
export function AcceptanceEntry() {
  useEffect(() => {
    void runAcceptanceEntry();
  }, []);
  return null;
}
