/** @jest-environment node */
import { detectBrowserTimezone, getTimezone } from '@/lib/hooks/useTimezone';
import { browserTimezone } from './burn4-browser-fakes';

afterEach(() => jest.restoreAllMocks());

test('server reads use synthetic timezone detection without browser globals', () => {
  const detection = browserTimezone('Asia/Tokyo');
  expect(getTimezone()).toBe('Asia/Tokyo');
  expect(detection.resolvedOptions).toHaveBeenCalledTimes(1);
});

test('browser timezone detection returns a synthetic IANA zone', () => {
  browserTimezone('Pacific/Auckland');
  expect(detectBrowserTimezone()).toBe('Pacific/Auckland');
});

test('missing Intl timezone information falls back to UTC', () => {
  browserTimezone('');
  expect(detectBrowserTimezone()).toBe('UTC');
});

test('Intl lookup failures fall back to UTC', () => {
  const { formatter } = browserTimezone();
  formatter.mockImplementation(() => { throw new Error('Synthetic Intl unavailable'); });
  expect(detectBrowserTimezone()).toBe('UTC');
});
