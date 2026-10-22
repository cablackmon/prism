import { assertSettingsSection, subsectionCases } from './burn4-visual-gap-cases';

// Explicit-only ordinary reproduction of the same six intended assertions.
for (const entry of subsectionCases) {
  test(
    `KNOWN GAP inverse: ${entry.name} must select its intended settings query section`,
    () => assertSettingsSection(entry),
  );
}
