import { stepsFor, WorkflowFixture, type Step } from './burn4-workflow-harness';

const steps = stepsFor('release');
const extract = steps[0] as Step;
const verify = steps[1] as Step;
let fixture: WorkflowFixture;
beforeEach(() => { fixture = new WorkflowFixture(); });
afterEach(() => { fixture.dispose(); });

function checkVersion(version: string) {
  return fixture.run(verify, { steps: { ver: { outputs: { version } } } });
}

describe('release inline extraction and config gate', () => {
  it.each([
    ['refs/tags/v2.3.4', 'v2.3.4', '2.3.4'],
    ['refs/tags/v12.0.0-rc.2', 'v12.0.0-rc.2', '12.0.0-rc.2'],
    ['refs/tags/v2.3.4+build.5', 'v2.3.4+build.5', '2.3.4+build.5'],
    ['refs/tags/vv2.3.4', 'vv2.3.4', 'v2.3.4'],
    ['refs/tags/2.3.4', '2.3.4', '2.3.4'],
    ['refs/heads/version-check', 'refs/heads/version-check', 'refs/heads/version-check'],
  ])('%s preserves exact shell prefix behavior', (ref, tag, version) => {
    const result = fixture.run(extract, { matrix: { arch: 'amd64' } }, { ref });
    expect(result.status).toBe(0);
    expect(result.outputs).toEqual({ tag, version });
    expect(result.stdout).toBe(`Building ${tag} (version ${version}) for amd64\n`);
    expect(result.commands).toEqual([]);
  });

  it.each(['amd64', 'aarch64'])('passes extraction output into the config gate for %s', (arch) => {
    fixture.config('name: Synthetic addon\nversion: "2.3.4"\nslug: synthetic\n');
    const extracted = fixture.run(extract, { matrix: { arch } }, { ref: 'refs/tags/v2.3.4' });
    const result = checkVersion(extracted.outputs.version ?? '');
    expect(extracted.status).toBe(0);
    expect(extracted.stdout).toContain(`for ${arch}`);
    expect(result).toMatchObject({ status: 0, stdout: '', stderr: '', outputs: {}, commands: [] });
  });

  it.each([
    ['double quotes', 'version: "2.3.4"\n'],
    ['single quotes', "version: '2.3.4'\n"],
    ['unquoted', 'version: 2.3.4\n'],
    ['extra spaces', 'version:     2.3.4\n'],
    ['tabs after colon', 'version:\t"2.3.4"\n'],
    ['trailing comment', 'version: "2.3.4" # synthetic release\n'],
    ['unrelated prefix', 'schema_version: 9\nversion: "2.3.4"\n'],
  ])('accepts a matching config with %s', (_name, config) => {
    fixture.config(config);
    expect(checkVersion('2.3.4')).toMatchObject({ status: 0, stderr: '' });
  });

  it.each([
    ['different version', 'version: "2.3.5"\n', '2.3.5'],
    ['missing version', 'name: Synthetic addon\n', ''],
    ['commented version', '# version: "2.3.4"\n', ''],
    ['empty file', '', ''],
    ['empty version', 'version: ""\n', ''],
  ])('fails the %s gate with an actionable diagnostic', (_name, config, actual) => {
    fixture.config(config);
    const result = checkVersion('2.3.4');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      `ERROR: ha-app/config.yaml version (${actual}) does not match git tag (2.3.4)\n` +
      'Bump ha-app/config.yaml via scripts/release.sh before tagging.\n',
    );
    expect(result.commands).toEqual([]);
  });

  it('fails when the config file is absent', () => {
    fixture.removeConfig();
    const result = checkVersion('2.3.4');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ha-app/config.yaml');
    expect(result.stdout).toContain('does not match git tag (2.3.4)');
  });

  it('does not add semver validation to the source tag gate', () => {
    fixture.config('version: arbitrary\n');
    const extracted = fixture.run(extract, { matrix: { arch: 'amd64' } }, { ref: 'refs/tags/varbitrary' });
    expect(extracted.outputs.version).toBe('arbitrary');
    expect(checkVersion(extracted.outputs.version ?? '')).toMatchObject({ status: 0 });
  });
});
