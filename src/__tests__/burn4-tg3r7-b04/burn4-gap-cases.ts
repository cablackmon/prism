import assert from 'node:assert/strict';
import { fixtureChild, fixtureParent, loadSpec } from './burn4-harness';

export const gapCases: { name: string; verify(): Promise<void> }[] = [
  {
    name: 'KNOWN GAP: dashboard setup leaks its temporary page when family lookup rejects',
    async verify() {
      const spec = loadSpec('dashboard', { failAt: 'parent-lookup' });
      await assert.rejects(spec.hook('beforeAll'), (error) => error === spec.failure);
      assert.equal(spec.closed, true, 'GAP cleanup: temporary page must close after failed family lookup');
    },
  },
  {
    name: 'KNOWN GAP: sidebar destination regexes accept unrelated pathname suffixes',
    async verify() {
      const spec = loadSpec('dashboard', { destinations: { '/calendar': '/calendar-archive', '/tasks': '/tasks-archive', '/shopping': '/shopping-archive' } });
      let rejected = false;
      try { await spec.run('sidebar nav links navigate to correct pages'); } catch { rejected = true; }
      assert.equal(rejected, true, 'GAP sidebar route: wrong pathnames must reject the navigation check');
    },
  },
  {
    name: 'KNOWN GAP: direct-route regex accepts a different pathname with the same prefix',
    async verify() {
      const spec = loadSpec('dashboard', { destinations: { '/chores': '/chores-archive' } });
      let rejected = false;
      try { await spec.run('direct URL routing works for feature pages'); } catch { rejected = true; }
      assert.equal(rejected, true, 'GAP direct route: wrong pathname must reject the routing check');
    },
  },
  {
    name: 'KNOWN GAP: home-link regex accepts any non-home pathname ending in slash',
    async verify() {
      const spec = loadSpec('dashboard', { destinations: { '/': '/not-home/' } });
      let rejected = false;
      try { await spec.run('dashboard home link returns to dashboard'); } catch { rejected = true; }
      assert.equal(rejected, true, 'GAP home route: non-home pathname must reject the home-link check');
    },
  },
  ...['homepage loads', 'navigation sidebar is visible'].map((name) => ({
    name: `KNOWN GAP: ${name} accepts HTTP 500 with visible error-page landmarks`,
    async verify() {
      const spec = loadSpec('smoke', { navigationStatus: 500 });
      let rejected = false;
      try { await spec.run(name); } catch { rejected = true; }
      assert.equal(rejected, true, 'GAP HTTP navigation: an HTTP 500 document must fail homepage smoke');
    },
  })),
  {
    name: 'KNOWN GAP: mobile settings chooses a child before an available parent',
    async verify() {
      const spec = loadSpec('mobile-pwa-settings', { enabled: true, members: [fixtureChild, fixtureParent] });
      let callbackFailure: unknown;
      try { await spec.run('More menu exposes Settings, section selector switches sections'); } catch (error) { callbackFailure = error; }
      assert.equal(spec.sessionRole, 'parent', 'GAP mobile role: choose an available parent before verification');
      assert.equal(callbackFailure, undefined, 'Parent selection must allow the settings callback to finish');
      assert.equal(spec.currentPath, '/settings');
    },
  },
];
