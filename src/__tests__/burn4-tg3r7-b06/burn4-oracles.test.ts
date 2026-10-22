import { gaps } from './burn4-gaps';
import { loadSuite } from './burn4-harness';

// These in-memory repairs verify the desired contracts become ordinary passes.
// The repository source files are read only and the default suite uses them verbatim.
function repaired(text: string) {
  const common = text
    .replace('parent = await getFirstParent(page);', 'try { parent = await getFirstParent(page); } catch (error) { await page.close(); throw error; }')
    .replace('await deleteTaskByTitle(page, TEST_TITLE);\n    await deleteTaskByTitle(page, EDITED_TITLE);\n    await logout(page);', 'try { await deleteTaskByTitle(page, TEST_TITLE); } finally { await deleteTaskByTitle(page, EDITED_TITLE); await logout(page); }')
    .replace('await deleteMessageByContent(page, TEST_MSG);\n    await deleteMessageByContent(page, EDITED_MSG);\n    await logout(page);', 'try { await deleteMessageByContent(page, TEST_MSG); } finally { await deleteMessageByContent(page, EDITED_MSG); await logout(page); }')
    .replace('} catch {\n      // No child user\n    }', '} catch (error) { if ((error as Error).message !== "No child found") { await page.close(); throw error; } }')
    .replaceAll('const created = await createRes.json();', 'expect(createRes.ok()).toBeTruthy(); const created = await createRes.json();')
    .replaceAll('const msg = await createRes.json();', 'expect(createRes.ok()).toBeTruthy(); const msg = await createRes.json();');
  if (!text.includes("test.describe('Goals'")) return common;
  return common
    .replace('expect(created.goal).toBeTruthy();', 'try { expect(created.goal).toBeTruthy();')
    .replace('// Delete\n    const deleteRes', '} finally {\n    // Delete\n    const deleteRes')
    .replace("expect(deleteRes.ok()).toBeTruthy();\n  });", "expect(deleteRes.ok()).toBeTruthy();\n    }\n  });");
}

describe('Gap contracts and denied runtime boundaries', () => {
  test.each(gaps)('desired contract passes with an in-memory repair: $id', async gap => {
    await gap.assertDesired((source, options) => loadSuite(source, options, repaired));
  });

  test('VM cannot import original helpers through an unapproved spelling', () => {
    expect(() => loadSuite('goals.spec.ts', {}, text => `${text}\nrequire('./helpers/auth.ts');`)).toThrow('Denied import');
  });

  test('VM has no process, fetch or browser globals', () => {
    expect(() => loadSuite('goals.spec.ts', {}, text => `${text}\nif (typeof process !== 'undefined' || typeof fetch !== 'undefined' || typeof browser !== 'undefined') throw new Error('Unexpected host capability');`)).not.toThrow();
  });

  test('VM denies runtime string code generation', () => {
    expect(() => loadSuite('goals.spec.ts', {}, text => `${text}\nFunction('return 1')();`)).toThrow('Code generation from strings disallowed');
  });
});
