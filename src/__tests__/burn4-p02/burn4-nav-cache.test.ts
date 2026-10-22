import { navCacheGet, navCacheInvalidate, navCacheSet } from '@/lib/utils/navCache';

describe('navigation cache lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-08T12:00:00Z'));
    navCacheInvalidate(/.*/);
  });

  afterEach(() => {
    navCacheInvalidate(/.*/);
    jest.useRealTimers();
  });

  test('returns undefined for an unseen key without affecting another entry', () => {
    navCacheSet('/api/events', ['synthetic-event']);
    expect(navCacheGet('/api/missing')).toBeUndefined();
    expect(navCacheGet('/api/events')).toEqual(['synthetic-event']);
  });

  test('round trips falsy values without treating them as missing', () => {
    const values = [false, 0, '', null];
    values.forEach((value, index) => navCacheSet(`/value/${index}`, value));
    values.forEach((value, index) => expect(navCacheGet(`/value/${index}`)).toBe(value));
  });

  test('retains object identity and distinguishes full URL query strings', () => {
    const first = { events: ['one'] };
    const second = { events: ['two'] };
    navCacheSet('/api/events?calendar=one', first);
    navCacheSet('/api/events?calendar=two', second);
    expect(navCacheGet('/api/events?calendar=one')).toBe(first);
    expect(navCacheGet('/api/events?calendar=two')).toBe(second);
  });

  test('keeps data through exactly 60 seconds and expires it one millisecond later', () => {
    navCacheSet('/api/events', ['event']);
    jest.advanceTimersByTime(60_000);
    expect(navCacheGet('/api/events')).toEqual(['event']);
    jest.advanceTimersByTime(1);
    expect(navCacheGet('/api/events')).toBeUndefined();
  });

  test('reads do not extend the original TTL', () => {
    navCacheSet('/api/events', ['event']);
    jest.advanceTimersByTime(59_000);
    expect(navCacheGet('/api/events')).toEqual(['event']);
    jest.advanceTimersByTime(1_001);
    expect(navCacheGet('/api/events')).toBeUndefined();
  });

  test('deletes expired entries so a backward clock change cannot resurrect them', () => {
    const initialTime = Date.now();
    navCacheSet('/api/events', ['expired']);
    jest.advanceTimersByTime(60_001);
    expect(navCacheGet('/api/events')).toBeUndefined();
    jest.setSystemTime(initialTime);
    expect(navCacheGet('/api/events')).toBeUndefined();
  });

  test('replacing a value starts a fresh TTL independently of other entries', () => {
    navCacheSet('/api/events', 'old');
    navCacheSet('/api/tasks', 'unrelated');
    jest.advanceTimersByTime(30_000);
    navCacheSet('/api/events', 'new');
    jest.advanceTimersByTime(30_001);
    expect(navCacheGet('/api/tasks')).toBeUndefined();
    expect(navCacheGet('/api/events')).toBe('new');
    jest.advanceTimersByTime(30_000);
    expect(navCacheGet('/api/events')).toBeUndefined();
  });

  test('invalidates every matching key while retaining unrelated entries', () => {
    navCacheSet('/api/events?calendar=one', 'first');
    navCacheSet('/api/events?calendar=two', 'second');
    navCacheSet('/api/tasks', 'keep');
    navCacheInvalidate(/^\/api\/events(?:\?|$)/);
    expect(navCacheGet('/api/events?calendar=one')).toBeUndefined();
    expect(navCacheGet('/api/events?calendar=two')).toBeUndefined();
    expect(navCacheGet('/api/tasks')).toBe('keep');
  });

  test('accepts an empty store and a regex matching nothing', () => {
    expect(() => navCacheInvalidate(/missing/)).not.toThrow();
    navCacheSet('/api/tasks', 'keep');
    navCacheInvalidate(/missing/);
    expect(navCacheGet('/api/tasks')).toBe('keep');
  });

  test.failing('KNOWN GAP: global invalidation regex skips matching cache entries', () => {
    const keys = ['/api/events?one', '/api/events?two', '/api/events?three'];
    keys.forEach((key) => navCacheSet(key, 'stale'));
    navCacheInvalidate(/^\/api\/events/g);
    expect(keys.map((key) => navCacheGet(key))).toEqual([undefined, undefined, undefined]);
  });
});
