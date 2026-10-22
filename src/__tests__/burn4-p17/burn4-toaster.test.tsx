/** @jest-environment jsdom */

import * as React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/components/ui/use-toast';

type FixtureToast = ReturnType<typeof useToast>['toasts'][number] & { 'data-testid'?: string };
type BoundaryProps = Omit<FixtureToast, 'id'> & { children?: React.ReactNode };
const mockRoots = jest.fn<void, [BoundaryProps]>();

jest.mock('@/components/ui/use-toast', () => ({ useToast: jest.fn() }));
jest.mock('@/components/ui/toast', () => ({
  ToastProvider: ({ children }: React.PropsWithChildren) => <div data-testid="toast-provider">{children}</div>,
  Toast: (props: BoundaryProps) => {
    mockRoots(props);
    return <article data-testid={props['data-testid']}>{props.children}</article>;
  },
  ToastTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
  ToastDescription: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
  ToastClose: () => <button type="button" aria-label="Dismiss notification" />,
  ToastViewport: () => <div data-testid="toast-viewport" />,
}));

const mockUseToast = jest.mocked(useToast);
const fixtureToast = jest.fn();
const fixtureDismiss = jest.fn();

function setToasts(toasts: FixtureToast[]) {
  mockUseToast.mockReturnValue({ toasts, toast: fixtureToast, dismiss: fixtureDismiss });
}

beforeEach(() => {
  mockRoots.mockReset();
  mockUseToast.mockReset();
  fixtureToast.mockReset();
  fixtureDismiss.mockReset();
  setToasts([]);
});

describe('Toaster presentation and dependency contracts', () => {
  test('keeps a provider and viewport available with an empty toast list', () => {
    render(<Toaster />);
    const provider = screen.getByTestId('toast-provider');
    expect(within(provider).getByTestId('toast-viewport')).toBeTruthy();
    expect(provider.querySelector('article')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss notification' })).toBeNull();
    expect(mockRoots).not.toHaveBeenCalled();
  });

  test('renders title text and rich description content, an actionable control and a close control', () => {
    const undo = jest.fn();
    setToasts([{
      id: 'saved', 'data-testid': 'saved-toast', open: true,
      title: 'Saved recipe',
      description: <span>Vegetable soup is ready.</span>,
      action: <button type="button" onClick={undo}>Undo</button>,
    }]);
    render(<Toaster />);
    const root = screen.getByTestId('saved-toast');
    expect(within(root).getByRole('heading', { name: 'Saved recipe' }).tagName).toBe('H2');
    expect(within(root).getByText('Vegetable soup is ready.')).toBeTruthy();
    fireEvent.click(within(root).getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(within(root).getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(1);
  });

  test('omits missing title and description wrappers while preserving one close control per toast', () => {
    setToasts([
      { id: 'body', 'data-testid': 'body-toast', description: 'Body only' },
      { id: 'title', 'data-testid': 'title-toast', title: 'Title only' },
      { id: 'empty', 'data-testid': 'empty-toast' },
    ]);
    render(<Toaster />);
    expect(within(screen.getByTestId('body-toast')).queryByRole('heading')).toBeNull();
    expect(within(screen.getByTestId('body-toast')).getByText('Body only')).toBeTruthy();
    expect(screen.getByTestId('title-toast').querySelector('p')).toBeNull();
    expect(screen.getByTestId('empty-toast').querySelector('h2, p')).toBeNull();
    for (const id of ['body-toast', 'title-toast', 'empty-toast']) {
      expect(within(screen.getByTestId(id)).getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(1);
    }
  });

  test('forwards open state, duration, variant and lifecycle handlers to the toast boundary without leaking content fields', () => {
    const onOpenChange = jest.fn();
    const onEscapeKeyDown = jest.fn();
    setToasts([{
      id: 'failure', open: false, duration: 4500, variant: 'destructive',
      onOpenChange, onEscapeKeyDown, title: 'Save failed', description: 'Try again',
      action: <button type="button">Retry</button>,
    }]);
    render(<Toaster />);
    const props = mockRoots.mock.calls[0]![0];
    expect(props).toMatchObject({ open: false, duration: 4500, variant: 'destructive', onOpenChange, onEscapeKeyDown });
    expect(props).not.toHaveProperty('id');
    expect(props).not.toHaveProperty('title');
    expect(props).not.toHaveProperty('description');
    expect(props).not.toHaveProperty('action');
    act(() => props.onOpenChange?.(false));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('uses toast ids to preserve mounted content while records reorder and update', () => {
    setToasts([
      { id: 'first', 'data-testid': 'first-toast', title: 'First' },
      { id: 'second', 'data-testid': 'second-toast', title: 'Second' },
    ]);
    const { rerender } = render(<Toaster />);
    const first = screen.getByTestId('first-toast');
    const second = screen.getByTestId('second-toast');
    setToasts([
      { id: 'second', 'data-testid': 'second-toast', title: 'Second updated' },
      { id: 'first', 'data-testid': 'first-toast', title: 'First updated' },
    ]);
    rerender(<Toaster />);
    expect(screen.getByTestId('first-toast')).toBe(first);
    expect(screen.getByTestId('second-toast')).toBe(second);
    expect(Array.from(screen.getByTestId('toast-provider').querySelectorAll('article'))).toEqual([second, first]);
    expect(within(first).getByRole('heading', { name: 'First updated' })).toBeTruthy();
    setToasts([]);
    rerender(<Toaster />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByTestId('toast-viewport')).toBeTruthy();
  });
});
