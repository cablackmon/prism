import assert from 'node:assert/strict';
import { argsFor, fixture, indexPath, layout, submissionPath } from './burn4-workflow-harness';

// Recognize whether our literal harmless marker is active shell text. Single
// quotes or an escaped dollar sign must also let a future correct fix pass.
function activeExpansion(command: string, marker: string): boolean {
  let quote: 'single' | 'double' | undefined;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (char === '\\' && quote !== 'single') { i += 1; continue; }
    if (char === "'" && quote !== 'double') { quote = quote === 'single' ? undefined : 'single'; continue; }
    if (char === '"' && quote !== 'single') { quote = quote === 'double' ? undefined : 'double'; continue; }
    if (quote !== 'single' && command.startsWith(marker, i)) return true;
  }
  return false;
}

async function publishOrReject(f: ReturnType<typeof fixture>): Promise<void> {
  try { await f.run('publish'); }
  catch (error) {
    assert.match(String(error), /name|slug|collision|identifier|already exists/i,
      'only an explicit name, slug or collision rejection is accepted');
  }
  assert.ok(f.calls.some(call => call.name === `read:${submissionPath}`), 'must read the intended submission');
}

export const gaps = [
  {
    name: 'KNOWN GAP: layout names are embedded as active shell expansion in the git commit command',
    assertion: 'untrusted name must not remain active shell syntax',
    async check() {
      const marker = '$(printf fixture-expansion)';
      const f = fixture({ files: {
        [submissionPath]: JSON.stringify(layout({ name: `Fixture ${marker}` })),
        [indexPath]: '{"layouts":[]}',
      } });
      await publishOrReject(f);
      const command = argsFor(f, 'exec').map(args => String(args[0])).find(value => value.startsWith('git commit'));
      // No commit is also safe after an explicit rejection of the name.
      // This assertion inspects inert text only. It never executes shell expansion.
      assert.equal(command ? activeExpansion(command, marker) : false, false, 'untrusted name must not remain active shell syntax');
    },
  },
  {
    name: 'KNOWN GAP: a new submission overwrites an existing layout file with the same generated slug',
    assertion: 'existing layout content must survive a slug collision',
    async check() {
      const path = 'community/layouts/dashboard/fixture-board.json';
      const previous = JSON.stringify(layout({
        name: 'Fixture Board', description: 'Previous fixture content',
        widgets: [
          { i: 'clock', x: 0, y: 20, w: 8, h: 4 },
          { i: 'weather', x: 8, y: 20, w: 8, h: 4 },
          { i: 'calendar', x: 16, y: 20, w: 12, h: 8 },
        ],
      }));
      const f = fixture({ files: {
        [submissionPath]: JSON.stringify(layout({ name: 'Fixture--Board', description: 'New fixture content' })),
        [indexPath]: JSON.stringify({ layouts: [{ id: 'fixture-board', file: 'dashboard/fixture-board.json' }] }),
        [path]: previous,
      } });
      await publishOrReject(f);
      assert.ok(f.calls.some(call => call.name === `read:${indexPath}`), 'must read the collision index');
      assert.equal(f.files.get(path), previous, 'existing layout content must survive a slug collision');
    },
  },
  {
    name: 'KNOWN GAP: a nonempty non-ASCII layout name produces an empty identifier and dashboard/.json',
    assertion: 'accepted nonempty name must produce a nonempty identifier',
    async check() {
      const f = fixture({ files: {
        [submissionPath]: JSON.stringify(layout({ name: '家族' })), [indexPath]: '{"layouts":[]}',
      } });
      await publishOrReject(f);
      const index = JSON.parse(f.files.get(indexPath) ?? '') as { layouts: Array<{ id: string }> };
      assert.equal(f.files.has('community/layouts/dashboard/.json'), false,
        'accepted nonempty name must produce a nonempty identifier');
      assert.ok(index.layouts.every(entry => entry.id.length > 0),
        'accepted nonempty name must produce a nonempty identifier');
    },
  },
] as const;
