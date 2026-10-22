import { scanFixture } from './burn4-hostnames-fixture';

const alpha = 'burn4-fixture-alpha.com';
const beta = 'burn4-fixture-beta.net';
const gamma = 'burn4-fixture-gamma.io';
const noTargets = '[scan-hostnames] No matching files to scan.\n';
const noComments = '[scan-hostnames] Clean: no comment lines to scan.\n';
const clean = '[scan-hostnames] Clean: no non-allowlisted hostnames in comments.\n';
// Some awk implementations warn when interpreting the runner's escaped allowlist.
const awkWarning = "awk: warning: escape sequence `\\.' treated as plain `.'\n";

function expectClean(result: ReturnType<typeof scanFixture>, output = clean) {
  expect(result.status).toBe(0);
  expect(['', awkWarning]).toContain(result.stderr);
  expect(result.stdout).toBe(output);
  expect(result.violationLines).toEqual([]);
}

function expectViolations(result: ReturnType<typeof scanFixture>, count: number) {
  expect(result.status).toBe(1);
  expect(['', awkWarning]).toContain(result.stderr);
  expect(result.violationLines).toHaveLength(count);
  expect(result.stdout).toContain(`[scan-hostnames] FAIL: ${count} line(s) with potentially-real hostnames in comments.`);
}

describe('burn4 tracked hostname scanner inputs', () => {
  test('empty index exits cleanly without trying to scan the source repository', () => {
    expectClean(scanFixture(), noTargets);
  });

  test('untracked source and comment files never become scan targets', () => {
    expectClean(scanFixture({ untracked: { 'burn4-untracked.ts': `// ${alpha}\n`, 'notes.md': `# ${beta}\n` } }), noTargets);
  });

  test('every documented source-shaped extension is included in tracked targets', () => {
    const extensions = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'sh', 'py', 'md', 'yml', 'yaml', 'json', 'css', 'scss', 'sql'];
    const tracked = Object.fromEntries(extensions.map(extension => [`burn4-source.${extension}`, `// ${alpha}\n`]));
    const result = scanFixture({ tracked });
    expectViolations(result, extensions.length);
    for (const extension of extensions) {
      expect(result.violationLines).toContain(`  burn4-source.${extension}:1:// ${alpha}  [hostname(s): ${alpha}]`);
    }
  });

  test('unsupported extensions, extensionless files and differently cased extensions are ignored', () => {
    const ignored = ['burn4-note.txt', 'burn4-picture.png', 'burn4-file.lock', 'burn4-output.snap', 'burn4-extensionless', 'burn4-upper.TS'];
    expectClean(scanFixture({ tracked: Object.fromEntries(ignored.map(name => [name, `// ${alpha}\n`])) }), noTargets);
  });

  test('root scanner files, package lock and the exact review documentation exception are excluded', () => {
    const ignored = ['scripts/scan-pii.sh', 'scripts/scan-examples.sh', 'scripts/scan-hostnames.sh', 'scripts/scan-secrets.sh', 'package-lock.json', 'docs/code-review-modalities.md'];
    expectClean(scanFixture({ tracked: Object.fromEntries(ignored.map(name => [name, `// ${alpha}\n`])) }), noTargets);
  });

  test('exclusions match exact root paths rather than suppressing nested files with the same basename', () => {
    const paths = ['nested/scripts/scan-hostnames.sh', 'nested/package-lock.json', 'nested/docs/code-review-modalities.md'];
    const result = scanFixture({ tracked: Object.fromEntries(paths.map(name => [name, `// ${alpha}\n`])) });
    expectViolations(result, paths.length);
    for (const name of paths) expect(result.violationLines).toContain(`  ${name}:1:// ${alpha}  [hostname(s): ${alpha}]`);
  });

  test('tracked current working content is scanned rather than clean staged content', () => {
    const result = scanFixture({
      tracked: { 'burn4-staged.ts': '// example.com\n' },
      workingChanges: { 'burn4-staged.ts': `// ${alpha}\n` },
    });
    expectViolations(result, 1);
    expect(result.violationLines[0]).toContain('burn4-staged.ts:1:');
  });

  test('a removed hostname in current working content does not report its stale staged version', () => {
    expectClean(scanFixture({
      tracked: { 'burn4-changed.ts': `// ${alpha}\n` },
      workingChanges: { 'burn4-changed.ts': '// example.com\n' },
    }));
  });

  test('untracked siblings are ignored beside a clean tracked candidate', () => {
    expectClean(scanFixture({ tracked: { 'burn4-clean.ts': 'export const count = 1;\n' }, untracked: { 'burn4-other.ts': `// ${alpha}\n` } }), noComments);
  });

  test('a removed tracked path is ignored without preventing a present tracked violation', () => {
    const result = scanFixture({
      tracked: { 'burn4-missing.ts': `// ${beta}\n`, 'burn4-present.ts': `// ${alpha}\n` },
      removeAfterTracking: ['burn4-missing.ts'],
    });
    expectViolations(result, 1);
    expect(result.violationLines).toEqual([`  burn4-present.ts:1:// ${alpha}  [hostname(s): ${alpha}]`]);
  });

  test('a missing sole tracked candidate produces the documented no-comment clean output', () => {
    expectClean(scanFixture({ tracked: { 'burn4-missing.ts': `// ${alpha}\n` }, removeAfterTracking: ['burn4-missing.ts'] }), noComments);
  });

  test('filenames and directories containing spaces retain actionable path and line diagnostics', () => {
    const path = 'burn4 folder with spaces/burn4 comment file.ts';
    const result = scanFixture({ tracked: { [path]: `export const count = 1;\n// ${alpha}\n` } });
    expectViolations(result, 1);
    expect(result.violationLines).toEqual([`  ${path}:2:// ${alpha}  [hostname(s): ${alpha}]`]);
  });
});

