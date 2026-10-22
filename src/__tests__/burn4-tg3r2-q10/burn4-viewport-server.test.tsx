/** @jest-environment node */

import { renderToString } from 'react-dom/server';
import { useViewportSize, type ViewportSize } from '@/lib/hooks/useViewportSize';

test('server renders independent zero-size snapshots without a window binding', () => {
  expect(typeof window).toBe('undefined');
  const snapshots: ViewportSize[] = [];
  function ServerConsumer() {
    const size = useViewportSize();
    snapshots.push(size);
    return <output data-testid="server-viewport">{size.width}x{size.height}</output>;
  }

  expect(renderToString(<ServerConsumer />)).toBe(
    '<output data-testid="server-viewport">0<!-- -->x<!-- -->0</output>'
  );
  expect(renderToString(<ServerConsumer />)).toBe(
    '<output data-testid="server-viewport">0<!-- -->x<!-- -->0</output>'
  );
  expect(snapshots).toEqual([{ width: 0, height: 0 }, { width: 0, height: 0 }]);
  expect(snapshots[0]).not.toBe(snapshots[1]);
  expect(typeof window).toBe('undefined');
});
