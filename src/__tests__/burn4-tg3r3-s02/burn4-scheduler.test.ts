import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cleanFixtures, createFixture } from './burn4-shell-fixture';

afterEach(cleanFixtures);

describe('bounded backup scheduler with relocated config roots', () => {
  test('runs at the default scheduled hour and sleeps one hour to prevent duplicate execution', () => {
    const fixture = createFixture({ hourSequence: ['03'] });
    const result = fixture.runScheduler();
    expect(result.signal).toBe('SIGTERM');
    expect(result.stderr).toBe('');
    expect(fixture.calls().filter(call => ['burn4-backup.sh', 'sleep'].includes(call.command)))
      .toEqual([
        { command: 'burn4-backup.sh', args: [] },
        { command: 'sleep', args: ['3600'] },
      ]);
  });

  test('waits fifteen minutes outside the configured hour', () => {
    const fixture = createFixture({ hourSequence: ['02'] });
    fixture.runScheduler();
    expect(fixture.calls().filter(call => ['burn4-backup.sh', 'sleep'].includes(call.command)))
      .toEqual([{ command: 'sleep', args: ['900'] }]);
  });

  test('honors a configured backup hour with a leading zero from date', () => {
    const fixture = createFixture({ hourSequence: ['09'] });
    const result = fixture.runScheduler({ BACKUP_HOUR: '9' });
    expect(result.stdout).toContain('daily at 9:00');
    expect(fixture.calls().filter(call => call.command === 'burn4-backup.sh')).toHaveLength(1);
    expect(fixture.calls().find(call => call.command === 'sleep')?.args).toEqual(['3600']);
  });

  test('rechecks the clock between waits and runs once when the scheduled hour arrives', () => {
    const fixture = createFixture({ hourSequence: ['02', '03', '04'], sleepLimit: 3 });
    fixture.runScheduler();
    expect(fixture.calls().filter(call => ['burn4-backup.sh', 'sleep'].includes(call.command)))
      .toEqual([
        { command: 'sleep', args: ['900'] },
        { command: 'burn4-backup.sh', args: [] },
        { command: 'sleep', args: ['3600'] },
        { command: 'sleep', args: ['900'] },
      ]);
  });

  test('copies the mounted synthetic config into the writable fixture location before scheduling', () => {
    const fixture = createFixture();
    mkdirSync(dirname(fixture.mountedConfig), { recursive: true });
    writeFileSync(fixture.mountedConfig, 'fixture settings without authentication\n');
    fixture.runScheduler();
    expect(readFileSync(fixture.writableConfig, 'utf8'))
      .toBe('fixture settings without authentication\n');
    expect(readFileSync(fixture.mountedConfig, 'utf8'))
      .toBe('fixture settings without authentication\n');
  });

  test('does not create a writable config when the mounted fixture config is absent', () => {
    const fixture = createFixture();
    fixture.runScheduler();
    expect(existsSync(fixture.writableConfig)).toBe(false);
    expect(fixture.calls().filter(call => call.command === 'burn4-backup.sh')).toHaveLength(1);
  });

  test('a failed backup does not stop subsequent scheduled checks', () => {
    const fixture = createFixture({ backupExit: 17, hourSequence: ['03', '04'], sleepLimit: 2 });
    const result = fixture.runScheduler();
    expect(result.signal).toBe('SIGTERM');
    expect(fixture.calls().filter(call => call.command === 'sleep').map(call => call.args[0]))
      .toEqual(['3600', '900']);
  });
});
