import { restoreBackup, deleteBackup, getBackupPath } from '../backup';

// Mock fs and child_process — we only test the pure/sync logic paths
// (path traversal defense, filename validation, error handling)
// not the actual pg_dump/psql execution

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn().mockResolvedValue({ size: 1000, mtime: new Date() }),
  access: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('child_process', () => ({
  exec: jest.fn(
    (
      _cmd: string,
      _opts: unknown,
      cb: (err: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      cb(null, { stdout: '', stderr: '' });
    }
  ),
}));

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, DB_PASSWORD: 'test-password' };
  jest.clearAllMocks();
});

afterAll(() => {
  process.env = originalEnv;
});

describe('restoreBackup — path traversal defense', () => {
  it('rejects filenames with ".."', async () => {
    const result = await restoreBackup('../../../etc/passwd');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid filename');
  });

  it('rejects filenames with forward slashes', async () => {
    const result = await restoreBackup('subdir/backup.sql');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid filename');
  });

  it('rejects filenames with encoded traversal', async () => {
    const result = await restoreBackup('..%2F..%2Fetc%2Fpasswd');
    // Contains ".." so should be rejected
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid filename');
  });

  it('accepts valid .sql.gz filename', async () => {
    const result = await restoreBackup('prism_2026-03-15.sql.gz');
    // Should not fail on validation (may fail on actual restore but that's mocked)
    expect(result.error).not.toBe('Invalid filename');
  });

  it('accepts valid .sql filename', async () => {
    const result = await restoreBackup('prism_2026-03-15.sql');
    expect(result.error).not.toBe('Invalid filename');
  });

  it('fails when DB_PASSWORD is not set', async () => {
    delete process.env.DB_PASSWORD;

    const result = await restoreBackup('prism_2026-03-15.sql.gz');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Database password not configured');
  });
});

describe('deleteBackup — path traversal defense', () => {
  it('rejects filenames with ".."', async () => {
    const result = await deleteBackup('../../important.sql');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid filename');
  });

  it('rejects filenames with forward slashes', async () => {
    const result = await deleteBackup('dir/file.sql');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid filename');
  });

  it('accepts valid filename and calls unlink', async () => {
    const fs = await import('fs/promises');
    const result = await deleteBackup('prism_2026-03-15.sql.gz');
    expect(result.success).toBe(true);
    expect(fs.unlink).toHaveBeenCalled();
  });
});

describe('getBackupPath — path traversal defense', () => {
  it('returns null for path traversal attempts', async () => {
    const result = await getBackupPath('../../../etc/passwd');
    expect(result).toBeNull();
  });

  it('returns null for filenames with slashes', async () => {
    const result = await getBackupPath('sub/backup.sql');
    expect(result).toBeNull();
  });

  it('returns path for valid filename', async () => {
    const result = await getBackupPath('prism_2026-03-15.sql.gz');
    expect(result).not.toBeNull();
    expect(result).toContain('prism_2026-03-15.sql.gz');
  });
});

describe('formatBytes (via listBackups internals)', () => {
  // We can't directly test formatBytes since it's not exported,
  // but we can test it indirectly through listBackups
  it('listBackups returns formatted sizes', async () => {
    const fs = await import('fs/promises');
    (fs.readdir as jest.Mock).mockResolvedValue(['backup.sql.gz']);
    (fs.stat as jest.Mock).mockResolvedValue({
      size: 1024 * 1024, // 1 MB
      mtime: new Date('2026-03-15T10:00:00Z'),
    });

    const { listBackups } = await import('../backup');
    const backups = await listBackups();

    expect(backups.length).toBe(1);
    expect(backups[0]!.sizeFormatted).toBe('1 MB');
    expect(backups[0]!.filename).toBe('backup.sql.gz');
  });

  it('listBackups filters non-SQL files', async () => {
    const fs = await import('fs/promises');
    (fs.readdir as jest.Mock).mockResolvedValue([
      'backup.sql.gz',
      'readme.md',
      'backup.sql',
      'image.png',
    ]);
    (fs.stat as jest.Mock).mockResolvedValue({
      size: 500,
      mtime: new Date('2026-03-15T10:00:00Z'),
    });

    const { listBackups } = await import('../backup');
    const backups = await listBackups();

    // Only .sql and .sql.gz files
    expect(backups.length).toBe(2);
    const filenames = backups.map((b) => b.filename);
    expect(filenames).toContain('backup.sql.gz');
    expect(filenames).toContain('backup.sql');
    expect(filenames).not.toContain('readme.md');
    expect(filenames).not.toContain('image.png');
  });

  it('listBackups sorts by date (newest first)', async () => {
    const fs = await import('fs/promises');
    (fs.readdir as jest.Mock).mockResolvedValue(['old.sql.gz', 'new.sql.gz']);

    let callCount = 0;
    (fs.stat as jest.Mock).mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        size: 500,
        mtime:
          callCount === 1
            ? new Date('2026-01-01T10:00:00Z') // old
            : new Date('2026-03-15T10:00:00Z'), // new
      });
    });

    const { listBackups } = await import('../backup');
    const backups = await listBackups();

    expect(backups[0]!.filename).toBe('new.sql.gz');
    expect(backups[1]!.filename).toBe('old.sql.gz');
  });
});
