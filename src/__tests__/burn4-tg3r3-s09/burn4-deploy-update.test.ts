import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFixture, deployCommands, deployStages, type FixtureOptions } from './burn4-command-harness';

const fixtures: Array<ReturnType<typeof createFixture>> = [];
const fixture = (options: FixtureOptions = {}) => {
  const item = createFixture(options);
  fixtures.push(item);
  return item;
};
afterEach(() => { for (const item of fixtures.splice(0)) item.dispose(); });

describe('unchanged local deployment with fully fake commands', () => {
  test('builds, replaces assets, restores ownership, restarts and checks readiness in order', () => {
    const h = fixture();
    const result = h.run('deploy');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(h.events().map(({ command, args }) => [command, args])).toEqual(deployCommands);
    expect(h.events().map((event) => event.stage)).toEqual(deployStages);
    expect(h.events().every((event) => event.exit === 0)).toBe(true);
    expect(result.stdout).toContain('App is healthy');
    expect(result.stdout).toContain('{"ready":true}');
    expect(result.stdout).not.toContain('WARNING');
    expect(h.root).toContain(' ');
  });

  test('executes byte-identical source copies without relocation or source mutation', () => {
    const h = fixture();
    expect(readFileSync(h.scriptPaths.deploy)).toEqual(readFileSync(resolve(__dirname, '../../..', 'scripts/deploy-local.sh')));
    expect(readFileSync(h.scriptPaths.update)).toEqual(readFileSync(resolve(__dirname, '../../..', 'scripts/update.sh')));
  });

  test.each(deployStages.slice(0, -1))('mandatory %s failure returns its exit code and stops all later work', (stage) => {
    const h = fixture({ failStage: stage });
    const index = deployStages.indexOf(stage);
    const command = deployCommands[index];
    if (!command) throw new Error('Fixture stage has no command calibration');
    const calibration = h.command(...command);
    expect(calibration.status).toBe(47);
    expect(h.events().map((event) => [event.stage, event.exit])).toEqual([[stage, 47]]);
    h.clearEvents();
    const result = h.run('deploy');
    expect(result.status).toBe(47);
    expect(h.events().map((event) => event.stage)).toEqual(deployStages.slice(0, index + 1));
    expect(h.events().map((event) => event.exit)).toEqual([...Array<number>(index).fill(0), 47]);
    expect(result.stdout).not.toContain('App is healthy');
    expect(result.stdout).not.toContain('WARNING: health check failed');
  });

  test.each(['standalone', 'static', 'public'] as const)('missing %s artifacts halt deployment before later mutations', (omitArtifact) => {
    const h = fixture({ omitArtifact });
    const result = h.run('deploy');
    const index = deployStages.indexOf(omitArtifact);
    expect(result.status).toBe(44);
    expect(h.events().map((event) => event.stage)).toEqual(deployStages.slice(0, index + 1));
    expect(h.events().at(-1)?.exit).toBe(44);
    expect(h.events().some((event) => event.stage === 'restart')).toBe(false);
    expect(result.stdout).not.toContain('App is healthy');
  });

  test.each([7, 22])('curl failure %i reaches the warning branch after a completed restart', (failCode) => {
    const h = fixture({ failStage: 'readiness', failCode });
    expect(h.command('curl', ['-sf', 'http://localhost:3000/api/health/ready']).status).toBe(failCode);
    h.clearEvents();
    const result = h.run('deploy');
    expect(h.events().map((event) => event.stage)).toEqual(deployStages);
    expect(h.events().at(-1)?.exit).toBe(failCode);
    expect(result.stdout).toContain('WARNING: health check failed');
    expect(result.stdout).not.toContain('App is healthy');
  });
});

describe('unchanged update script with fake Git and legacy Compose', () => {
  test('pulls before rebuilding and emits completion guidance only after both succeed', () => {
    const h = fixture();
    const result = h.run('update');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(h.events()).toEqual([
      { command: 'git', args: ['pull'], stage: 'pull', exit: 0 },
      { command: 'docker-compose', args: ['up', '-d', '--build'], stage: 'compose', exit: 0 },
    ]);
    expect(result.stdout).toContain('Prism updated. Migrations run automatically on startup.');
    expect(result.stdout).toContain('Check logs with: docker-compose logs -f app');
  });

  test.each(['pull', 'compose'] as const)('%s failure preserves its status and suppresses success guidance', (stage) => {
    const h = fixture({ failStage: stage, failCode: 53 });
    const command: [string, string[]] = stage === 'pull' ? ['git', ['pull']] : ['docker-compose', ['up', '-d', '--build']];
    expect(h.command(...command).status).toBe(53);
    h.clearEvents();
    const result = h.run('update');
    expect(result.status).toBe(53);
    expect(h.events().map((event) => event.stage)).toEqual(stage === 'pull' ? ['pull'] : ['pull', 'compose']);
    expect(result.stdout).not.toContain('Prism updated.');
    expect(result.stdout).not.toContain('Check logs with:');
  });

  test('a missing legacy Compose executable returns command-not-found without claiming success', () => {
    const missing = fixture({ missingCommand: 'docker-compose' });
    const result = missing.run('update');
    expect(result.status).toBe(127);
    expect(missing.events().map((event) => event.stage)).toEqual(['pull']);
    expect(result.stdout).not.toContain('Prism updated.');
    expect(result.stderr).toContain('docker-compose: command not found');
  });
});

describe('closed command fake calibration', () => {
  test.each([
    ['npm', ['install']], ['git', ['push']], ['docker', ['compose', 'up', '-d']],
    ['curl', ['https://fixture.invalid']], ['sleep', ['3600']],
  ] as Array<[string, string[]]>)('rejects unsupported %s arguments without host command fallback', (command, args) => {
    const h = fixture();
    const result = h.command(command, args);
    expect(result.status).toBe(98);
    expect(result.stderr).toContain('Unexpected fixture command');
    expect(h.events()).toEqual([{ command, args, stage: 'UNEXPECTED', exit: 98 }]);
  });
});
