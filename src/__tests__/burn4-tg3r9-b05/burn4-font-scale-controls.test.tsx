import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Burn4FontScaleBoundary, Burn4FontScaleControls } from '../../components/accessibility/burn4-font-scale-controls';
import { createFontScaleSession, type FontScaleValue } from '../../lib/burn4-font-scale';
import { viewFixture } from './burn4-fixtures';

afterEach(cleanup);

describe('controlled accessible font scale setting', () => {
  test('renders native labeled controls, help, Auto state and sample', () => {
    const change = jest.fn();
    render(<Burn4FontScaleControls value={null} onChange={change} />);
    const group = screen.getByRole('group', { name: 'Font size' });
    const input = screen.getByRole('textbox', { name: 'Text size percentage' });
    expect((input as HTMLInputElement).value).toBe('100');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('aria-describedby')).toContain(group.getAttribute('aria-describedby'));
    expect((screen.getByRole('radio', { name: 'Auto' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'Reset to Auto' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Auto (device default)')).toBeTruthy();
    expect(screen.getByText(/Sample:/)).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
  });
  test('a valid percentage proposes a value while host refusal retains authoritative input', () => {
    const change = jest.fn();
    render(<Burn4FontScaleControls value={100} onChange={change} />);
    const input = screen.getByRole('textbox', { name: 'Text size percentage' });
    input.focus();
    fireEvent.change(input, { target: { value: '150' } });
    expect(change).toHaveBeenCalledWith(150);
    expect((input as HTMLInputElement).value).toBe('100');
    expect(screen.getByText('100% of device default')).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });
  test('host acceptance updates input/output and switches to Custom', () => {
    function Host() {
      const [value, setValue] = useState<FontScaleValue>(null);
      return <Burn4FontScaleControls value={value} onChange={setValue} />;
    }
    render(<Host />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '125' } });
    expect(screen.getByText('125% of device default')).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Custom' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Auto' }));
    expect(screen.getByText('Auto (device default)')).toBeTruthy();
  });
  test.each(['', '4', '49', '201', '100.5', '1e2', 'Infinity', '-50', ' 100', '100 '])('invalid edit %s exposes an associated error without proposing', (text) => {
    const change = jest.fn();
    render(<Burn4FontScaleControls value={125} onChange={change} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: text } });
    const alert = screen.getByRole('alert');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
    expect((input as HTMLInputElement).value).toBe('125');
    expect(change).not.toHaveBeenCalled();
  });
  test('a valid replacement clears error and allows inclusive range endpoints', () => {
    const change = jest.fn();
    render(<Burn4FontScaleControls value={100} onChange={change} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '49' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '50' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(change).toHaveBeenLastCalledWith(50);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '200' } });
    expect(change).toHaveBeenLastCalledWith(200);
  });
  test('external host value change clears a prior draft error', () => {
    const change = jest.fn();
    const result = render(<Burn4FontScaleControls value={100} onChange={change} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '49' } });
    result.rerender(<Burn4FontScaleControls value={150} onChange={change} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('150');
  });
  test('radio actions propose Auto and default Custom without stealing host ownership', () => {
    const change = jest.fn();
    const result = render(<Burn4FontScaleControls value={null} onChange={change} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    expect(change).toHaveBeenLastCalledWith(100);
    expect(screen.getByText('Auto (device default)')).toBeTruthy();
    result.rerender(<Burn4FontScaleControls value={125} onChange={change} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(change).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('125% of device default')).toBeTruthy();
  });
  test('disabled fieldset blocks proposals and has minimum touch target dimensions', () => {
    const change = jest.fn();
    render(<Burn4FontScaleControls value={125} onChange={change} disabled />);
    expect((screen.getByRole('group') as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '150' } });
    expect(change).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLElement).style.minHeight).toBe('44px');
    expect((screen.getByRole('button') as HTMLElement).style.minHeight).toBe('44px');
  });
  test('malformed controlled value is explicit and can be reset', () => {
    const change = jest.fn();
    render(<Burn4FontScaleControls value={201} onChange={change} />);
    expect(screen.getByRole('alert').textContent).toContain('50 to 200');
    expect(screen.getByText('Invalid font size')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button'));
    expect(change).toHaveBeenCalledWith(null);
  });
  test('multiple controls have independent native names and description IDs', () => {
    const first = jest.fn();
    const second = jest.fn();
    render(<><Burn4FontScaleControls value={null} onChange={first} /><Burn4FontScaleControls value={150} onChange={second} /></>);
    const groups = screen.getAllByRole('group');
    const a = within(groups[0]!).getByRole('radio', { name: 'Custom' }) as HTMLInputElement;
    const b = within(groups[1]!).getByRole('radio', { name: 'Custom' }) as HTMLInputElement;
    expect(a.name).not.toBe(b.name);
    expect(groups[0]!.getAttribute('aria-describedby')).not.toBe(groups[1]!.getAttribute('aria-describedby'));
    fireEvent.click(a);
    expect(first).toHaveBeenCalledWith(100);
    expect(second).not.toHaveBeenCalled();
  });
});

