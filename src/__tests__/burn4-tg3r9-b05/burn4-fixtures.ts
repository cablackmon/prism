import { type FontScaleView, createFontScaleSession } from '../../lib/burn4-font-scale';

export function sessionFixture(inline = '', priority = '') {
  const target = document.createElement('div');
  if (inline) target.style.setProperty('font-size', inline, priority);
  let base = '16px';
  let listener: (() => void) | undefined;
  const stop = jest.fn();
  const read = jest.fn(() => target.style.getPropertyValue('font-size') || base);
  const subscribe = jest.fn((next: () => void) => { listener = next; return stop; });
  const session = createFontScaleSession({ target, readComputedFontSize: read, subscribeBaselineChanges: subscribe });
  return {
    target, session, read, subscribe, stop,
    setBase(value: string) { base = value; },
    emit() { listener?.(); },
    savedListener() { return listener; },
  };
}

export function viewFixture(target: HTMLElement, legacy = false) {
  const resize = new Set<() => void>();
  const media = new Map<string, Set<() => void>>();
  let base = '16px';
  const read = jest.fn(() => ({ fontSize: target.style.fontSize || base } as CSSStyleDeclaration));
  const view = {
    getComputedStyle: read,
    addEventListener: jest.fn((_name: string, listener: () => void) => { resize.add(listener); }),
    removeEventListener: jest.fn((_name: string, listener: () => void) => { resize.delete(listener); }),
    matchMedia: jest.fn((query: string) => {
      const listeners = new Set<() => void>();
      media.set(query, listeners);
      const add = jest.fn((listener: () => void) => { listeners.add(listener); });
      const remove = jest.fn((listener: () => void) => { listeners.delete(listener); });
      return legacy ? { addListener: add, removeListener: remove } : {
        addEventListener: jest.fn((_event: string, listener: () => void) => { add(listener); }),
        removeEventListener: jest.fn((_event: string, listener: () => void) => { remove(listener); }),
      };
    }),
  } as unknown as FontScaleView;
  return {
    view, read, resize, media,
    setBase(value: string) { base = value; },
    emitResize() { for (const listener of [...resize]) listener(); },
    emitPointer(query = '(pointer: fine)') { for (const listener of [...(media.get(query) ?? [])]) listener(); },
    activeCount() { return resize.size + [...media.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}
