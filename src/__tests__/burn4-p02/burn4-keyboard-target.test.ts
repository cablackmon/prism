/** @jest-environment jsdom */
import { isVirtualKeyboardTarget } from '@/lib/input/keyboardTarget';

describe('virtual keyboard event target classification', () => {
  afterEach(() => document.body.replaceChildren());

  test.each([null, undefined])('rejects an absent target: %s', (target) => {
    expect(isVirtualKeyboardTarget(target)).toBe(false);
  });

  test('rejects nodes without an Element closest method', () => {
    expect(isVirtualKeyboardTarget(document.createTextNode('text') as unknown as Element))
      .toBe(false);
    expect(isVirtualKeyboardTarget({ className: 'hg-button' } as Element)).toBe(false);
  });

  test('recognizes a child and the root of an attached keyboard wrapper', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-virtual-keyboard', '');
    const key = document.createElement('button');
    const label = document.createElement('span');
    key.append(label);
    wrapper.append(key);
    document.body.append(wrapper);
    expect(isVirtualKeyboardTarget(wrapper)).toBe(true);
    expect(isVirtualKeyboardTarget(label)).toBe(true);
  });

  test('recognizes the data-skbtn marker after a key is detached during rerender', () => {
    const key = document.createElement('button');
    key.setAttribute('data-skbtn', '{shift}');
    document.body.append(key);
    key.remove();
    expect(key.isConnected).toBe(false);
    expect(isVirtualKeyboardTarget(key)).toBe(true);
  });

  test.each(['hg-button', 'simple-keyboard', 'hg-theme-default'])
    ('recognizes a detached library marker class: %s', (className) => {
      const key = document.createElement('div');
      key.className = `ordinary ${className} active`;
      expect(isVirtualKeyboardTarget(key)).toBe(true);
    });

  test('recognizes descendants through the simple-keyboard ancestor fallback', () => {
    const keyboard = document.createElement('div');
    keyboard.className = 'simple-keyboard';
    const label = document.createElement('span');
    keyboard.append(label);
    expect(isVirtualKeyboardTarget(label)).toBe(true);
  });

  test('supports SVG descendants whose className is not a string', () => {
    const keyboard = document.createElement('div');
    keyboard.className = 'simple-keyboard';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    keyboard.append(icon);
    expect(isVirtualKeyboardTarget(icon)).toBe(true);
    icon.remove();
    expect(isVirtualKeyboardTarget(icon)).toBe(false);
  });

  test('rejects unrelated form fields and detached ordinary buttons', () => {
    const input = document.createElement('input');
    const button = document.createElement('button');
    button.className = 'primary-button';
    expect(isVirtualKeyboardTarget(input)).toBe(false);
    expect(isVirtualKeyboardTarget(button)).toBe(false);
  });

  test('tolerates Element-like targets without a hasAttribute method', () => {
    const target = { closest: jest.fn().mockReturnValue(null), className: 'hg-button' };
    expect(isVirtualKeyboardTarget(target as unknown as Element)).toBe(true);
    expect(target.closest).toHaveBeenCalledWith('[data-virtual-keyboard]');
  });

  test.failing('KNOWN GAP: unrelated class names containing hg-button are treated as keyboard keys', () => {
    const unrelated = document.createElement('button');
    unrelated.className = 'not-hg-button';
    expect(isVirtualKeyboardTarget(unrelated)).toBe(false);
  });
});
