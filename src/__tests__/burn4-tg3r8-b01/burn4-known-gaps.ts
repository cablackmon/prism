import assert from 'node:assert/strict';
import { prepared, ScenarioHarness, type Source } from './burn4-harness';

export class DesiredContractFailure extends Error {
  readonly name = 'DesiredContractFailure';
}

export interface GapCase {
  id: string;
  source: Source;
  message: string;
  assertDesired: () => Promise<void>;
}

async function requireRejectedMutation(
  source: Source,
  scenario: string,
  message: string,
  staleOverlay?: 'away' | 'babysitter',
): Promise<void> {
  const harness = await prepared(source);
  if (staleOverlay === 'away') harness.away = true;
  if (staleOverlay === 'babysitter') harness.babysitter = true;
  harness.plans.POST.push({ ok: false, body: { enabled: false } });
  let rejected = false;
  try {
    await harness.scenario(scenario);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new DesiredContractFailure(message);
}

function setupCleanupGap(source: Source, discovery: string): GapCase {
  const id = `setup-page-cleanup:${source}:${discovery}`;
  const message = `KNOWN GAP ${id}: close the temporary page after failed discovery`;
  return {
    id,
    source,
    message,
    assertDesired: async () => {
      const harness = new ScenarioHarness(source);
      const failure = new Error('synthetic member discovery failed');
      harness.failures.set(discovery, failure);
      let observed: unknown;
      try {
        await harness.hook('beforeAll');
      } catch (error) {
        observed = error;
      }
      assert.equal(observed, failure, 'the intended discovery error must be reached');
      if (!harness.closedPages.includes(harness.setupPage)) {
        throw new DesiredContractFailure(message);
      }
    },
  };
}

export const gaps: GapCase[] = [
  ...([
    ['away', 'away mode overlay appears when enabled'],
    ['babysitter', 'babysitter mode overlay appears when enabled'],
  ] as const).map(([mode, scenario]): GapCase => {
    const message = `KNOWN GAP overlay-mutation-status:${mode}: reject unsuccessful enable before trusting stale overlay`;
    return {
      id: `overlay-mutation-status:${mode}`,
      source: 'modes',
      message,
      assertDesired: () => requireRejectedMutation('modes', scenario, message, mode),
    };
  }),
  {
    id: 'disable-enable-precondition',
    source: 'modes',
    message: 'KNOWN GAP disable-enable-precondition: reject unsuccessful preliminary enable',
    assertDesired: async () => {
      await requireRejectedMutation(
        'modes',
        'away mode can be disabled via API',
        'KNOWN GAP disable-enable-precondition: reject unsuccessful preliminary enable',
      );
    },
  },
  {
    id: 'activation-verification-status',
    source: 'modes',
    message: 'KNOWN GAP activation-verification-status: reject unsuccessful verification GET',
    assertDesired: async () => {
      const harness = await prepared('modes');
      harness.plans.GET.push({ ok: false, body: { enabled: true } });
      let rejected = false;
      try {
        await harness.scenario('away mode can be activated via API');
      } catch {
        rejected = true;
      }
      if (!rejected) {
        throw new DesiredContractFailure(
          'KNOWN GAP activation-verification-status: reject unsuccessful verification GET',
        );
      }
    },
  },
  setupCleanupGap('modes', 'getFirstParent'),
  setupCleanupGap('settings', 'getFirstParent'),
  setupCleanupGap('settings', 'getFamilyMembers'),
];

/** A wrong failure must make Jest's expected-failure wrapper fail as well. */
export async function expectedGap(gap: GapCase): Promise<void> {
  try {
    await gap.assertDesired();
  } catch (error) {
    if (error instanceof DesiredContractFailure && error.message === gap.message) throw error;
  }
}
