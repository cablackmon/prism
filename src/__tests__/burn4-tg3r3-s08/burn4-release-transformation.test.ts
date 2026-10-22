import { DEFAULT_CHANGELOG, DEFAULT_PACKAGE, RELEASE_DATE, runRelease } from './burn4-release-fixture';

describe('release document transformation', () => {
  test('moves the entire note body, retains history and preserves package metadata', () => {
    const result = runRelease();
    const [prefix, body] = DEFAULT_CHANGELOG.split('## Unreleased\n');
    const [notes, ...history] = (body ?? '').split('## [1.2.3]');
    const expected = `${prefix}## Unreleased\n\n## [1.2.4] \u2013 ${RELEASE_DATE}\n\n${notes?.trim()}\n\n## [1.2.3]${history.join('## [1.2.3]')}`;
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.after.changelog).toBe(expected);
    expect(result.after.packageText).toBe(JSON.stringify({ ...JSON.parse(DEFAULT_PACKAGE), version: '1.2.4' }, null, 2) + '\n');
    expect(result.after.addon).toBeNull();
    expect(result.nodeCalls).toBe(3);
    expect(result.checkerCalls).toEqual(['checker']);
    expect(result.stdout).toContain('Release prep complete');
  });

  test.each(['1.3.0', '2.0.0', '1.2.12'])('prepares a valid %s version without interpreting components as strings', (version) => {
    const result = runRelease([version]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.after.packageText ?? 'null').version).toBe(version);
    expect(result.after.changelog).toContain(`## Unreleased\n\n## [${version}] \u2013 ${RELEASE_DATE}\n`);
    expect(result.checkerCalls).toEqual(['checker']);
  });

  test.each(['"1.2.3"', "'1.2.3'", '1.2.3'])('updates a YAML version expressed as %s while retaining unrelated settings', (oldVersion) => {
    const addon = `name: burn4-fixture\nversion: ${oldVersion}\nports:\n  3000/tcp: 3000\n`;
    const result = runRelease(['1.2.4'], { addon });
    expect(result.status).toBe(0);
    expect(result.after.addon).toBe('name: burn4-fixture\nversion: "1.2.4"\nports:\n  3000/tcp: 3000\n');
    expect(result.nodeCalls).toBe(4);
    expect(result.checkerCalls).toEqual(['checker']);
  });

  test('keeps blank lines inside notes and trims only the note body edges', () => {
    const changelog = '# History\n\n## Unreleased\n \n\t\n### Added\n\n- First.\n\n\n- Second.\n  \n\n## [1.2.3]\n\n- Old.\n';
    const result = runRelease(['1.2.4'], { changelog });
    expect(result.status).toBe(0);
    expect(result.after.changelog).toBe(`# History\n\n## Unreleased\n\n## [1.2.4] \u2013 ${RELEASE_DATE}\n\n### Added\n\n- First.\n\n\n- Second.\n\n## [1.2.3]\n\n- Old.\n`);
  });

  test('recognizes a whitespace-padded Unreleased heading without rewriting its text', () => {
    const result = runRelease(['1.2.4'], { changelog: DEFAULT_CHANGELOG.replace('## Unreleased', '  ## Unreleased  ') });
    expect(result.status).toBe(0);
    expect(result.after.changelog).toContain(`  ## Unreleased  \n\n## [1.2.4] \u2013 ${RELEASE_DATE}\n`);
    expect(result.after.changelog).toContain('## [1.2.2] - 2041-06-30\n\n- Earlier history stays intact.\n');
  });

  test('preserves Markdown code, Unicode and text that resembles suggested commands as inert content', () => {
    const notes = '### Changed\n- Preserve caf\u00e9 and \u96ea.\n\n```sh\ngit push fixture-only\ngh release create fixture-only\n```';
    const changelog = `# Changes\n\n## Unreleased\n\n${notes}\n\n## [1.2.3]\n- Old.\n`;
    const result = runRelease(['1.2.4'], { changelog });
    expect(result.status).toBe(0);
    expect(result.after.changelog).toBe(`# Changes\n\n## Unreleased\n\n## [1.2.4] \u2013 ${RELEASE_DATE}\n\n${notes}\n\n## [1.2.3]\n- Old.\n`);
    expect(result.checkerCalls).toEqual(['checker']);
  });

  test('the fake checker failure is propagated and success instructions are withheld', () => {
    const result = runRelease(['1.2.4'], { checkerStatus: 64 });
    expect(result.status).toBe(64);
    expect(result.checkerCalls).toEqual(['checker']);
    expect(result.stdout).not.toContain('Release prep complete');
    expect(result.stdout).not.toContain('Suggested next steps');
  });

  test('rerunning a completed release is a no-op error before any second write', () => {
    const first = runRelease(['1.2.4'], { addon: 'version: "1.2.3"\n' });
    const second = runRelease(['1.2.4'], {
      packageText: first.after.packageText,
      changelog: first.after.changelog,
      addon: first.after.addon ?? undefined,
    });
    expect(first.status).toBe(0);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('already at 1.2.4');
    expect(second.after).toEqual(first.after);
    expect(second.checkerCalls).toEqual([]);
  });

  test('a different version cannot release the notes a second time after Unreleased is emptied', () => {
    const first = runRelease();
    const second = runRelease(['1.2.5'], { packageText: first.after.packageText, changelog: first.after.changelog });
    expect(first.status).toBe(0);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('section is empty');
    expect(second.after).toEqual(first.after);
    expect(second.checkerCalls).toEqual([]);
  });

  test('a later release moves only fresh notes and retains the complete earlier release', () => {
    const first = runRelease();
    const freshNotes = '- A later local fixture change.';
    const updatedChangelog = first.after.changelog?.replace('## Unreleased\n', `## Unreleased\n\n${freshNotes}\n`) ?? '';
    const second = runRelease(['1.2.5'], { packageText: first.after.packageText, changelog: updatedChangelog });
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(second.after.changelog).toBe(first.after.changelog?.replace('## Unreleased\n', `## Unreleased\n\n## [1.2.5] \u2013 ${RELEASE_DATE}\n\n${freshNotes}\n`));
    expect(second.checkerCalls).toEqual(['checker']);
    expect(JSON.parse(second.after.packageText ?? 'null').version).toBe('1.2.5');
  });
});
