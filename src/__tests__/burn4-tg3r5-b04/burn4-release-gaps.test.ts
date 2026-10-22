import { createRequire } from 'node:module';
import { stepsFor, WorkflowFixture, type Step } from './burn4-workflow-harness';

// Use the existing toolchain parser as an independent check that these are valid YAML strings.
const yaml = createRequire(__filename)('js-yaml') as { load: (text: string) => unknown };
const verify = stepsFor('release')[1] as Step;
let fixture: WorkflowFixture;
beforeEach(() => { fixture = new WorkflowFixture(); });
afterEach(() => { fixture.dispose(); });

test.failing.each([
  ['CRLF line endings', 'name: Synthetic addon\r\nversion: "2.3.4"\r\nslug: synthetic\r\n'],
  ['an indented root mapping', '  name: Synthetic addon\n  version: "2.3.4"\n  slug: synthetic\n'],
])('KNOWN GAP: release version parser rejects matching valid YAML with %s', (_name, config) => {
  expect(yaml.load(config)).toEqual({ name: 'Synthetic addon', version: '2.3.4', slug: 'synthetic' });
  fixture.config(config);
  const result = fixture.run(verify, { steps: { ver: { outputs: { version: '2.3.4' } } } });
  expect(result.stderr).toBe('');
  expect(result.commands).toEqual([]);
  // Intended behavior: a matching valid config passes the version gate.
  expect(result.status).toBe(0);
});
