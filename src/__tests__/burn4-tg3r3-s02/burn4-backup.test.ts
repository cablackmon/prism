import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanFixtures, createFixture } from './burn4-shell-fixture';

const remote = 'fixture:prism/database';
const health = 'https://health.invalid/burn4';
const settings = { RCLONE_REMOTE: remote, HC_URL: health };

afterEach(cleanFixtures);

describe('backup local integrity and retention with isolated commands', () => {
  test('creates the timestamped dump and sends start then success after local validation', () => {
    const fixture = createFixture();
    const result = fixture.runBackup({ HC_URL: health });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(readFileSync(fixture.backupFile)).toEqual(Buffer.alloc(12001, 'x'));
    expect(fixture.calls().find(call => call.command === 'pg_dump')?.args)
      .toEqual(['-h', 'db', '-U', 'prism', '-d', 'prism', '--no-owner', '--no-acl']);
    expect(fixture.calls().filter(call => call.command === 'curl').map(call => call.args.at(-1)))
      .toEqual([`${health}/start`, health]);
    expect(fixture.calls().some(call => call.command === 'rclone')).toBe(false);
    expect(result.stdout).toContain('Backup process complete.');
  });

  test.each([0, 10000])('rejects a %i-byte dump and sends failure without uploading', bytes => {
    const fixture = createFixture({ dumpBytes: bytes });
    const result = fixture.runBackup(settings);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Backup failed or too small');
    expect(fixture.calls().some(call => call.command === 'rclone')).toBe(false);
    expect(fixture.calls().filter(call => call.command === 'curl').at(-1)?.args.at(-1))
      .toBe(`${health}/fail`);
  });

  test('accepts the first size above the strict 10000-byte threshold', () => {
    const fixture = createFixture({ dumpBytes: 10001 });
    expect(fixture.runBackup().status).toBe(0);
    expect(readFileSync(fixture.backupFile).length).toBe(10001);
  });

  test('a failed dump with an empty stream is rejected by the minimum size check', () => {
    const fixture = createFixture({ dumpExit: 12, dumpBytes: 0 });
    expect(fixture.runBackup(settings).status).toBe(1);
    expect(fixture.calls().filter(call => call.command === 'curl').at(-1)?.args.at(-1))
      .toBe(`${health}/fail`);
  });

  test('compression failure halts before retention or upload', () => {
    const fixture = createFixture({ gzipExit: 8 });
    const stale = join(fixture.backups, 'prism_stale.sql.gz');
    writeFileSync(stale, 'synthetic stale dump');
    utimesSync(stale, 0, 0);
    expect(fixture.runBackup(settings).status).toBe(8);
    expect(existsSync(stale)).toBe(true);
    expect(fixture.calls().some(call => call.command === 'rclone')).toBe(false);
  });

  test('retention removes only old matching files and preserves other names and directories', () => {
    const fixture = createFixture();
    const old = join(fixture.backups, 'prism_old.sql.gz');
    const unrelated = join(fixture.backups, 'notes.sql.gz');
    const current = join(fixture.backups, 'prism_current.sql.gz');
    const directory = join(fixture.backups, 'prism_directory.sql.gz');
    for (const target of [old, unrelated, current]) writeFileSync(target, 'synthetic file');
    mkdirSync(directory);
    for (const target of [old, unrelated, directory]) utimesSync(target, 0, 0);
    expect(fixture.runBackup().status).toBe(0);
    expect([old, unrelated, current, directory].map(existsSync)).toEqual([false, true, true, true]);
  });

  test('uses configured retention instead of the seven-day default', () => {
    const fixture = createFixture();
    const retained = join(fixture.backups, 'prism_30days.sql.gz');
    const expired = join(fixture.backups, 'prism_90days.sql.gz');
    for (const [target, age] of [[retained, 30], [expired, 90]] as const) {
      writeFileSync(target, 'synthetic dump');
      const timestamp = new Date(Date.now() - age * 86400000);
      utimesSync(target, timestamp, timestamp);
    }
    expect(fixture.runBackup({ RETENTION_DAYS: '40' }).status).toBe(0);
    expect([existsSync(retained), existsSync(expired)]).toEqual([true, false]);
  });

  test('health reporting is optional when curl is unavailable', () => {
    const fixture = createFixture({ curlInstalled: false });
    expect(fixture.runBackup({ HC_URL: health }).status).toBe(0);
    expect(fixture.calls().some(call => call.command === 'curl')).toBe(false);
  });

  test('an unavailable health endpoint does not invalidate a successful local backup', () => {
    const fixture = createFixture({ curlExit: 7 });
    expect(fixture.runBackup({ HC_URL: health }).status).toBe(0);
    expect(fixture.calls().filter(call => call.command === 'curl')).toHaveLength(2);
  });
});

