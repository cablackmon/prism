/** @jest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Badge } from '@/components/ui/badge';
import { KrogerConnectionCard } from '@/app/settings/sections/KrogerConnectionCard';
import { ConnectionStatusBadge } from '@/app/settings/sections/integrations/shared/ConnectionStatusBadge';
import { KrogerProviderCard } from '@/app/settings/sections/integrations/cards/KrogerProviderCard';
import { krogerLifecycle } from './burn4-fixtures';

jest.mock('@/components/ui/badge', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    Badge: jest.fn(({ children, className }: { children: React.ReactNode; className?: string }) =>
      React.createElement('div', { className }, children)),
  };
});

jest.mock('@/app/settings/sections/KrogerConnectionCard', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { krogerLifecycle } = jest.requireActual<typeof import('./burn4-fixtures')>('./burn4-fixtures');
  return {
    KrogerConnectionCard: jest.fn(function OfflineKrogerConnectionCard() {
      const [chosen, setChosen] = React.useState(0);
      React.useEffect(() => {
        krogerLifecycle.mount();
        return () => { krogerLifecycle.unmount(); };
      }, []);
      return React.createElement('button', { type: 'button', onClick: () => setChosen((count) => count + 1) },
        `Choose fixture store ${chosen}`);
    }),
  };
});

beforeEach(() => jest.clearAllMocks());
afterEach(() => cleanup());

test('connection transitions update the visible accessible label and delegate tone and caller classes to Badge', () => {
  const { rerender } = render(
    <button type="button">Google <ConnectionStatusBadge status="disconnected" className="account-status" /></button>,
  );
  expect(screen.getByRole('button', { name: 'Google Not connected' })).toBeTruthy();
  const initial = screen.getByText('Not connected');
  expect(initial.classList.contains('account-status')).toBe(true);
  expect(jest.mocked(Badge).mock.calls.at(-1)?.[0]).toMatchObject({ variant: 'outline', className: 'account-status', children: 'Not connected' });
  rerender(<button type="button">Google <ConnectionStatusBadge status="connected" className="updated-status" /></button>);
  expect(screen.getByRole('button', { name: 'Google Connected' })).toBeTruthy();
  expect(screen.queryByText('Not connected')).toBeNull();
  expect(screen.getByText('Connected').classList.contains('updated-status')).toBe(true);
  expect(screen.getByText('Connected').classList.contains('account-status')).toBe(false);
  expect(jest.mocked(Badge).mock.calls.at(-1)?.[0]).toMatchObject({ variant: 'success', className: 'updated-status', children: 'Connected' });
  rerender(<button type="button">Google <ConnectionStatusBadge status="expired" /></button>);
  expect(screen.getByRole('button', { name: 'Google Reconnect needed' })).toBeTruthy();
  expect(screen.queryByText('Connected')).toBeNull();
  expect(jest.mocked(Badge).mock.calls.at(-1)?.[0]).toMatchObject({ variant: 'warning', children: 'Reconnect needed' });
});

test('setup and alpha states remain readable to accessible name calculation without creating nested controls', () => {
  const { rerender } = render(<button type="button">Provider <ConnectionStatusBadge status="alpha" /></button>);
  expect(screen.getByRole('button', { name: 'Provider Alpha' })).toBeTruthy();
  expect(jest.mocked(Badge).mock.calls.at(-1)?.[0]).toMatchObject({ variant: 'secondary', children: 'Alpha' });
  rerender(<button type="button">Provider <ConnectionStatusBadge status="setup_required" /></button>);
  expect(screen.getByRole('button', { name: 'Provider Setup required' })).toBeTruthy();
  expect(screen.queryByText('Alpha')).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(jest.mocked(Badge).mock.calls.at(-1)?.[0]).toMatchObject({ variant: 'secondary', children: 'Setup required' });
});

test('Kroger provider anchor delegates to its connection card and retains the mounted child across rerenders', () => {
  const { rerender, unmount } = render(<KrogerProviderCard />);
  const anchor = document.getElementById('kroger');
  expect(anchor).not.toBeNull();
  expect(anchor!.classList.contains('scroll-mt-20')).toBe(true);
  const chooseStore = within(anchor!).getByRole('button', { name: 'Choose fixture store 0' });
  expect(KrogerConnectionCard).toHaveBeenCalledTimes(1);
  expect(krogerLifecycle.mount).toHaveBeenCalledTimes(1);
  fireEvent.click(chooseStore);
  rerender(<KrogerProviderCard />);
  expect(document.getElementById('kroger')).toBe(anchor);
  expect(within(anchor!).getByRole('button', { name: 'Choose fixture store 1' })).toBeTruthy();
  expect(krogerLifecycle.mount).toHaveBeenCalledTimes(1);
  expect(krogerLifecycle.unmount).not.toHaveBeenCalled();
  unmount();
  expect(krogerLifecycle.unmount).toHaveBeenCalledTimes(1);
  expect(document.getElementById('kroger')).toBeNull();
});
