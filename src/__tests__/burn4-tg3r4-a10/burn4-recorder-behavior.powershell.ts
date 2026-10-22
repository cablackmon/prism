import { join } from 'node:path';
import { RecorderFixture, encoderFilter, type Options } from './burn4-recorder-fixture';

describe('offline demo recorder orchestration', () => {
  const fixtures: RecorderFixture[] = [];
  function fixture(options: Options = {}): RecorderFixture {
    const created = new RecorderFixture(options);
    fixtures.push(created);
    return created;
  }
  afterEach(() => { for (const created of fixtures.splice(0)) created.dispose(); });

  test('missing encoder fails before HTTP, directories, reset and capture', () => {
    const created = fixture({ missingEncoder: true });
    const result = created.run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ERROR: ffmpeg not found.');
    expect(result.events).toEqual([]);
    expect(created.directoriesCreated()).toBe(false);
    expect(created.resetFileExists()).toBe(false);
  });

  test.each([201, 503])('HTTP status %i fails before filesystem output and reset', (healthStatus) => {
    const created = fixture({ healthStatus });
    const result = created.run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ERROR: App not reachable');
    expect(result.events).toEqual(['health']);
    expect(created.directoriesCreated()).toBe(false);
  });

  test('HTTP transport exception is handled without invoking other operational commands', () => {
    const result = fixture({ healthThrows: true }).run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ERROR: App not reachable');
    expect(result.events).toEqual(['health']);
  });

  test('successful recording checks health, resets data, captures and encodes in order', () => {
    const created = fixture();
    const result = created.run();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.events).toEqual(['health', 'database', 'redis', 'record', 'encode']);
    expect(created.directoriesCreated()).toBe(true);
    expect(created.gif('dashboard-overview.gif')?.length).toBe(64);
    expect(result.stdout).toContain('[OK] Data reset');
    expect(result.stdout).toContain('Total: 1 GIFs, 0 MB');
  });

  test('reset passes the intended selective SQL and removes the shared temp artifact', () => {
    const created = fixture();
    const result = created.run();
    expect(result.status).toBe(0);
    expect(created.sql()).toBe("UPDATE tasks SET completed = false, completed_at = NULL, completed_by = NULL\n  WHERE title != 'Return library books' AND completed = true;\nUPDATE shopping_items SET checked = false;\nDELETE FROM chore_completions WHERE completed_at > now() - interval '1 day';\nDELETE FROM settings WHERE key IN ('awayMode', 'babysitterMode');\nDELETE FROM recipes WHERE name LIKE 'Demo:%';\n");
    expect(result.invocations.find((call) => call.stage === 'database')?.args).toEqual(['exec', '-i', 'prism-db', 'psql', '-U', 'prism', '-d', 'prism']);
    expect(result.invocations.find((call) => call.stage === 'redis')?.args).toEqual(['exec', 'prism-redis', 'redis-cli', 'FLUSHDB']);
    expect(created.resetFileExists()).toBe(false);
  });

  test('a thrown optional reset warns, cleans temp and continues recording', () => {
    const created = fixture({ resetThrows: true });
    const result = created.run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('WARNING: Could not reset data: synthetic reset exception');
    expect(result.stdout).not.toContain('[OK] Data reset');
    expect(result.events).toEqual(['health', 'record', 'encode']);
    expect(created.resetFileExists()).toBe(false);
  });

  test('capture uses the project root and the expected relative Playwright config', () => {
    const created = fixture({ inspectLocation: true });
    const result = created.run();
    const capture = result.invocations.find((call) => call.stage === 'record');
    expect(capture?.args).toEqual(['playwright', 'test', '--config', 'e2e/demos/demo.config.ts']);
    expect(capture?.cwd).toBe(created.project);
    expect(created.finalLocation()).toBe(created.working);
    expect(result.invocations.find((call) => call.stage === 'encode')?.cwd).toBe(created.working);
  });

  test('nonzero native capture status warns but processes its partial videos', () => {
    const created = fixture({ recorderStatus: 19 });
    const result = created.run();
    expect(result.stdout).toContain('WARNING: Some scenarios may have failed (exit code 19).');
    expect(result.events).toEqual(['health', 'database', 'redis', 'record', 'encode']);
    expect(created.gif('dashboard-overview.gif')).toBeDefined();
  });

  test('a thrown capture error restores caller location and prevents conversion', () => {
    const created = fixture({ recorderThrows: true, inspectLocation: true });
    const result = created.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('synthetic recorder exception');
    expect(created.finalLocation()).toBe(created.working);
    expect(result.events).toEqual(['health', 'database', 'redis']);
  });

  test('capture without video fails with a useful message and no encoder call', () => {
    const result = fixture({ videos: [] }).run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ERROR: No .webm files found in test-results/.');
    expect(result.events).toEqual(['health', 'database', 'redis', 'record']);
  });

  test.each([
    ['01-dashboard', 'dashboard-overview'],
    ['02-light-dark', 'light-dark-toggle'],
    ['03-chore', 'chore-celebration'],
    ['04-grocery', 'grocery-shopping'],
    ['05-recipe', 'recipe-view'],
    ['06-away', 'away-mode'],
    ['07-babysitter', 'babysitter-mode'],
  ])('maps recursive scenario %s to %s.gif', (scenario, output) => {
    const created = fixture({ videos: [`nested/${scenario}/recording.webm`] });
    const result = created.run();
    expect(result.status).toBe(0);
    expect(created.gif(`${output}.gif`)).toBeDefined();
    expect(result.stdout).toContain(`recording.webm -> ${output}.gif`);
  });

  test('unmatched scenario uses its video basename and handles spaces in paths', () => {
    const created = fixture({ videos: ['deep nested/unmapped/fixture clip.webm'] });
    const result = created.run();
    expect(result.status).toBe(0);
    expect(created.gif('fixture clip.gif')).toBeDefined();
    expect(result.stdout).toContain('fixture clip.webm -> fixture clip.gif');
  });

  test('discovery ignores files that are not webm even under test-results', () => {
    const result = fixture({ videos: ['deep/notes.txt', 'nested/07-babysitter/video.webm'] }).run();
    expect(result.status).toBe(0);
    expect(result.invocations.filter((call) => call.stage === 'encode')).toHaveLength(1);
    expect(result.stdout).not.toContain('notes.txt ->');
  });

  test('encoder receives the trim, filter, loop, input and mapped output options', () => {
    const created = fixture({ videos: ['nested/05-recipe/recipe.webm'] });
    const result = created.run();
    expect(result.invocations.find((call) => call.stage === 'encode')?.args).toEqual([
      '-y', '-ss', '1.5', '-i', join(created.project, 'test-results/nested/05-recipe/recipe.webm'),
      '-vf', encoderFilter, '-loop', '0', join(created.project, 'docs/demos/recipe-view.gif'),
    ]);
  });

  test('missing encoder output is visibly reported as a failed conversion', () => {
    const created = fixture({ encoderCreates: false });
    const result = created.run();
    expect(result.stdout).toContain('FAILED to create dashboard-overview.gif');
    expect(result.stdout).toContain('No GIFs generated.');
    expect(created.gif('dashboard-overview.gif')).toBeUndefined();
  });

  test('summary lists generated and existing GIF files and rounded aggregate size', () => {
    const created = fixture({ staleGifs: { 'prior-demo.gif': 1572864 }, videos: ['01-dashboard/a.webm', '06-away/b.webm'] });
    const result = created.run();
    expect(result.status).toBe(0);
    expect(result.invocations.filter((call) => call.stage === 'encode')).toHaveLength(2);
    expect(result.stdout).toContain('prior-demo.gif - 1.5 MB');
    expect(result.stdout).toContain('dashboard-overview.gif - 0 MB');
    expect(result.stdout).toContain('away-mode.gif - 0 MB');
    expect(result.stdout).toContain('Total: 3 GIFs, 1.5 MB');
    expect(result.stdout).toContain(`Output: ${join(created.project, 'docs/demos')}`);
  });

  test('failed native encoding reports absent output while current process status remains zero', () => {
    const created = fixture({ encoderStatus: 23 });
    const result = created.run();
    expect(result.invocations.find((call) => call.stage === 'encode')?.status).toBe(23);
    expect(created.gif('dashboard-overview.gif')).toBeUndefined();
    expect(result.stdout).toContain('FAILED to create dashboard-overview.gif');
    expect(result.stderr).not.toContain('unexpected');
    expect(result.status).toBe(0);
  });
});
