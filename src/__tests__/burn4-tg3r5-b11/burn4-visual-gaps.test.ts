import { assertSettingsSection, subsectionCases } from './burn4-visual-gap-cases';

for (const entry of subsectionCases) {
  test.failing(
    `KNOWN GAP: ${entry.name} screenshot does not select its intended settings query section`,
    () => assertSettingsSection(entry),
  );
}
