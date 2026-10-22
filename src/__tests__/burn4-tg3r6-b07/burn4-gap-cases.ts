import { replies, runStep } from './burn4-workflow-harness';

export const gaps = [
  {
    name: 'KNOWN GAP: fresh-install health polling exits successfully after all thirty requests fail',
    assertDesiredBehavior(): void {
      const result = runStep('install', 'Wait for services', {
        curl: replies(30, { code: 7 }), sleep: replies(31, {}),
      });
      expect(result.calls.filter(call => call.command === 'curl')).toHaveLength(30);
      expect(result.calls.filter(call => call.command === 'sleep')).toHaveLength(31);
      expect(result.stdout).not.toContain('Health check passed!');
      expect(result.status).not.toBe(0);
    },
  },
  {
    name: 'KNOWN GAP: fresh-install container checks accept similarly named containers instead of required identities',
    assertDesiredBehavior(): void {
      const required = ['prism-app', 'prism-db', 'prism-redis'];
      const results = required.map(decoy => {
        const stdout = required.map(name => `fake image Up 1 second ${name === decoy ? `${name}-unrelated` : name}`).join('\n');
        const result = runStep('install', 'Verify containers', { docker: replies(4, { stdout }) });
        expect(result.calls).toHaveLength(4);
        return result.status;
      });
      expect(results).toEqual([1, 1, 1]);
    },
  },
];
