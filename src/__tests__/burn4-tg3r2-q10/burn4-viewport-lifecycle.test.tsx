/** @jest-environment jsdom */

import { StrictMode, memo, useLayoutEffect } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useViewportSize, type ViewportSize } from '@/lib/hooks/useViewportSize';
import {
  ViewportProbe,
  trackViewportListeners,
  viewportFixture,
} from './burn4-viewport-fixture';

let viewport: ReturnType<typeof viewportFixture>;

beforeEach(() => {
  viewport = viewportFixture();
});

afterEach(() => {
  cleanup();
  viewport.restore();
  jest.restoreAllMocks();
});

describe('viewport cold boot and subscriber lifecycle', () => {
  test('remeasures a viewport changed after render and before the passive effect without any event', () => {
    const snapshots: ViewportSize[] = [];
    const dispatch = jest.spyOn(window, 'dispatchEvent');
    function ColdBootConsumer() {
      const size = useViewportSize();
      snapshots.push(size);
      useLayoutEffect(() => {
        viewport.setSize(1920, 1080);
      }, []);
      return <output data-testid="cold-boot">{size.width}x{size.height}</output>;
    }

    render(<ColdBootConsumer />);

    expect(snapshots[0]).toEqual({ width: 1024, height: 768 });
    expect(screen.getByTestId('cold-boot').textContent).toBe('1920x1080');
    expect(snapshots.at(-1)).toEqual({ width: 1920, height: 1080 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  test('StrictMode pairs each setup with its own cleanup and keeps one active listener per event', () => {
    const listeners = trackViewportListeners();
    const view = render(<StrictMode><ViewportProbe name="strict" /></StrictMode>);

    expect(listeners.added.map(({ type }) => type)).toEqual([
      'resize', 'orientationchange', 'resize', 'orientationchange',
    ]);
    expect(listeners.removed).toEqual(listeners.added.slice(0, 2));
    expect(listeners.added[0]!.listener).toBe(listeners.added[1]!.listener);
    expect(listeners.added[2]!.listener).toBe(listeners.added[3]!.listener);
    expect(listeners.added[0]!.listener).not.toBe(listeners.added[2]!.listener);
    expect(listeners.active.resize.size).toBe(1);
    expect(listeners.active.orientationchange.size).toBe(1);

    act(() => {
      viewport.setSize(1200, 900);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('strict').textContent).toBe('1200x900');
    view.unmount();
    expect(listeners.removed).toEqual(listeners.added);
    expect(listeners.active.resize.size).toBe(0);
    expect(listeners.active.orientationchange.size).toBe(0);
  });

  test('unmounting one subscriber removes only its callbacks while the survivor keeps updating', () => {
    const listeners = trackViewportListeners();
    const firstValues = jest.fn<void, [ViewportSize]>();
    const secondValues = jest.fn<void, [ViewportSize]>();
    function Subscribers({ showFirst }: { showFirst: boolean }) {
      return <>
        {showFirst && <ViewportProbe key="first" name="first" onRender={firstValues} />}
        <ViewportProbe key="second" name="second" onRender={secondValues} />
      </>;
    }
    const view = render(<Subscribers showFirst />);
    expect(listeners.active.resize.size).toBe(2);
    expect(listeners.active.orientationchange.size).toBe(2);
    expect(firstValues.mock.calls[0]![0]).not.toBe(secondValues.mock.calls[0]![0]);
    const firstCallbacks = listeners.added.slice(0, 2);
    const survivorCallbacks = listeners.added.slice(2);

    view.rerender(<Subscribers showFirst={false} />);
    expect(listeners.removed).toEqual(firstCallbacks);
    expect(listeners.added).toHaveLength(4);
    expect([...listeners.active.resize]).toEqual([survivorCallbacks[0]!.listener]);
    expect([...listeners.active.orientationchange]).toEqual([survivorCallbacks[1]!.listener]);
    firstValues.mockClear();
    secondValues.mockClear();
    act(() => {
      viewport.setSize(1400, 900);
      window.dispatchEvent(new Event('orientationchange'));
    });

    expect(screen.queryByTestId('first')).toBeNull();
    expect(firstValues).not.toHaveBeenCalled();
    expect(screen.getByTestId('second').textContent).toBe('1400x900');
    expect(secondValues).toHaveBeenLastCalledWith({ width: 1400, height: 900 });
    view.unmount();
    expect(listeners.removed).toEqual([...firstCallbacks, ...survivorCallbacks]);
    expect(listeners.active.resize.size).toBe(0);
    expect(listeners.active.orientationchange.size).toBe(0);
  });

  test('a remount measures the current viewport without reviving the earlier subscriber', () => {
    const listeners = trackViewportListeners();
    const firstValues = jest.fn<void, [ViewportSize]>();
    const first = render(<ViewportProbe name="old" onRender={firstValues} />);
    const oldCallbacks = listeners.added.slice();
    first.unmount();
    firstValues.mockClear();
    viewport.setSize(1600, 1000);

    const second = render(<ViewportProbe name="new" />);
    expect(screen.getByTestId('new').textContent).toBe('1600x1000');
    expect(listeners.removed).toEqual(oldCallbacks);
    expect(listeners.active.resize.size).toBe(1);
    expect(listeners.added[2]!.listener).not.toBe(oldCallbacks[0]!.listener);
    act(() => {
      viewport.setSize(1500, 950);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('new').textContent).toBe('1500x950');
    expect(firstValues).not.toHaveBeenCalled();
    second.unmount();
    expect(listeners.removed).toEqual(listeners.added);
  });

  test.each([
    ['width', 1280, 768, 'resize'],
    ['height', 1024, 1000, 'orientationchange'],
  ] as const)('a %s-only change reaches the consumer with a new snapshot', (_dimension, width, height, event) => {
    const values = jest.fn<void, [ViewportSize]>();
    render(<ViewportProbe name="single-axis" onRender={values} />);
    const initial = values.mock.calls[0]![0];
    values.mockClear();

    act(() => {
      viewport.setSize(width, height);
      window.dispatchEvent(new Event(event));
    });

    expect(screen.getByTestId('single-axis').textContent).toBe(`${width}x${height}`);
    expect(values).toHaveBeenLastCalledWith({ width, height });
    expect(values.mock.calls.at(-1)![0]).not.toBe(initial);
  });

  test('unchanged mixed events preserve the public snapshot and avoid memoized child rerenders', () => {
    const childRenders = jest.fn<void, [ViewportSize]>();
    const MemoChild = memo(function MemoChild({ size }: { size: ViewportSize }) {
      childRenders(size);
      return <output data-testid="memo-child">{size.width}x{size.height}</output>;
    });
    function Parent({ marker }: { marker: string }) {
      const size = useViewportSize();
      return <section data-marker={marker}><MemoChild size={size} /></section>;
    }
    const view = render(<Parent marker="first" />);
    const initial = childRenders.mock.calls[0]![0];
    expect(childRenders).toHaveBeenCalledTimes(1);
    childRenders.mockClear();

    act(() => {
      for (const type of ['resize', 'orientationchange', 'resize', 'orientationchange']) {
        window.dispatchEvent(new Event(type));
      }
    });
    view.rerender(<Parent marker="second" />);
    expect(childRenders).not.toHaveBeenCalled();
    expect(screen.getByTestId('memo-child').textContent).toBe('1024x768');
    act(() => {
      viewport.setSize(1200, 800);
      window.dispatchEvent(new Event('resize'));
    });
    expect(childRenders).toHaveBeenCalledTimes(1);
    expect(childRenders.mock.calls[0]![0]).not.toBe(initial);
    expect(screen.getByTestId('memo-child').textContent).toBe('1200x800');
  });

  test('a rapid batch of mixed events commits the final viewport rather than an earlier measurement', () => {
    const commits = jest.fn<void, [ViewportSize]>();
    function BatchedConsumer() {
      const size = useViewportSize();
      useLayoutEffect(() => { commits(size); }, [size]);
      return <output data-testid="batch">{size.width}x{size.height}</output>;
    }
    render(<BatchedConsumer />);
    commits.mockClear();
    act(() => {
      viewport.setSize(1100, 700);
      window.dispatchEvent(new Event('resize'));
      viewport.setSize(700, 1100);
      window.dispatchEvent(new Event('orientationchange'));
      viewport.setSize(1800, 1050);
      window.dispatchEvent(new Event('resize'));
    });

    expect(screen.getByTestId('batch').textContent).toBe('1800x1050');
    expect(commits).toHaveBeenCalled();
    for (const [size] of commits.mock.calls) {
      expect(size).toEqual({ width: 1800, height: 1050 });
    }
  });

  test('after final unmount neither native event reaches an earlier subscriber callback', () => {
    const listeners = trackViewportListeners();
    const view = render(<ViewportProbe name="detached" />);
    act(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('orientationchange'));
    });
    expect(listeners.delivered).toEqual(listeners.added);
    listeners.delivered.length = 0;
    view.unmount();

    act(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('orientationchange'));
    });

    expect(listeners.delivered).toEqual([]);
    expect(screen.queryByTestId('detached')).toBeNull();
  });
});
