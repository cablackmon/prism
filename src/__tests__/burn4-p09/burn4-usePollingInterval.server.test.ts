/** @jest-environment node */

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { usePollingInterval } from '@/lib/hooks/usePollingInterval';
import { useOrientation } from '@/lib/hooks/useOrientation';
import { useScreenOrientation } from '@/lib/hooks/useScreenOrientation';
import { useIsPWA } from '@/lib/hooks/useIsPWA';
import { useIsTouch } from '@/lib/hooks/useIsTouch';
import { useIsMobile } from '@/lib/hooks/useIsMobile';

test('burn4 server rendering uses the default interval without browser globals', () => {
  function Interval() {
    const interval = usePollingInterval(120_000);
    return createElement('span', null, interval);
  }
  expect(renderToString(createElement(Interval))).toBe('<span>120000</span>');
});

test('burn4 device hooks render their stable server defaults without browser globals', () => {
  function Device() {
    const state = { orientation: useOrientation(), screen: useScreenOrientation(), pwa: useIsPWA(), touch: useIsTouch(), mobile: useIsMobile() };
    return createElement('span', null, JSON.stringify(state));
  }
  const html = renderToString(createElement(Device));
  expect(html).toContain('&quot;orientation&quot;:&quot;landscape&quot;');
  expect(html).toContain('&quot;screen&quot;:&quot;landscape&quot;');
  expect(html).toContain('&quot;pwa&quot;:false');
  expect(html).toContain('&quot;touch&quot;:false');
  expect(html).toContain('&quot;mobile&quot;:false');
});