describe('burn4 comment and hostname heuristics', () => {
  test('leading slash, hash and star comment forms are recognized after spaces or tabs', () => {
    const content = [`// ${alpha}`, `  # ${beta}`, `\t * ${gamma}`].join('\n') + '\n';
    const result = scanFixture({ tracked: { 'burn4-comments.ts': content } });
    expectViolations(result, 3);
    expect(result.violationLines).toEqual([
      `  burn4-comments.ts:1:// ${alpha}  [hostname(s): ${alpha}]`,
      `  burn4-comments.ts:2:  # ${beta}  [hostname(s): ${beta}]`,
      `  burn4-comments.ts:3:\t * ${gamma}  [hostname(s): ${gamma}]`,
    ]);
  });

  test('code strings, trailing inline comments and block openers are outside the documented line-start heuristic', () => {
    const content = [`const value = "${alpha}";`, `const value = 1; // ${beta}`, `/* ${gamma} */`, `ordinary prose ${alpha}`].join('\n') + '\n';
    expectClean(scanFixture({ tracked: { 'burn4-scope.ts': content } }), noComments);
  });

  test('comment lines without hostname-shaped tokens are clean', () => {
    expectClean(scanFixture({ tracked: { 'burn4-comment.ts': '// local-only hostname and prose\n# no dotted names\n' } }));
  });

  test('property access, versions and unsupported final labels are outside the public-TLD filter', () => {
    const content = '// object.user.name Number.prototype.toString 1.2.3 service.local burn4-fixture.invalid burn4-fixture.museum\n';
    expectClean(scanFixture({ tracked: { 'burn4-properties.ts': content } }));
  });

  test('known public TLDs are recognized across simple, deep, hyphenated and numeric host labels', () => {
    const hosts = ['burn4-fixture.com', 'deep.burn4-fixture.co.uk', 'burn4-7.fixture.cloud', '127.0.0.1.example.tech', 'burn4fixture.gov'];
    const result = scanFixture({ tracked: { 'burn4-hosts.ts': hosts.map(host => `// ${host}`).join('\n') + '\n' } });
    expectViolations(result, hosts.length);
    hosts.forEach((host, index) => expect(result.violationLines[index]).toBe(`  burn4-hosts.ts:${index + 1}:// ${host}  [hostname(s): ${host}]`));
  });

  test('public TLD matching is case-insensitive while diagnostics preserve original host spelling', () => {
    const host = 'BURN4-Fixture.COM';
    const result = scanFixture({ tracked: { 'burn4-uppercase.ts': `// ${host}\n` } });
    expectViolations(result, 1);
    expect(result.violationLines).toEqual([`  burn4-uppercase.ts:1:// ${host}  [hostname(s): ${host}]`]);
  });

  test('URL paths, ports and surrounding punctuation stay out of extracted hostname diagnostics', () => {
    const result = scanFixture({ tracked: { 'burn4-url.ts': `// (https://${alpha}:8443/docs), [${beta}], and ${gamma}.\n` } });
    expectViolations(result, 1);
    expect(result.violationLines).toEqual([`  burn4-url.ts:1:// (https://${alpha}:8443/docs), [${beta}], and ${gamma}.  [hostname(s): ${alpha}, ${beta}, ${gamma}]`]);
  });

  test('a final comment without a trailing newline still reports one violating line', () => {
    const result = scanFixture({ tracked: { 'burn4-no-newline.ts': `// ${alpha}` } });
    expectViolations(result, 1);
    expect(result.violationLines).toEqual([`  burn4-no-newline.ts:1:// ${alpha}  [hostname(s): ${alpha}]`]);
  });

  test('hostname-shaped filenames never become violations when comment content is clean', () => {
    expectClean(scanFixture({ tracked: { 'burn4-fixture.com.ts': '// ordinary explanatory comment\n' } }));
  });
});

