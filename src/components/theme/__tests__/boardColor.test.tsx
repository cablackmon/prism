/** @jest-environment jsdom */
import React from 'react';
import { renderHook } from '@testing-library/react';
import { BoardThemeContext } from '../KystTheme';
import { useBoardColor } from '../useBoardColor';

test('NOX maps explicit member identities without mistaking shared colors for identity', () => {
  const { result } = renderHook(useBoardColor, {
    wrapper: ({ children }) => <BoardThemeContext.Provider value="nox">{children}</BoardThemeContext.Provider>,
  });
  expect(result.current('#123456', 'Parker')).toBe('#35c7ff');
  expect(result.current('#123456', 'Sawyer')).toBe('#ff4d9e');
  expect(result.current('#123456', 'Someone else')).toBe('#123456');
  expect(result.current('#123456')).toBe('#123456');
});

test('classic and components outside the board retain stored colors', () => {
  const { result } = renderHook(useBoardColor);
  expect(result.current('#123456', 'Parker')).toBe('#123456');
  expect(result.current('#abcdef', 'Sawyer')).toBe('#abcdef');
});
