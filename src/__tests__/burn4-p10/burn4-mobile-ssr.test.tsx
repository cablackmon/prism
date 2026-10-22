/** @jest-environment node */

import { renderToString } from 'react-dom/server';
import { getMobileLayout, useMobileLayout } from '@/lib/hooks/useMobileLayout';
import { loadHiddenCards, useMobileCardOrder } from '@/components/dashboard/useMobileCardOrder';

test('mobile preference getters provide defaults without a browser', () => {
  expect(typeof window).toBe('undefined');
  expect(getMobileLayout()).toBe('rows');
  expect(loadHiddenCards()).toEqual(expect.arrayContaining(['clock', 'photos']));
});

test('mobile preference hooks can render on the server without browser storage', () => {
  let layout: string | undefined;
  let order: string[] = [];
  function Probe() {
    const layoutState = useMobileLayout();
    const cardState = useMobileCardOrder();
    layout = layoutState.layout;
    order = cardState.order;
    return <main data-layout={layout}><span>{order[0]}</span></main>;
  }
  expect(renderToString(<Probe />)).toContain('data-layout="rows"');
  expect(layout).toBe('rows');
  expect(order).toEqual(expect.arrayContaining(['weather', 'calendar', 'tasks']));
  expect(new Set(order).size).toBe(order.length);
});