describe('font scale lifecycle boundary', () => {
  test('applies, updates, resets and unmounts through the real React lifecycle', () => {
    const target = document.createElement('div');
    target.style.fontSize = '18px';
    const f = viewFixture(target);
    const result = render(<Burn4FontScaleBoundary target={target} view={f.view} scale={150}><span>Content</span></Burn4FontScaleBoundary>);
    expect(target.style.fontSize).toBe('27px');
    expect(screen.getByText('Content')).toBeTruthy();
    result.rerender(<Burn4FontScaleBoundary target={target} view={f.view} scale={200} />);
    expect(target.style.fontSize).toBe('36px');
    result.rerender(<Burn4FontScaleBoundary target={target} view={f.view} scale={null} />);
    expect(target.style.fontSize).toBe('18px');
    result.unmount();
    expect(f.activeCount()).toBe(0);
  });
  test('target replacement restores old target and fences stale old callbacks', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    a.style.fontSize = '18px';
    b.style.fontSize = '20px';
    const first = viewFixture(a);
    const second = viewFixture(b);
    const result = render(<Burn4FontScaleBoundary target={a} view={first.view} scale={150} />);
    const old = [...first.resize][0]!;
    result.rerender(<Burn4FontScaleBoundary target={b} view={second.view} scale={150} />);
    expect(a.style.fontSize).toBe('18px');
    expect(b.style.fontSize).toBe('30px');
    act(() => old());
    expect(a.style.fontSize).toBe('18px');
    expect(first.activeCount()).toBe(0);
    result.unmount();
    expect(b.style.fontSize).toBe('20px');
  });
  test('StrictMode setup/cleanup leaves one live owner and releases it on unmount', () => {
    const target = document.createElement('div');
    const f = viewFixture(target);
    const result = render(<StrictMode><Burn4FontScaleBoundary target={target} view={f.view} scale={150} /></StrictMode>);
    expect(target.style.fontSize).toBe('24px');
    expect(f.activeCount()).toBe(3);
    result.unmount();
    expect(target.style.fontSize).toBe('');
    expect(f.activeCount()).toBe(0);
    const next = createFontScaleSession({ target, readComputedFontSize: () => '16px' });
    next.dispose();
  });
  test('responsive changes and outside edits pass through boundary without clobbering', () => {
    const target = document.createElement('div');
    const f = viewFixture(target);
    const result = render(<Burn4FontScaleBoundary target={target} view={f.view} scale={125} />);
    f.setBase('20px');
    act(() => f.emitPointer());
    expect(target.style.fontSize).toBe('25px');
    target.style.fontSize = '19px';
    act(() => f.emitResize());
    expect(target.style.fontSize).toBe('19px');
    result.unmount();
    expect(target.style.fontSize).toBe('19px');
  });
  test('missing target or view is inert and can later attach', () => {
    const target = document.createElement('div');
    const f = viewFixture(target);
    const error = jest.fn();
    const result = render(<Burn4FontScaleBoundary target={null} view={f.view} scale={125} onError={error} />);
    expect(f.activeCount()).toBe(0);
    result.rerender(<Burn4FontScaleBoundary target={target} view={null} scale={125} onError={error} />);
    expect(f.activeCount()).toBe(0);
    result.rerender(<Burn4FontScaleBoundary target={target} view={f.view} scale={125} onError={error} />);
    expect(target.style.fontSize).toBe('20px');
    expect(error).not.toHaveBeenCalled();
    result.unmount();
  });
  test('invalid value reports failure without replacing the last accepted scale', () => {
    const target = document.createElement('div');
    const f = viewFixture(target);
    const error = jest.fn();
    const result = render(<Burn4FontScaleBoundary target={target} view={f.view} scale={125} onError={error} />);
    result.rerender(<Burn4FontScaleBoundary target={target} view={f.view} scale={201} onError={error} />);
    expect(error).toHaveBeenCalledWith('Choose Auto or a whole percentage from 50 to 200.');
    expect(target.style.fontSize).toBe('20px');
    result.unmount();
  });
  test('duplicate boundary reports ownership error while preserving the original session', () => {
    const target = document.createElement('div');
    const f = viewFixture(target);
    const error = jest.fn();
    const first = render(<Burn4FontScaleBoundary target={target} view={f.view} scale={125} />);
    const second = render(<Burn4FontScaleBoundary target={target} view={f.view} scale={150} onError={error} />);
    expect(error).toHaveBeenCalledWith('The font-size target could not be attached.');
    expect(target.style.fontSize).toBe('20px');
    second.unmount();
    expect(target.style.fontSize).toBe('20px');
    first.unmount();
  });
});
