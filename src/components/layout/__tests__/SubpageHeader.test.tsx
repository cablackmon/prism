/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { SubpageHeader } from '../SubpageHeader';

let pathname = '/chores';

jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

jest.mock('@/lib/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

describe('SubpageHeader', () => {
  beforeEach(() => {
    pathname = '/chores';
  });

  it('provides a visible, focusable, touch-sized Back to board link', () => {
    render(<SubpageHeader icon={<span aria-hidden>icon</span>} title="Chores" />);

    const backLink = screen.getByRole('link', { name: 'Back to board' });
    expect(backLink.getAttribute('href')).toBe('/');
    expect(backLink.textContent).toContain('Back to board');
    expect(backLink.className).toContain('h-11');
    expect(backLink.className).toContain('[@media(pointer:coarse)]:h-14');
    expect(screen.getByText('Back to board').className).toContain('hidden xl:inline');

    backLink.focus();
    expect(document.activeElement).toBe(backLink);
  });

  it('returns to the originating named dashboard', () => {
    pathname = '/d/hallway-board/tasks';
    render(<SubpageHeader icon={<span aria-hidden>icon</span>} title="Tasks" />);

    expect(screen.getByRole('link', { name: 'Back to board' }).getAttribute('href')).toBe(
      '/d/hallway-board'
    );
  });
});
