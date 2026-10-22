/** @jest-environment jsdom */

import type { ButtonHTMLAttributes } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useModeToggle, type UseModeToggleResult } from '@/lib/hooks/useModeToggle';
import { useAwayMode } from '@/lib/hooks/useAwayMode';
import { useBabysitterMode } from '@/lib/hooks/useBabysitterMode';
import { AwayModeToggle } from '@/components/away-mode/AwayModeToggle';
import { BabysitterModeToggle } from '@/components/babysitter-mode/BabysitterModeToggle';
import { deferred } from './burn4-harness';

type Role = 'parent' | 'child' | 'guest';
type FakeModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onAuthenticated: (user: { role: Role }) => Promise<void>;
};
type FakeButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string };
let mockAuthenticationCompletion: Promise<void>;

jest.mock('@/lib/hooks/useModeToggle', () => ({ useModeToggle: jest.fn() }));
jest.mock('@/components/ui/button', () => ({
  Button: ({ variant, size, ...props }: FakeButtonProps) => (
    <button data-variant={variant} data-size={size} {...props} />
  ),
}));
jest.mock('@/types/user', () => ({
  PERMISSIONS: {
    parent: { canToggleAwayMode: true },
    child: { canToggleAwayMode: false },
    guest: { canToggleAwayMode: false },
  },
}));
jest.mock('@/components/auth/QuickPinModal', () => ({
  QuickPinModal: (props: FakeModalProps) => {
    if (!props.open) return null;
    return (
      <section role="dialog" aria-label={props.title}>
        <p>{props.description}</p>
        {(['parent', 'child', 'guest'] as const).map((role) => (
          <button key={role} onClick={() => {
            mockAuthenticationCompletion = props.onAuthenticated({ role });
            void mockAuthenticationCompletion.catch(() => undefined);
            props.onOpenChange(false);
          }}>Authenticate {role}</button>
        ))}
        <button onClick={() => props.onOpenChange(false)}>Cancel</button>
      </section>
    );
  },
}));

const modeMock = jest.mocked(useModeToggle);
let awayState: UseModeToggleResult;
let babysitterState: UseModeToggleResult;
const originalFetch = globalThis.fetch;
let unexpectedFetch: jest.Mock;

function modeState(overrides: Partial<UseModeToggleResult> = {}): UseModeToggleResult {
  return {
    isActive: false, enabledAt: null, enabledBy: null, loading: false, error: null,
    toggle: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  awayState = modeState();
  babysitterState = modeState();
  modeMock.mockReset();
  modeMock.mockImplementation(({ endpoint }) => endpoint === '/api/away-mode' ? awayState : babysitterState);
  mockAuthenticationCompletion = Promise.resolve();
  unexpectedFetch = jest.fn().mockRejectedValue(new Error('unexpected offline request'));
  globalThis.fetch = unexpectedFetch;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  globalThis.fetch = originalFetch;
  expect(unexpectedFetch).not.toHaveBeenCalled();
});

describe('eligible wrappers over the excluded mode dependency', () => {
  test('away mode renames activity while preserving metadata, errors, and callable actions', async () => {
    const enabledAt = new Date('2026-10-21T12:00:00Z');
    awayState = modeState({ isActive: true, enabledAt, enabledBy: 'synthetic-parent', error: 'offline refresh' });
    const { result } = renderHook(() => useAwayMode());
    expect(modeMock).toHaveBeenLastCalledWith({
      endpoint: '/api/away-mode', eventName: 'prism:away-mode-change', label: 'away mode', refreshInterval: 60_000,
    });
    expect(result.current).toMatchObject({
      isAway: true, enabledAt, enabledBy: 'synthetic-parent', error: 'offline refresh', loading: false,
    });
    expect(result.current).not.toHaveProperty('isActive');
    await result.current.toggle(false);
    await result.current.refresh();
    expect(awayState.toggle).toHaveBeenCalledWith(false);
    expect(awayState.refresh).toHaveBeenCalledTimes(1);
  });

  test('babysitter mode preserves the full result and forwards action failures', async () => {
    const failure = new Error('synthetic mode rejection');
    babysitterState = modeState({ toggle: jest.fn().mockRejectedValue(failure) });
    const { result } = renderHook(() => useBabysitterMode());
    expect(result.current).toBe(babysitterState);
    expect(modeMock).toHaveBeenLastCalledWith({
      endpoint: '/api/babysitter-mode', eventName: 'prism:babysitter-mode-change', label: 'babysitter mode', refreshInterval: 60_000,
    });
    await expect(result.current.toggle(true)).rejects.toBe(failure);
  });

  test('forwards polling overrides on rerender and reflects newly supplied mode state', () => {
    const away = renderHook(({ interval }) => useAwayMode(interval), { initialProps: { interval: 5_000 } });
    const babysitter = renderHook(({ interval }) => useBabysitterMode(interval), { initialProps: { interval: 0 } });
    expect(modeMock.mock.calls.map(([options]) => [options.endpoint, options.refreshInterval])).toEqual([
      ['/api/away-mode', 5_000], ['/api/babysitter-mode', 0],
    ]);
    awayState = modeState({ isActive: true, loading: true });
    babysitterState = modeState({ isActive: true });
    away.rerender({ interval: 0 });
    babysitter.rerender({ interval: 12_000 });
    expect(away.result.current).toMatchObject({ isAway: true, loading: true });
    expect(babysitter.result.current.isActive).toBe(true);
    expect(modeMock.mock.calls.slice(-2).map(([options]) => options.refreshInterval)).toEqual([0, 12_000]);
  });
});

