import { useViewportSize, type ViewportSize } from '@/lib/hooks/useViewportSize';

type TrackedEvent = 'resize' | 'orientationchange';
type ListenerCall = { type: TrackedEvent; listener: EventListenerOrEventListenerObject };

export function viewportFixture(width = 1024, height = 768) {
  const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const setSize = (nextWidth: number, nextHeight: number) => {
    Object.defineProperty(window, 'innerWidth', {
      value: nextWidth, configurable: true, writable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: nextHeight, configurable: true, writable: true,
    });
  };
  setSize(width, height);
  return {
    setSize,
    restore: () => {
      if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth);
      else Reflect.deleteProperty(window, 'innerWidth');
      if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight);
      else Reflect.deleteProperty(window, 'innerHeight');
    },
  };
}

export function trackViewportListeners() {
  const active: Record<TrackedEvent, Set<EventListenerOrEventListenerObject>> = {
    resize: new Set(), orientationchange: new Set(),
  };
  const added: ListenerCall[] = [];
  const removed: ListenerCall[] = [];
  const delivered: ListenerCall[] = [];
  const forwarded: Record<TrackedEvent, Map<EventListenerOrEventListenerObject, EventListener>> = {
    resize: new Map(), orientationchange: new Map(),
  };
  const originalAdd = window.addEventListener.bind(window);
  const originalRemove = window.removeEventListener.bind(window);
  const isTracked = (type: string): type is TrackedEvent =>
    type === 'resize' || type === 'orientationchange';

  jest.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    if (isTracked(type)) {
      active[type].add(listener);
      added.push({ type, listener });
      let wrapper = forwarded[type].get(listener);
      if (!wrapper) {
        const eventType = type;
        wrapper = (event: Event) => {
          delivered.push({ type: eventType, listener });
          if (typeof listener === 'function') listener.call(window, event);
          else listener.handleEvent(event);
        };
        forwarded[type].set(listener, wrapper);
      }
      originalAdd(type, wrapper, options);
    } else {
      originalAdd(type, listener, options);
    }
  });
  jest.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
    if (isTracked(type)) {
      active[type].delete(listener);
      removed.push({ type, listener });
      originalRemove(type, forwarded[type].get(listener) ?? listener, options);
    } else {
      originalRemove(type, listener, options);
    }
  });
  return { active, added, removed, delivered };
}

export function ViewportProbe({
  name,
  onRender,
}: {
  name: string;
  onRender?: (size: ViewportSize) => void;
}) {
  const size = useViewportSize();
  onRender?.(size);
  return <output data-testid={name}>{size.width}x{size.height}</output>;
}
