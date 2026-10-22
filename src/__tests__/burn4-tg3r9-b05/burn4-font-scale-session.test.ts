import { createDocumentFontScaleSession, createFontScaleSession } from '../../lib/burn4-font-scale';
import { sessionFixture, viewFixture } from './burn4-fixtures';

describe('reversible responsive font scale session', () => {
  test.each([14, 16, 18, 20, 22])('scales documented %spx baseline without compounding', (base) => {
    const f = sessionFixture();
    f.setBase(`${base}px`);
    expect(f.session.setScale(150)).toEqual({ ok: true, status: 'applied', scale: 150 });
    expect(f.target.style.fontSize).toBe(`${base * 1.5}px`);
    expect(f.target.style.getPropertyPriority('font-size')).toBe('important');
    f.session.setScale(150);
    f.session.refresh();
    expect(f.target.style.fontSize).toBe(`${base * 1.5}px`);
    f.session.dispose();
    expect(f.target.style.fontSize).toBe('');
  });
  test.each([[50, '8px'], [100, '16px'], [200, '32px']] as const)('applies %s percent exactly', (scale, expected) => {
    const f = sessionFixture();
    f.session.setScale(scale);
    expect(f.target.style.fontSize).toBe(expected);
    f.session.dispose();
  });
  test.each(['', 'important'])('restores the original inline size and priority %s on Auto', (priority) => {
    const f = sessionFixture('18px', priority);
    f.target.style.color = 'red';
    f.session.setScale(150);
    expect(f.target.style.fontSize).toBe('27px');
    f.session.setScale(null);
    expect(f.target.style.fontSize).toBe('18px');
    expect(f.target.style.getPropertyPriority('font-size')).toBe(priority);
    expect(f.target.style.color).toBe('red');
    f.session.dispose();
  });
  test('removes only its own property when the initial size was absent', () => {
    const f = sessionFixture();
    f.target.style.setProperty('--unrelated', 'yes');
    f.session.setScale(125);
    f.session.setScale(null);
    expect(f.target.style.getPropertyValue('font-size')).toBe('');
    expect(f.target.style.getPropertyValue('--unrelated')).toBe('yes');
    f.session.dispose();
  });
  test('refresh measures a changed responsive baseline', () => {
    const f = sessionFixture();
    f.session.setScale(125);
    f.setBase('20px');
    f.emit();
    expect(f.target.style.fontSize).toBe('25px');
    f.setBase('14px');
    f.session.refresh();
    expect(f.target.style.fontSize).toBe('17.5px');
    f.session.dispose();
  });
  test('Auto leaves responsive CSS in charge without measuring', () => {
    const f = sessionFixture();
    f.emit();
    f.session.setScale(null);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.target.style.fontSize).toBe('');
    f.session.dispose();
  });
  test.each(['', 'normal', '16', '16em', '-1px', '0px', '1025px', 'Infinitypx', 'NaNpx', '16px trailing', '0.0000001px'])('rejects malformed computed baseline %s and restores owned style', (computed) => {
    const f = sessionFixture();
    f.session.setScale(125);
    f.setBase(computed);
    expect(f.session.refresh().ok).toBe(false);
    expect(f.target.style.fontSize).toBe('20px');
    expect(f.target.style.getPropertyPriority('font-size')).toBe('important');
    f.session.setScale(null);
    expect(f.target.style.fontSize).toBe('');
    f.session.dispose();
  });
  test('restores the last owned size when baseline measurement throws', () => {
    const f = sessionFixture();
    f.session.setScale(125);
    f.read.mockImplementationOnce(() => {
      expect(f.target.style.fontSize).toBe('');
      throw new Error('synthetic measure failure');
    });
    expect(f.session.setScale(200).ok).toBe(false);
    expect(f.target.style.fontSize).toBe('20px');
    f.setBase('20px');
    f.session.refresh();
    expect(f.target.style.fontSize).toBe('25px');
    f.session.dispose();
  });
  test('first failed measurement preserves original inline priority', () => {
    const f = sessionFixture('18px', 'important');
    f.read.mockImplementationOnce(() => { throw new Error('synthetic'); });
    expect(f.session.setScale(150).ok).toBe(false);
    expect(f.target.style.fontSize).toBe('18px');
    expect(f.target.style.getPropertyPriority('font-size')).toBe('important');
    f.session.dispose();
  });
  test('invalid deliberate input changes neither style nor selected scale', () => {
    const f = sessionFixture();
    f.session.setScale(125);
    expect(f.session.setScale('150').ok).toBe(false);
    f.setBase('20px');
    f.session.refresh();
    expect(f.target.style.fontSize).toBe('25px');
    f.session.dispose();
  });
  test('fractional baseline is rounded deterministically without cumulative drift', () => {
    const f = sessionFixture();
    f.setBase('16.333333px');
    f.session.setScale(133);
    const first = f.target.style.fontSize;
    for (let i = 0; i < 10; i++) f.session.refresh();
    expect(first).toBe('21.723333px');
    expect(f.target.style.fontSize).toBe(first);
    f.session.dispose();
  });
  test('independent targets have independent owners', () => {
    const a = sessionFixture();
    const b = sessionFixture();
    a.session.setScale(150);
    b.session.setScale(75);
    expect(a.target.style.fontSize).toBe('24px');
    expect(b.target.style.fontSize).toBe('12px');
    a.session.dispose();
    expect(b.target.style.fontSize).toBe('12px');
    b.session.dispose();
  });
  test('rejects duplicate target ownership and releases ownership on disposal', () => {
    const f = sessionFixture();
    expect(() => createFontScaleSession({ target: f.target, readComputedFontSize: () => '16px' })).toThrow('active session');
    f.session.dispose();
    const next = createFontScaleSession({ target: f.target, readComputedFontSize: () => '16px' });
    next.setScale(200);
    expect(f.target.style.fontSize).toBe('32px');
    f.session.dispose();
    expect(f.target.style.fontSize).toBe('32px');
    next.dispose();
  });
  test('passive refresh yields to an external inline edit and never measures over it', () => {
    const f = sessionFixture();
    f.session.setScale(150);
    f.target.style.setProperty('font-size', '19px', 'important');
    f.read.mockClear();
    expect(f.session.refresh()).toEqual({ ok: true, status: 'yielded', scale: 150 });
    f.emit();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.target.style.fontSize).toBe('19px');
    f.session.dispose();
    expect(f.target.style.fontSize).toBe('19px');
  });
  test('priority-only external change is preserved', () => {
    const f = sessionFixture();
    f.session.setScale(150);
    f.target.style.setProperty('font-size', '24px', '');
    expect(f.session.refresh()).toMatchObject({ status: 'yielded' });
    f.session.dispose();
    expect(f.target.style.fontSize).toBe('24px');
    expect(f.target.style.getPropertyPriority('font-size')).toBe('');
  });
  test('deliberate setScale reclaims an external inline value as new baseline', () => {
    const f = sessionFixture();
    f.session.setScale(150);
    f.target.style.setProperty('font-size', '20px', 'important');
    f.session.setScale(125);
    expect(f.target.style.fontSize).toBe('25px');
    f.session.setScale(null);
    expect(f.target.style.fontSize).toBe('20px');
    expect(f.target.style.getPropertyPriority('font-size')).toBe('important');
    f.session.dispose();
  });
  test('Auto after an external edit preserves the edit', () => {
    const f = sessionFixture();
    f.session.setScale(150);
    f.target.style.fontSize = '21px';
    f.session.setScale(null);
    f.emit();
    expect(f.target.style.fontSize).toBe('21px');
    f.session.dispose();
  });
  test('edits made during Auto become the next custom baseline', () => {
    const f = sessionFixture();
    f.target.style.fontSize = '20px';
    f.session.setScale(150);
    expect(f.target.style.fontSize).toBe('30px');
    f.session.dispose();
    expect(f.target.style.fontSize).toBe('20px');
  });
  test('disposing an externally changed target retains the external value without refresh', () => {
    const f = sessionFixture();
    f.session.setScale(150);
    f.target.style.fontSize = '17px';
    f.session.dispose();
    expect(f.target.style.fontSize).toBe('17px');
  });
  test('disposal is idempotent and fences saved callbacks and later commands', () => {
    const f = sessionFixture();
    f.session.setScale(150);
    const saved = f.savedListener();
    f.session.dispose();
    f.target.style.fontSize = '18px';
    saved?.();
    f.session.dispose();
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(f.session.setScale(200).ok).toBe(false);
    expect(f.session.refresh().ok).toBe(false);
    expect(f.target.style.fontSize).toBe('18px');
  });
  test('subscription construction failure releases target reservation', () => {
    const target = document.createElement('div');
    expect(() => createFontScaleSession({ target, readComputedFontSize: () => '16px', subscribeBaselineChanges() { throw new Error('subscribe'); } })).toThrow('subscribe');
    const session = createFontScaleSession({ target, readComputedFontSize: () => '16px' });
    session.dispose();
  });
});

