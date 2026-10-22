import { Harness, outcome, Repair, Spec } from './burn4-harness';

type Observation = { satisfied: boolean; exercised: boolean };
export type Gap = {
  name: string;
  source: string;
  exercise: (repair?: boolean) => Promise<Observation>;
};
const privacy = 'privacy: only own ideas returned from API';
function patches(before: string, after: string): Repair { return [{ before, after }]; }

export const gaps: Gap[] = [
  {
    name: 'Shopping progress scenario passes without any item to exercise',
    source: 'e2e/shopping.spec.ts:57',
    exercise: async (repair = false) => {
      const fix = patches('if (await items.count() > 0) {', "if (await items.count() === 0) test.skip(true, 'No exercise item');\n    if (await items.count() > 0) {");
      const h = new Harness('shopping', { noItems: true }, repair ? fix : []);
      await h.ready();
      const result = await outcome(h.invoke('checking an item updates progress'));
      return { satisfied: result !== 'passed', exercised: h.items.size === 0 && h.events.includes('goto:/shopping') };
    },
  },
  {
    name: 'Shopping mode scenario passes without its required entry control',
    source: 'e2e/shopping.spec.ts:82',
    exercise: async (repair = false) => {
      const before = 'if (await enterBtn.count() > 0 && await enterBtn.first().isVisible({ timeout: 3000 })) {';
      const h = new Harness('shopping', { modeEntry: false }, repair ? patches(before, `await expect(enterBtn.first()).toBeVisible();\n    ${before}`) : []);
      await h.ready();
      const result = await outcome(h.invoke('shopping mode can be entered and exited'));
      return { satisfied: result !== 'passed', exercised: h.events.includes('goto:/shopping') && h.options.modeEntry === false };
    },
  },
  {
    name: 'Gift content scenario passes after a no-op tab click',
    source: 'e2e/gift-ideas.spec.ts:40',
    exercise: async (repair = false) => {
      const fix = patches('await expect(giftIdeasTab).toBeVisible();', 'await expect(page.getByText(otherMember!.name).first()).toBeVisible();');
      const h = new Harness('gift-ideas', { noGiftContent: true }, repair ? fix : []);
      await h.ready();
      const result = await outcome(h.invoke('switch to Gift Ideas tab renders content'));
      return { satisfied: result !== 'passed', exercised: h.events.includes('click:giftTab') && !h.page.giftContent };
    },
  },
  {
    name: 'Gift privacy scenario passes without reading another account',
    source: 'e2e/gift-ideas.spec.ts:133',
    exercise: async (repair = false) => {
      const before = 'otherMember = members.find((m) => m.id !== parent.id) || null;';
      const h = new Harness('gift-ideas', { members: [
        { id: 'adult-a', name: 'Synthetic Parent', role: 'parent' },
        { id: 'adult-b', name: 'Synthetic Other', role: 'parent' },
      ] }, repair ? patches(before, `${before}\n    if (!child) child = otherMember;`) : []);
      await h.ready();
      const result = await outcome(h.invoke(privacy));
      return {
        satisfied: result !== 'passed' || h.calls.some((call) => call.method === 'GET' && call.actor !== 'adult-a'),
        exercised: h.calls.some((call) => call.method === 'POST') && h.calls.some((call) => call.method === 'GET' && call.actor === 'adult-a'),
      };
    },
  },
  {
    name: 'Shopping teardown forgets cleanup IDs after helpers return false',
    source: 'e2e/shopping-crud.spec.ts:28',
    exercise: async (repair = false) => {
      const fix = patches('await deleteShoppingItem(page, id);', "if (!await deleteShoppingItem(page, id)) throw new Error('Cleanup failed');");
      const h = new Harness('shopping-crud', { cleanupFalse: true }, repair ? fix : []);
      await h.ready();
      await h.invoke('add item via API and verify on page');
      await h.invoke('create a new shopping list');
      const first = await outcome(h.hook('afterEach'));
      const attempts = h.events.filter((event) => event.startsWith('cleanup:')).length;
      await h.hook('beforeEach');
      const second = await outcome(h.hook('afterEach'));
      const retried = h.events.filter((event) => event.startsWith('cleanup:')).length > attempts;
      return {
        satisfied: first === 'rejected' && (retried || second === 'rejected'),
        exercised: h.items.has('created-1') && h.lists.has('created-2') && attempts > 0,
      };
    },
  },
  {
    name: 'Gift privacy cleanup accepts a failed delete response',
    source: 'e2e/gift-ideas.spec.ts:148',
    exercise: async (repair = false) => {
      const fix = patches('\n    await page.request.delete(`/api/gift-ideas/${created.id}`);', '\n    expect((await page.request.delete(`/api/gift-ideas/${created.id}`)).ok()).toBeTruthy();');
      const h = new Harness('gift-ideas', { reply: (call, reply) => call.method === 'DELETE' ? { ...reply, status: 500 } : reply }, repair ? fix : []);
      await h.ready();
      const result = await outcome(h.invoke(privacy));
      return { satisfied: result === 'rejected', exercised: h.calls.some((call) => call.method === 'DELETE') };
    },
  },
  {
    name: 'Gift verification failure bypasses created-record cleanup',
    source: 'e2e/gift-ideas.spec.ts:90',
    exercise: async (repair = false) => {
      const before = `    expect(created.name).toBe(testName);
    expect(created.forUserId).toBe(otherMember!.id);

    // Delete
    const deleteRes = await page.request.delete(\x60/api/gift-ideas/\x24{created.id}\x60);
    expect(deleteRes.ok()).toBeTruthy();`;
      const after = `    try {
      expect(created.name).toBe(testName);
      expect(created.forUserId).toBe(otherMember!.id);
    } finally {
      const deleteRes = await page.request.delete(\x60/api/gift-ideas/\x24{created.id}\x60);
      expect(deleteRes.ok()).toBeTruthy();
    }`;
      const h = new Harness('gift-ideas', { reply: (call, reply) => call.method === 'POST' ? { ...reply, body: { id: 'created-1', name: 'Wrong synthetic name', forUserId: 'child-a' } } : reply }, repair ? patches(before, after) : []);
      await h.ready();
      const result = await outcome(h.invoke('create and delete a gift idea via API'));
      await h.hook('afterEach');
      return { satisfied: result === 'rejected' && h.ideas.size === 0, exercised: h.calls.some((call) => call.method === 'POST') && h.page.actor === '' };
    },
  },
  {
    name: 'Shopping cleanup rejection prevents remaining list cleanup and logout',
    source: 'e2e/shopping-crud.spec.ts:28',
    exercise: async (repair = false) => {
      const fix = patches('await deleteShoppingItem(page, id);', `try { await deleteShoppingItem(page, id); } catch (error) {
        for (const listId of createdListIds) { try { await deleteShoppingList(page, listId); } catch {} }
        await logout(page);
        throw error;
      }`);
      const h = new Harness('shopping-crud', { cleanupReject: true }, repair ? fix : []);
      await h.ready();
      await h.invoke('add item via API and verify on page');
      await h.invoke('create a new shopping list');
      const result = await outcome(h.hook('afterEach'));
      return {
        satisfied: result === 'rejected' && h.events.includes('cleanup:lists:created-2') && h.page.actor === '',
        exercised: h.events.includes('cleanup:items:created-1'),
      };
    },
  },
  ...(['shopping', 'shopping-crud', 'gift-ideas'] as Spec[]).map((spec): Gap => ({
    name: `${spec} setup leaks its page after roster discovery rejects`,
    source: `e2e/${spec}.spec.ts:9`,
    exercise: async (repair = false) => {
      const fix = patches('parent = await getFirstParent(page);', 'try { parent = await getFirstParent(page); } catch (error) { await page.close(); throw error; }');
      const h = new Harness(spec, { parentFailure: true }, repair ? fix : []);
      const result = await outcome(h.hook('beforeAll'));
      return { satisfied: result === 'rejected' && h.pages[1]?.closed === true, exercised: h.events.includes('roster:parent') && h.pages.length === 2 };
    },
  })),
];

export async function verifyGap(gap: Gap, repair = false): Promise<void> {
  const observed = await gap.exercise(repair);
  expect({ contract: gap.name, satisfied: observed.satisfied }).toEqual({ contract: gap.name, satisfied: true });
}
