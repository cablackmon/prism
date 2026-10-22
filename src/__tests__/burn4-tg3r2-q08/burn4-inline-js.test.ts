import { join } from 'node:path';
import { cleanupFixtures, createFixture, runScript, writeFixture } from './burn4-shell-fixture';

const validBlock = '<script>\nconst version = 3;\n</script>\n';
const invalidBlock = '<script>\nconst repeated = 1;\nconst repeated = 2;\n</script>\n';

afterEach(cleanupFixtures);

describe('check-inline-js local HTML validation', () => {
  test('requires at least one input argument', () => {
    const result = runScript(createFixture(), 'check-inline-js.sh');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('usage:');
    expect(result.stderr).toContain('file.html');
  });

  test('warns and skips missing paths under the documented scanner policy', () => {
    const root = createFixture();
    const missing = join(root, 'missing.html');
    const result = runScript(root, 'check-inline-js.sh', [missing]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe(`WARN: ${missing} not found, skipping\n`);
    expect(result.stdout).toContain('clean (checked 1 file(s))');
  });

  test.each([
    ['empty document', ''],
    ['document without scripts', '<h1>Fixture page</h1>'],
    ['empty script', '<script>\n</script>'],
    ['whitespace script', '<script>\n  \t\n</script>'],
    ['multiline script', validBlock],
    ['module syntax', '<script type="module">\nimport value from "./local.js";\nawait value();\n</script>'],
    ['code on the opening line', '<script>const first = 1;\nconst second = 2;\n</script>'],
    ['code on the closing line', '<script>\nconst first = 1;</script><p>done</p>'],
  ])('accepts %s without executing JavaScript', (_label, contents) => {
    const root = createFixture();
    const file = writeFixture(root, 'page.html', contents);
    const result = runScript(root, 'check-inline-js.sh', [file]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('clean (checked 1 file(s))');
  });

  test('performs syntax checking without running inline side effects', () => {
    const root = createFixture();
    const file = writeFixture(root, 'page.html', '<script>\nthrow new Error("must not execute");\n</script>');
    expect(runScript(root, 'check-inline-js.sh', [file]).status).toBe(0);
  });

  test('reports duplicate declarations with the original file path', () => {
    const root = createFixture();
    const file = writeFixture(root, 'page.html', invalidBlock);
    const result = runScript(root, 'check-inline-js.sh', [file]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`FAIL: ${file}`);
    expect(result.stderr).toContain('already been declared');
    expect(result.stderr).toContain('one or more inline scripts failed to parse');
    expect(result.stderr).not.toMatch(/\/block-\d+\.mjs/);
  });

  test('keeps declarations from separate blocks in separate parser inputs', () => {
    const root = createFixture();
    const file = writeFixture(root, 'page.html', validBlock + validBlock);
    const result = runScript(root, 'check-inline-js.sh', [file]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('reports each bad block in a single document', () => {
    const root = createFixture();
    const file = writeFixture(root, 'page.html', invalidBlock + validBlock + invalidBlock);
    const result = runScript(root, 'check-inline-js.sh', [file]);
    expect(result.status).toBe(1);
    expect(result.stderr.match(/FAIL:/g)).toHaveLength(2);
  });

  test('checks later files after a failure and handles paths with spaces', () => {
    const root = createFixture();
    const first = writeFixture(root, 'first bad page.html', invalidBlock);
    const second = writeFixture(root, 'second good page.html', validBlock);
    const third = writeFixture(root, 'third bad page.html', invalidBlock);
    const result = runScript(root, 'check-inline-js.sh', [first, second, third]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`FAIL: ${first}`);
    expect(result.stderr).toContain(`FAIL: ${third}`);
    expect(result.stderr).not.toContain(`FAIL: ${second}`);
    expect(result.stderr.match(/FAIL:/g)).toHaveLength(2);
  });

  test('continues after a missing file and counts successful argument inputs', () => {
    const root = createFixture();
    const missing = join(root, 'missing.html');
    const good = writeFixture(root, 'good.html', validBlock);
    const result = runScript(root, 'check-inline-js.sh', [missing, good]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`WARN: ${missing}`);
    expect(result.stdout).toContain('clean (checked 2 file(s))');
  });

  test.each([
    '<script src="./never-loaded.js"></script>\n',
    '<script src="./never-loaded.js">\nconst = invalid;\n</script>\n',
    '<script defer src="./never-loaded.js"></script>\n',
  ])('ignores an external script and still checks the following inline block: %s', (external) => {
    const root = createFixture();
    const file = writeFixture(root, 'page.html', external + validBlock);
    const result = runScript(root, 'check-inline-js.sh', [file]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('still rejects an invalid inline block following an ignored external script', () => {
    const root = createFixture();
    const file = writeFixture(root, 'page.html', '<script src="./never-loaded.js"></script>\n' + invalidBlock);
    const result = runScript(root, 'check-inline-js.sh', [file]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('already been declared');
  });

  test.failing('KNOWN GAP: valid same-line script bodies retain the closing tag and fail parsing', () => {
    const root = createFixture();
    const file = writeFixture(root, 'page.html', '<script>const okay = 1;</script>');
    expect(runScript(root, 'check-inline-js.sh', [file]).status).toBe(0);
  });

  test.failing('KNOWN GAP: a later opening tag on the same line hides an earlier invalid block', () => {
    const root = createFixture();
    const file = writeFixture(root, 'page.html', '<script>const = invalid;</script><script>\nconst okay = 1;\n</script>');
    expect(runScript(root, 'check-inline-js.sh', [file]).status).toBe(1);
  });

  test.failing('KNOWN GAP: valid whitespace before the src equals sign makes external content get checked', () => {
    const root = createFixture();
    const file = writeFixture(root, 'page.html', '<script src = "./never-loaded.js">\nconst = invalid;\n</script>');
    expect(runScript(root, 'check-inline-js.sh', [file]).status).toBe(0);
  });

  test.failing('KNOWN GAP: uppercase HTML script tags silently skip invalid JavaScript', () => {
    const root = createFixture();
    const file = writeFixture(root, 'page.html', '<SCRIPT>\nconst = invalid;\n</SCRIPT>');
    expect(runScript(root, 'check-inline-js.sh', [file]).status).toBe(1);
  });
});
