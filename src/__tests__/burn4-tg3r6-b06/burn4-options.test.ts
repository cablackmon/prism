import { runSlice, type RuntimeResult } from './burn4-runtime';

function healthy(result: RuntimeResult): void {
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.events.some(event => event.startsWith('blocked-'))).toBe(false);
  expect(result.events).toContain('photo-root-published');
  expect(result.events).toContain('completed');
}

describe('HA ordinary option slices with the real jq operator', () => {
  test('configured options create the photo directory and preserve a true bundled option', () => {
    const result = runSlice('options');
    healthy(result);
    expect(result.events).toEqual([
      'mkdir-photos', 'photo-root-published', 'telemetry-not-disabled', 'bundled-selected',
      'log-default', 'stats-enabled', 'completed',
    ]);
  });

  test('missing Supervisor options stops before jq, mkdir or observations', () => {
    const result = runSlice('options', { optionsPresent: false });
    expect(result.status).toBe(1);
    expect(result.events).toEqual(['fatal']);
    expect(result.stderr).toBe('');
  });

  test('a false bundled option produces the external-selection value after jq emits no value', () => {
    const result = runSlice('options', { options: { bundled_db: false, photos_root: '/burn4-photos' } });
    healthy(result);
    expect(result.events).toContain('external-selected');
    expect(result.events).not.toContain('bundled-selected');
  });

  test('a failing bundled option query uses the source true fallback', () => {
    const result = runSlice('options', { jqFailure: 'bundled_db' });
    healthy(result);
    expect(result.events).toContain('bundled-selected');
  });

  test('a failing log query uses the source info fallback', () => {
    const result = runSlice('options', { jqFailure: 'log_level' });
    healthy(result);
    expect(result.events).toContain('log-default');
  });

  test('a configured log level is preserved without displaying its value', () => {
    const result = runSlice('options', { options: { log_level: 'debug', photos_root: '/burn4-photos' } });
    healthy(result);
    expect(result.events).toContain('log-configured');
  });

  test('a missing log option produces no fallback because jq succeeds', () => {
    const result = runSlice('options', { options: { photos_root: '/burn4-photos' } });
    healthy(result);
    expect(result.events).toContain('log-empty');
  });

  test('a failing photo query uses the source photo default', () => {
    const result = runSlice('options', { jqFailure: 'photos_root' });
    healthy(result);
    expect(result.events).toContain('mkdir-default-photos');
  });

  test('photo directory failure prevents publication and completion', () => {
    const result = runSlice('options', { mkdirFailure: true });
    expect(result.status).toBe(19);
    expect(result.events).toEqual(['mkdir-photos']);
    expect(result.stderr).toBe('');
  });

  test('a photo directory containing spaces remains one quoted argument', () => {
    const result = runSlice('options', { options: { photos_root: '/burn4 photos' } });
    healthy(result);
    expect(result.events).toContain('mkdir-photos');
  });

  test('photo text with shell punctuation stays inert', () => {
    const result = runSlice('options', { options: { photos_root: '/burn4-photos; no-command' } });
    healthy(result);
    expect(result.events).toContain('mkdir-photos');
  });

  test('a failing anonymous-stats query uses the true fallback', () => {
    const result = runSlice('options', { jqFailure: 'anonymous_stats' });
    healthy(result);
    expect(result.events).toContain('stats-enabled');
    expect(result.events).toContain('telemetry-not-disabled');
  });

  test('a missing anonymous-stats option leaves telemetry enabled', () => {
    const result = runSlice('options', { options: { photos_root: '/burn4-photos' } });
    healthy(result);
    expect(result.events).toContain('stats-empty');
    expect(result.events).toContain('telemetry-not-disabled');
  });

  test('string false reaches the existing telemetry opt-out branch', () => {
    const result = runSlice('options', { options: { photos_root: '/burn4-photos', anonymous_stats: 'false' } });
    healthy(result);
    expect(result.events).toContain('stats-false');
    expect(result.events).toContain('telemetry-disabled');
  });

  test('boolean false is swallowed by jq and leaves telemetry enabled', () => {
    const result = runSlice('options', { options: { photos_root: '/burn4-photos', anonymous_stats: false } });
    healthy(result);
    expect(result.events).toContain('stats-empty');
    expect(result.events).toContain('telemetry-not-disabled');
  });

  test.failing('KNOWN GAP: boolean anonymous_stats=false fails to disable anonymous telemetry', () => {
    const result = runSlice('options', { options: { photos_root: '/burn4-photos', anonymous_stats: false } });
    healthy(result);
    expect(result.events).toContain('telemetry-disabled');
  });
});
