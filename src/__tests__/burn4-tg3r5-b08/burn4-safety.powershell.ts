import { existsSync, readdirSync } from 'node:fs';
import { cleanup, fixture, messages, operations } from './burn4-fixture';

afterEach(cleanup);

describe('HTTPS fixture isolation before subject execution', () => {
  test.each([
    'openssl version',
    'docker compose up',
    'Invoke-WebRequest https://fixture.example.invalid',
    'Start-Process mkcert',
    'certutil -help',
    'Set-Content ordinary.txt forbidden',
    'Microsoft.PowerShell.Management\\New-Item -ItemType Directory ordinary',
    'Invoke-Expression ordinary',
    '& $command',
    '$env:PATH',
    '[IO.File]::ReadAllText("ordinary")',
  ])('denies synthetic unsafe syntax before execution: %s', probe => {
    const result = fixture().run({ probe });
    expect(result.trace.gatesVerified).toBe(true);
    expect(result.trace.subjectStarted).toBe(false);
    expect(result.trace.error).toMatch(/denied/);
    expect(result.status).toBe(1);
    expect(result.trace.calls).toEqual([]);
  });

  test.each([
    ['path-escape', 'Fixture path escape denied'],
    ['material-file', 'Material file creation denied'],
    ['lookup', 'Command lookup denied'],
  ])('denies the %s dependency boundary before subject execution', (probe, error) => {
    const item = fixture();
    const result = item.run({ probe });
    expect(result.trace.gatesVerified).toBe(true);
    expect(result.trace.subjectStarted).toBe(false);
    expect(result.trace.error).toBe(error);
    expect(result.status).toBe(1);
    expect(result.trace.calls).toEqual([]);
    expect(existsSync(item.certDirectory)).toBe(false);
  });

  test('every command is a driver function before the unchanged subject starts', () => {
    const item = fixture();
    const result = item.run();
    expect(result.trace.gatesVerified).toBe(true);
    expect(result.trace.subjectStarted).toBe(true);
    expect(result.trace.error).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(readdirSync(item.certDirectory)).toEqual([]);
    expect(readdirSync(item.root, { recursive: true }).map(String).filter(path => /\.(crt|key|pem)$/i.test(path))).toEqual([]);
    expect(existsSync(item.caDirectory)).toBe(false);
    expect(operations(result)).toContain('generate');
    expect(messages(result)).toContain('Done. Prism will be available at https://fixture.example.invalid');
  });
});