describe('backup remote copy, archival and verification contracts', () => {
  test('copies the new dump and checks all local database backups one way', () => {
    const fixture = createFixture();
    expect(fixture.runBackup(settings).status).toBe(0);
    expect(fixture.calls().filter(call => call.command === 'rclone').map(call => call.args))
      .toEqual([
        ['copy', fixture.backupFile, remote, '--progress'],
        ['check', fixture.backups, remote, '--one-way'],
      ]);
  });

  test('applies optional remote retention after copy while ignoring deletion failures', () => {
    const fixture = createFixture({ rcloneFailures: ['delete:database'] });
    expect(fixture.runBackup({ ...settings, RCLONE_RETENTION_DAYS: '31' }).status).toBe(0);
    expect(fixture.calls().filter(call => call.command === 'rclone').map(call => call.args[0]))
      .toEqual(['copy', 'delete', 'check']);
    expect(fixture.calls().find(call => call.command === 'rclone' && call.args[0] === 'delete')?.args)
      .toEqual(['delete', remote, '--min-age', '31d']);
  });

  test('syncs assets with deletion archival and excludes the photo cache in both operations', () => {
    const fixture = createFixture();
    fixture.writeData('avatars/burn4-avatar.txt');
    fixture.writeData('photos/cache/burn4-cache.txt');
    expect(fixture.runBackup(settings).status).toBe(0);
    expect(fixture.calls().filter(call => call.command === 'rclone').map(call => call.args))
      .toEqual([
        ['copy', fixture.backupFile, remote, '--progress'],
        ['sync', fixture.data, 'fixture:prism/data', '--exclude', 'photos/cache/**',
          '--backup-dir', 'fixture:prism/data-deleted/20261021_030000', '--progress'],
        ['check', fixture.backups, remote, '--one-way'],
        ['check', fixture.data, 'fixture:prism/data', '--one-way', '--exclude', 'photos/cache/**'],
      ]);
    expect(fixture.calls().filter(call => call.command === 'curl').at(-1)?.args.at(-1)).toBe(health);
  });

  test.each(['missing', 'empty'] as const)('skips asset sync and verify for %s data', kind => {
    const fixture = createFixture();
    if (kind === 'missing') rmSync(fixture.data, { recursive: true });
    expect(fixture.runBackup(settings).status).toBe(0);
    expect(fixture.calls().filter(call => call.command === 'rclone').map(call => call.args[0]))
      .toEqual(['copy', 'check']);
  });

  test.each(['directory', 'photo-cache'] as const)('avoids asset verification for %s only data', kind => {
    const fixture = createFixture();
    if (kind === 'directory') mkdirSync(join(fixture.data, 'empty-album'));
    else fixture.writeData('photos/cache/burn4-cache.txt');
    expect(fixture.runBackup(settings).status).toBe(0);
    expect(fixture.calls().filter(call => call.command === 'rclone').map(call => call.args[0]))
      .toEqual(['copy', 'sync', 'check']);
  });

  test('a failed database copy still attempts asset preservation and skips verification', () => {
    const fixture = createFixture({ rcloneFailures: ['copy:database'] });
    fixture.writeData('avatars/burn4-avatar.txt');
    const result = fixture.runBackup(settings);
    expect(result.stdout).toContain('Database backup off-site sync failed');
    expect(fixture.calls().filter(call => call.command === 'rclone').map(call => call.args[0]))
      .toEqual(['copy', 'sync']);
    expect(fixture.calls().filter(call => call.command === 'curl').at(-1)?.args.at(-1))
      .toBe(`${health}/fail`);
  });

  test.each(['sync:data', 'check:database', 'check:data'])(
    'reports off-site failure for %s without sending a success health ping', failure => {
      const fixture = createFixture({ rcloneFailures: [failure] });
      fixture.writeData('avatars/burn4-avatar.txt');
      const result = fixture.runBackup(settings);
      expect(result.stdout).toContain('off-site sync had failures.');
      expect(fixture.calls().filter(call => call.command === 'curl').map(call => call.args.at(-1)))
        .toEqual([`${health}/start`, `${health}/fail`]);
      if (failure === 'sync:data') {
        expect(fixture.calls().filter(call => call.command === 'rclone').map(call => call.args[0]))
          .toEqual(['copy', 'sync']);
      }
    },
  );

  test('warns when a remote is configured but rclone is unavailable', () => {
    const fixture = createFixture({ rcloneInstalled: false });
    const result = fixture.runBackup(settings);
    expect(result.stdout).toContain('RCLONE_REMOTE set but rclone not installed');
    expect(fixture.calls().some(call => call.command === 'rclone')).toBe(false);
  });
});
