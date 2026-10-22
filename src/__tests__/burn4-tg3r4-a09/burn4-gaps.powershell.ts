import { cleanup, fixture } from './burn4-fixture';

afterEach(cleanup);

describe('Alexa documented false success', () => {
  test.failing('KNOWN GAP: native ask deployment failure returns a successful script exit', () => {
    const project = fixture();
    const result = project.run({ nativeStatus: 17 });
    expect(project.read('native-args.txt').trim().split('\n')).toEqual(['deploy', '--target', 'skill', '--target', 'model']);
    expect(project.read('native-cwd.txt').trim()).toBe(project.path('alexa/.deploy'));
    expect(project.exists('alexa/.deploy/skill.json')).toBe(true);
    expect(result.trace).toBeNull();
    expect(result.status).not.toBe(0);
  });
});
