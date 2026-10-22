/** @jest-environment jsdom */

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Emoji } from '@/components/ui/Emoji';

jest.mock('@/lib/utils', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

describe('Emoji image filenames and accessibility', () => {
  test.each([
    ['🐼', '1f43c'],
    ['❤️', '2764'],
    ['👩‍💻', '1f469-200d-1f4bb'],
    ['🏳️‍🌈', '1f3f3-fe0f-200d-1f308'],
    ['👩🏽‍🚀', '1f469-1f3fd-200d-1f680'],
    ['🇺🇸', '1f1fa-1f1f8'],
    ['1️⃣', '31-20e3'],
    ['👨‍👩‍👧‍👦', '1f468-200d-1f469-200d-1f467-200d-1f466'],
  ])('uses the self-hosted sequence filename for %s', (emoji, codepoint) => {
    render(<Emoji e={emoji} />);
    const image = screen.getByRole('img', { name: emoji }) as HTMLImageElement;
    expect(image.tagName).toBe('IMG');
    expect(image.getAttribute('src')).toBe(`/twemoji/${codepoint}.svg`);
    expect(image.draggable).toBe(false);
  });

  test('uses an explicit accessible label and forwards the custom class', () => {
    render(<Emoji e="🚀" label="Launch" className="fixture-icon" />);
    const image = screen.getByRole('img', { name: 'Launch' });
    expect(image.getAttribute('alt')).toBe('Launch');
    expect(image.classList.contains('fixture-icon')).toBe(true);
  });

  test('renders an accessible text fallback when the emoji is empty', () => {
    render(<Emoji e="" label="No icon" className="fixture-empty" />);
    const fallback = screen.getByRole('img', { name: 'No icon' });
    expect(fallback.tagName).toBe('SPAN');
    expect(fallback.textContent).toBe('');
    expect(fallback.className).toBe('fixture-empty');
  });

  test.each([undefined, 'Launch'])('retains the emoji, accessible label and custom class after an image error with label %s', (label) => {
    render(<Emoji e="🚀" label={label} className="fixture-fallback" />);
    const name = label ?? '🚀';
    fireEvent.error(screen.getByRole('img', { name }));
    const fallback = screen.getByRole('img', { name });
    expect(fallback.tagName).toBe('SPAN');
    expect(fallback.textContent).toBe('🚀');
    expect(fallback.className).toBe('fixture-fallback');
    expect(document.querySelector('img')).toBeNull();
  });

  test('updates a healthy image and its label when the emoji prop changes', () => {
    const { rerender } = render(<Emoji e="🐼" label="Panda" />);
    rerender(<Emoji e="🚀" label="Launch" />);
    expect(screen.queryByRole('img', { name: 'Panda' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Launch' }).getAttribute('src')).toBe('/twemoji/1f680.svg');
  });

  test.failing('KNOWN GAP: a failed emoji image permanently disables image rendering after the emoji prop changes', () => {
    const { rerender } = render(<Emoji e="🐼" label="Panda" />);
    fireEvent.error(screen.getByRole('img', { name: 'Panda' }));
    expect(screen.getByRole('img', { name: 'Panda' }).tagName).toBe('SPAN');
    rerender(<Emoji e="🚀" label="Launch" />);
    const recovered = screen.getByRole('img', { name: 'Launch' });
    expect(recovered.tagName).toBe('IMG');
    expect(recovered.getAttribute('src')).toBe('/twemoji/1f680.svg');
  });
});
