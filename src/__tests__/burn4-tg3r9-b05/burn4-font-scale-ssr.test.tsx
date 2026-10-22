/** @jest-environment node */
import { renderToString } from 'react-dom/server';
import { Burn4FontScaleBoundary, Burn4FontScaleControls } from '../../components/accessibility/burn4-font-scale-controls';
import { parseFontScale } from '../../lib/burn4-font-scale';

test('imports and server-renders without window, document or ambient DOM capabilities', () => {
  expect(typeof window).toBe('undefined');
  expect(typeof document).toBe('undefined');
  expect(parseFontScale(150)).toEqual({ ok: true, value: 150 });
  const change = jest.fn();
  const html = renderToString(<Burn4FontScaleBoundary target={null} view={null} scale={150}>
    <Burn4FontScaleControls value={150} onChange={change} />
  </Burn4FontScaleBoundary>);
  expect(html).toContain('150% of device default');
  expect(html).toContain('Font size');
  expect(change).not.toHaveBeenCalled();
});