describe.each([
  { name: 'Away Mode', Component: AwayModeToggle, changeEvent: 'prism:away-mode-change', state: () => awayState },
  { name: 'Babysitter Mode', Component: BabysitterModeToggle, changeEvent: 'prism:babysitter-mode-change', state: () => babysitterState },
])('$name control', ({ name, Component, changeEvent, state }) => {
  test('opens an accessible confirmation, supports cancel, and can reopen without writing', () => {
    render(<Component />);
    const button = screen.getByRole('button', { name: `Enable ${name}` });
    expect(button.getAttribute('title')).toBe(`Enable ${name}`);
    expect(button.textContent).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: `Enable ${name}` })).toBeTruthy();
    expect(screen.getByText(`Select a parent to enable ${name.toLowerCase()}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(state().toggle).not.toHaveBeenCalled();
  });

  test('provides an optional label and forwards caller button presentation', () => {
    render(<Component showLabel variant="outline" size="lg" className="synthetic-control" />);
    const button = screen.getByRole('button', { name: `Enable ${name}` });
    expect(button.textContent).toBe(name);
    expect(button.getAttribute('data-variant')).toBe('outline');
    expect(button.getAttribute('data-size')).toBe('lg');
    expect(button.className).toBe('synthetic-control');
  });

  test('hides controls while loading or already enabled and returns when inactive', () => {
    state().loading = true;
    const { rerender } = render(<Component />);
    expect(screen.queryByRole('button')).toBeNull();
    state().loading = false;
    state().isActive = true;
    rerender(<Component />);
    expect(screen.queryByRole('button')).toBeNull();
    state().isActive = false;
    rerender(<Component />);
    expect(screen.getByRole('button', { name: `Enable ${name}` })).toBeTruthy();
  });

  test.failing('KNOWN GAP: a stale confirmation reopens after another consumer enables and exits the mode', () => {
    const { rerender } = render(<Component />);
    fireEvent.click(screen.getByRole('button', { name: `Enable ${name}` }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    state().isActive = true;
    rerender(<Component />);
    expect(screen.queryByRole('dialog')).toBeNull();
    state().isActive = false;
    rerender(<Component />);
    expect(screen.getByRole('button', { name: `Enable ${name}` })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test.each(['child', 'guest'] as const)('rejects an authenticated %s without a mode write or event', async (role) => {
    const listener = jest.fn();
    window.addEventListener(changeEvent, listener);
    try {
      render(<Component />);
      fireEvent.click(screen.getByRole('button', { name: `Enable ${name}` }));
      fireEvent.click(screen.getByRole('button', { name: `Authenticate ${role}` }));
      await act(async () => { await mockAuthenticationCompletion; });
      expect(state().toggle).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(changeEvent, listener);
    }
  });

  test('waits for a confirmed parent write before notifying other mounted consumers', async () => {
    const write = deferred<void>();
    jest.mocked(state().toggle).mockReturnValueOnce(write.promise);
    const listener = jest.fn();
    const otherEvent = changeEvent === 'prism:away-mode-change' ? 'prism:babysitter-mode-change' : 'prism:away-mode-change';
    const unrelated = jest.fn();
    window.addEventListener(changeEvent, listener);
    window.addEventListener(otherEvent, unrelated);
    try {
      render(<Component />);
      fireEvent.click(screen.getByRole('button', { name: `Enable ${name}` }));
      fireEvent.click(screen.getByRole('button', { name: 'Authenticate parent' }));
      expect(state().toggle).toHaveBeenCalledTimes(1);
      expect(state().toggle).toHaveBeenCalledWith(true);
      expect(listener).not.toHaveBeenCalled();
      await act(async () => { write.resolve(undefined); await mockAuthenticationCompletion; });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBeInstanceOf(Event);
      expect(unrelated).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(changeEvent, listener);
      window.removeEventListener(otherEvent, unrelated);
    }
  });

  test('propagates a rejected mode write without announcing successful activation', async () => {
    const failure = new Error('synthetic write rejected');
    jest.mocked(state().toggle).mockRejectedValueOnce(failure);
    const listener = jest.fn();
    window.addEventListener(changeEvent, listener);
    try {
      render(<Component />);
      fireEvent.click(screen.getByRole('button', { name: `Enable ${name}` }));
      fireEvent.click(screen.getByRole('button', { name: 'Authenticate parent' }));
      await act(async () => { await expect(mockAuthenticationCompletion).rejects.toBe(failure); });
      expect(listener).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: `Enable ${name}` })).toBeTruthy();
    } finally {
      window.removeEventListener(changeEvent, listener);
    }
  });
});