describe('explicit browser adapter', () => {
  test.each([false, true])('listens to resize and pointer changes, legacy=%s', (legacy) => {
    const target = document.createElement('div');
    const f = viewFixture(target, legacy);
    const session = createDocumentFontScaleSession(target, f.view);
    expect(f.activeCount()).toBe(3);
    session.setScale(150);
    f.setBase('20px');
    f.emitResize();
    expect(target.style.fontSize).toBe('30px');
    f.setBase('14px');
    f.emitPointer();
    expect(target.style.fontSize).toBe('21px');
    f.setBase('22px');
    f.emitPointer('(pointer: coarse)');
    expect(target.style.fontSize).toBe('33px');
    session.dispose();
    expect(f.activeCount()).toBe(0);
    expect(target.style.fontSize).toBe('');
  });
  test('works without matchMedia and removes its resize listener', () => {
    const target = document.createElement('div');
    const f = viewFixture(target);
    delete f.view.matchMedia;
    const session = createDocumentFontScaleSession(target, f.view);
    session.setScale(150);
    expect(target.style.fontSize).toBe('24px');
    expect(f.activeCount()).toBe(1);
    session.dispose();
    expect(f.activeCount()).toBe(0);
  });
  test('partial browser subscription failure rolls back listeners and target reservation', () => {
    const target = document.createElement('div');
    const f = viewFixture(target);
    f.view.matchMedia = () => { throw new Error('unsupported'); };
    expect(() => createDocumentFontScaleSession(target, f.view)).toThrow('unsupported');
    expect(f.activeCount()).toBe(0);
    const session = createFontScaleSession({ target, readComputedFontSize: () => '16px' });
    session.dispose();
  });
  test('browser measurement throw restores the actual DOM style and priority', () => {
    const target = document.createElement('div');
    target.style.setProperty('font-size', '18px', 'important');
    const f = viewFixture(target);
    const session = createDocumentFontScaleSession(target, f.view);
    session.setScale(150);
    f.read.mockImplementationOnce(() => {
      expect(target.style.fontSize).toBe('18px');
      expect(target.style.getPropertyPriority('font-size')).toBe('important');
      throw new Error('synthetic browser measurement');
    });
    expect(session.setScale(200).ok).toBe(false);
    expect(target.style.fontSize).toBe('27px');
    expect(target.style.getPropertyPriority('font-size')).toBe('important');
    session.dispose();
    expect(target.style.fontSize).toBe('18px');
  });
  test('uses the actual DOM computed-style reader against restored baseline', () => {
    const target = document.createElement('div');
    target.style.setProperty('font-size', '18px', 'important');
    document.body.append(target);
    const session = createDocumentFontScaleSession(target, window);
    session.setScale(150);
    expect(window.getComputedStyle(target).fontSize).toBe('27px');
    session.setScale(200);
    expect(window.getComputedStyle(target).fontSize).toBe('36px');
    session.dispose();
    expect(target.style.fontSize).toBe('18px');
    expect(target.style.getPropertyPriority('font-size')).toBe('important');
    target.remove();
  });
});
