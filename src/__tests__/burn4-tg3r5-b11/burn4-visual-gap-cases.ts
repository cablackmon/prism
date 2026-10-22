import { scenarioCases, type ScenarioCase } from './burn4-visual-cases';
import { loadVisualHarness } from './burn4-visual-harness';

export const subsectionCases = scenarioCases.filter((entry) => entry.subsection);

export async function assertSettingsSection(entry: ScenarioCase): Promise<void> {
  const harness = loadVisualHarness();
  const page = await harness.run(entry.name);
  expect(page.routes).toHaveLength(1);
  expect(page.screenshots.map((capture) => capture.name)).toEqual([entry.snapshot]);
  const destination = new URL(page.routes[0] ?? '', 'https://burn4.invalid');
  expect(destination.pathname).toBe('/settings');
  // SettingsView reads the section query parameter. No hash precondition is asserted,
  // so a repaired navigation makes this intended assertion pass.
  expect(destination.searchParams.get('section')).toBe(entry.section);
}
