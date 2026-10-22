import { Harness, Options, SyntheticSkip } from './burn4-harness';

const scenarios = [
  'wishes page loads and shows Gift Ideas tab',
  'switch to Gift Ideas tab renders content',
  'per-person columns render for other family members',
  'gift ideas API returns expected shape',
  'create and delete a gift idea via API',
  'cannot create gift idea for yourself',
  'privacy: only own ideas returned from API',
];

describe('Gift ideas original callbacks', () => {
  test.each(scenarios)('%s exercises independent synthetic state', async (name) => {
    const h = new Harness('gift-ideas');
    await h.hook('beforeAll');
    expect(h.pages[1]?.closed).toBe(true);
    await h.run(name);
    expect(h.page.actor).toBe('');
    expect(h.ideas.size).toBe(0);
    expect(h.events).toContain('login:adult-a');
    if (name === scenarios[1] || name === scenarios[2]) expect(h.page.giftContent).toBe(true);
    if (name === scenarios[4]) {
      expect(h.calls.find((call) => call.method === 'POST')?.data?.forUserId).toBe('child-a');
      expect(h.calls.some((call) => call.method === 'DELETE' && call.actor === 'adult-a')).toBe(true);
    }
    if (name === scenarios[6]) {
      expect(h.calls.filter((call) => call.method === 'GET').map((call) => call.actor)).toEqual(['adult-a', 'child-a']);
      expect(h.events.filter((event) => event.startsWith('login:'))).toEqual(['login:adult-a', 'login:child-a', 'login:adult-a']);
    }
  });

  test.each([scenarios[2]!, scenarios[4]!, scenarios[6]!])('%s skips an unavailable target before mutation', async (name) => {
    const h = new Harness('gift-ideas', { members: [{ id: 'adult-a', name: 'Synthetic Parent', role: 'parent' }] });
    await h.ready();
    await expect(h.invoke(name)).rejects.toBeInstanceOf(SyntheticSkip);
    expect(h.calls).toEqual([]);
    expect(h.ideas.size).toBe(0);
  });

  const faults: [string, string, Options][] = [
    ['missing gift tab', scenarios[0]!, { giftTab: false }],
    ['missing person column', scenarios[2]!, { hiddenMember: true }],
    ['failed list status', scenarios[3]!, { reply: (_call, reply) => ({ ...reply, status: 500 }) }],
    ['missing ideas property', scenarios[3]!, { reply: (_call, reply) => ({ ...reply, body: {} }) }],
    ['non-array ideas', scenarios[3]!, { reply: (_call, reply) => ({ ...reply, body: { ideas: {} } }) }],
    ['failed create status', scenarios[4]!, { reply: (call, reply) => call.method === 'POST' ? { ...reply, status: 500 } : reply }],
    ['wrong create target', scenarios[4]!, { reply: (call, reply) => call.method === 'POST' ? { ...reply, body: { name: call.data?.name, forUserId: 'adult-a' } } : reply }],
    ['failed delete status', scenarios[4]!, { reply: (call, reply) => call.method === 'DELETE' ? { ...reply, status: 500 } : reply }],
    ['incorrect self rejection status', scenarios[5]!, { reply: (_call, reply) => ({ ...reply, status: 201 }) }],
    ['incorrect self rejection reason', scenarios[5]!, { reply: (_call, reply) => ({ ...reply, body: { error: 'Unrelated validation' } }) }],
    ['idea leaks to another account', scenarios[6]!, { leakIdeas: true }],
    ['own idea absent from parent listing', scenarios[6]!, { reply: (call, reply) => call.method === 'GET' ? { ...reply, body: { ideas: [] } } : reply }],
  ];
  test.each(faults)('%s is rejected by the source assertion', async (_label, name, options) => {
    const h = new Harness('gift-ideas', options);
    await h.ready();
    await expect(h.invoke(name)).rejects.toMatchObject({ matcherResult: expect.any(Object) });
  });

  test('privacy leak is rejected after observing the child session', async () => {
    const h = new Harness('gift-ideas', { leakIdeas: true });
    await h.ready();
    await expect(h.invoke(scenarios[6]!)).rejects.toMatchObject({ matcherResult: expect.any(Object) });
    expect(h.calls.filter((call) => call.method === 'GET').map((call) => call.actor)).toEqual(['adult-a', 'child-a']);
    expect(h.page.actor).toBe('child-a');
  });
});