describe('burn4 allowlist boundaries and case regression', () => {
  test('exact reserved, project and vendor allowlist entries are clean', () => {
    const hosts = ['example.com', 'example.net', 'example.org', 'example.edu', 'github.com', 'ghcr.io', 'graph.microsoft.com', 'open-meteo.com', 'developer.amazon.com', 'api.kroger.com', 'caldav.icloud.com', 'contacts.icloud.com', 'playwright.dev'];
    expectClean(scanFixture({ tracked: { 'burn4-allowed.ts': hosts.map(host => `// https://${host}/docs`).join('\n') + '\n' } }));
  });

  test('subdomains remain allowed only after a hostname label boundary, including multiple nested labels', () => {
    const hosts = ['x.example.com', 'deep.nested.example.net', 'raw.githubusercontent.com', 'docs.github.com', 'sub.api.kroger.com', 'x.caldav.icloud.com'];
    expectClean(scanFixture({ tracked: { 'burn4-subdomains.ts': hosts.map(host => `// ${host}`).join('\n') + '\n' } }));
  });

  test('lookalike suffixes and allowlisted names followed by another public domain are rejected', () => {
    const hosts = ['burn4example.com', 'burn4github.com', 'example.com.burn4-fixture.org', 'github.com.burn4-fixture.net'];
    const result = scanFixture({ tracked: { 'burn4-boundary.ts': hosts.map(host => `// ${host}`).join('\n') + '\n' } });
    expectViolations(result, hosts.length);
    hosts.forEach((host, index) => expect(result.violationLines[index]).toContain(`[hostname(s): ${host}]`));
  });

  test('allowlisted and unsupported tokens do not hide other violations on the same line', () => {
    const result = scanFixture({ tracked: { 'burn4-mixed.ts': `// example.com ${alpha} object.property ${beta} docs.github.com\n` } });
    expectViolations(result, 1);
    expect(result.violationLines).toEqual([`  burn4-mixed.ts:1:// example.com ${alpha} object.property ${beta} docs.github.com  [hostname(s): ${alpha}, ${beta}]`]);
  });

  test('matching hosts on multiple lines report line count rather than total token count', () => {
    const result = scanFixture({ tracked: { 'burn4-lines.ts': `// ${alpha} ${beta}\n// example.com\n# ${gamma}\n` } });
    expectViolations(result, 2);
    expect(result.violationLines).toEqual([
      `  burn4-lines.ts:1:// ${alpha} ${beta}  [hostname(s): ${alpha}, ${beta}]`,
      `  burn4-lines.ts:3:# ${gamma}  [hostname(s): ${gamma}]`,
    ]);
    expect(result.stdout).toContain('If a hit is legitimate, add it to the ALLOWLIST in scripts/scan-hostnames.sh.');
    expect(result.stdout).toContain('Otherwise, scrub the hostname from the comment before pushing.');
  });

  test('duplicate occurrences are preserved in source order within a single diagnostic line', () => {
    const result = scanFixture({ tracked: { 'burn4-repeat.ts': `// ${beta} ${alpha} ${beta}\n` } });
    expectViolations(result, 1);
    expect(result.violationLines[0]).toContain(`[hostname(s): ${beta}, ${alpha}, ${beta}]`);
  });

  test('multiple tracked files keep separate path and line prefixes without scanning untracked data', () => {
    const result = scanFixture({
      tracked: { 'burn4-a.ts': `// ${alpha}\n`, 'nested/burn4-b.py': `# explanatory line\n# ${beta}\n` },
      untracked: { 'burn4-untracked-control.ts': `// ${gamma}\n` },
    });
    expectViolations(result, 2);
    expect(result.violationLines).toEqual([
      `  burn4-a.ts:1:// ${alpha}  [hostname(s): ${alpha}]`,
      `  nested/burn4-b.py:2:# ${beta}  [hostname(s): ${beta}]`,
    ]);
  });

  test('lowercase reserved documentation hostname is a positive allowlist control', () => {
    expectClean(scanFixture({ tracked: { 'burn4-control.ts': '// https://example.com/sample\n' } }));
  });

  test.failing('KNOWN GAP: uppercase reserved hostname is incorrectly rejected by the case-sensitive allowlist', () => {
    const result = scanFixture({ tracked: { 'burn4-case.ts': '// https://EXAMPLE.COM/sample\n' } });
    expect(result.status).toBe(0);
  });

  test.failing('KNOWN GAP: uppercase allowlisted subdomains are incorrectly rejected by the case-sensitive allowlist', () => {
    const result = scanFixture({ tracked: { 'burn4-case-subdomain.ts': '// https://DOCS.EXAMPLE.COM/sample\n' } });
    expect(result.status).toBe(0);
  });
});
