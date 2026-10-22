import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export type Site = { site_name: string; site_description: string; site_url: string };
export type Page = Record<string, unknown> | null;
export type Input = { config: Site; page?: Page };
export type Schema = { data: Record<string, unknown> | null; error: string | null };
export type Rendered = { meta: Record<string, string | null>[]; schemas: Schema[] };
export type Batch = {
  engine: { jinjaVersion: string; autoescape: boolean; undefined: string };
  renders: Rendered[];
};

export function site(overrides: Partial<Site> = {}): Site {
  return {
    site_name: 'Fixture handbook',
    site_description: 'A synthetic documentation description.',
    site_url: 'https://docs.invalid/handbook/',
    ...overrides,
  };
}

export function page(overrides: Record<string, unknown> = {}): Page {
  return {
    title: 'Fixture page',
    meta: { description: 'Synthetic page description.' },
    canonical_url: 'https://docs.invalid/handbook/fixture/',
    ...overrides,
  };
}

/** Python gets no inherited environment, no shell and no network input. */
export function renderMany(inputs: Input[]): Batch {
  const run = spawnSync('/usr/bin/python3', ['-I', '-B', resolve(__dirname, 'burn4-render.py')], {
    env: {},
    cwd: resolve(__dirname, '../../..'),
    encoding: 'utf8',
    input: JSON.stringify({ renders: inputs }),
    timeout: 5_000,
    maxBuffer: 1_000_000,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error(`Offline Jinja fixture failed. Python 3 and Jinja2 are required. ${run.stderr}`);
  }
  return JSON.parse(run.stdout) as Batch;
}

export function render(config: Site = site(), currentPage: Page = page()): Rendered {
  return renderMany([{ config, page: currentPage }]).renders[0]!;
}

export function meta(output: Rendered, key: string): string | null {
  const matches = output.meta.filter((entry) => entry.name === key || entry.property === key);
  expect(matches).toHaveLength(1);
  return matches[0]!.content ?? null;
}

export function schema(output: Rendered): Record<string, unknown> {
  expect(output.schemas).toHaveLength(1);
  const entry = output.schemas[0]!;
  expect(entry.error).toBeNull();
  expect(entry.data).not.toBeNull();
  return entry.data!;
}
