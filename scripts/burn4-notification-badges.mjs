/**
 * Explicit-input attention policy and injected PWA badge delivery.
 * No application imports, storage, browser globals, ambient clock, or I/O.
 * Read state and complete per-viewer snapshots must come from the caller.
 */

/** @typedef {{id: string, role: 'parent'|'child'|'guest'}} BadgeViewer */
/** @typedef {{id: string, authorId: string, createdAtMs: number, expiresAtMs: number|null, readByViewer: boolean}} BadgeMessage */
/** @typedef {{id: string, choreId: string, completedAtMs: number, requiresApproval: boolean, approvedById: string|null, approvedAtMs: number|null}} BadgeCompletion */
/** @template T @typedef {{status: 'ready'|'unavailable', complete: boolean, forUserId: string, records: T[]}} BadgeSnapshot */
/** @typedef {{schemaVersion: 1, nowMs: number, viewer: BadgeViewer|null, mode: 'normal'|'away'|'babysitter', messages?: BadgeSnapshot<BadgeMessage>, completions?: BadgeSnapshot<BadgeCompletion>}} BadgeInput */
/** @typedef {{code: string, path: string}} BadgeDiagnostic */
/** @typedef {{unapprovedChores: number, unreadMessages: number, total: number}} BadgeCounts */
/** @typedef {{readiness: 'exact'|'unknown'|'suppressed', ownerId: string|null, counts: BadgeCounts|null, diagnostics: BadgeDiagnostic[]}} BadgePlan */
/** @typedef {{kind: 'exact'|'unknown'|'hidden', count: number|null, reason: string}} BadgeFallback */
/** @typedef {{setAppBadge?: (count: number) => void|Promise<void>, clearAppBadge?: () => void|Promise<void>, renderFallback: (state: BadgeFallback) => void}} BadgePorts */
/** @typedef {{initialApplied?: {ownerId: string|null, count: number}}} BadgeControllerOptions */
/** @typedef {{status: 'applied'|'fallback'|'held'|'superseded'|'disposed', diagnostics: BadgeDiagnostic[]}} BadgeControllerResult */
/** @typedef {{id: string, signature: string, counts: boolean}} Candidate */
/** @typedef {{count: number|null, diagnostics: BadgeDiagnostic[]}} SourceCount */
/** @typedef {{plan: BadgePlan, processed: boolean, settled: boolean, diagnostics: BadgeDiagnostic[], resolve: (result: BadgeControllerResult) => void}} Job */

export const BADGE_LIMITS = Object.freeze({ recordsPerSource: 10_000, idLength: 256 });

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is string} */
function id(value) {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= BADGE_LIMITS.idLength && value.trim().length > 0;
}

/** @param {unknown} value @returns {value is number} */
function time(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** @param {string} code @param {string} path @returns {BadgeDiagnostic} */
function diagnostic(code, path) { return { code, path }; }

/** @param {string} code @param {string} path @returns {SourceCount} */
function unknownSource(code, path) { return { count: null, diagnostics: [diagnostic(code, path)] }; }

/**
 * @param {unknown} source
 * @param {string} ownerId
 * @param {'messages'|'completions'} kind
 * @param {(row: Record<string, unknown>) => Candidate|null} normalize
 * @returns {SourceCount}
 */
function countSnapshot(source, ownerId, kind, normalize) {
  if (!object(source)) return unknownSource('source-unavailable', kind);
  if (source.forUserId !== ownerId) return unknownSource('source-owner-mismatch', kind);
  if (source.status === 'unavailable') return unknownSource('source-unavailable', kind);
  if (source.status !== 'ready' || typeof source.complete !== 'boolean') {
    return unknownSource('source-invalid', kind);
  }
  if (!source.complete) return unknownSource('source-incomplete', kind);
  if (!Array.isArray(source.records)) return unknownSource('source-invalid', `${kind}.records`);
  if (source.records.length > BADGE_LIMITS.recordsPerSource) {
    return unknownSource('source-limit', `${kind}.records`);
  }
  /** @type {unknown[]} */
  const records = source.records;
  /** @type {Map<string, Candidate>} */
  const seen = new Map();
  let count = 0;
  for (let index = 0; index < records.length; index += 1) {
    const row = records[index];
    const candidate = object(row) ? normalize(row) : null;
    if (!candidate) return unknownSource('record-invalid', `${kind}.records[${index}]`);
    const previous = seen.get(candidate.id);
    if (previous && previous.signature !== candidate.signature) {
      return unknownSource('duplicate-conflict', `${kind}.records[${index}]`);
    }
    if (!previous) {
      seen.set(candidate.id, candidate);
      if (candidate.counts) count += 1;
    }
  }
  return { count, diagnostics: [] };
}

/**
 * Calculate attention from bounded, complete caller snapshots.
 * Proposed policy: parent approvals only; self-authored messages are not unread attention.
 * @param {unknown} input
 * @returns {BadgePlan}
 */
function planInput(input) {
  /** @param {string} path @returns {BadgePlan} */
  const invalid = (path) => ({
    readiness: 'suppressed', ownerId: null, counts: null,
    diagnostics: [diagnostic('context-invalid', path)],
  });
  if (!object(input)) return invalid('input');
  if (input.schemaVersion !== 1) return invalid('schemaVersion');
  if (!time(input.nowMs)) return invalid('nowMs');
  if (input.mode !== 'normal' && input.mode !== 'away' && input.mode !== 'babysitter') return invalid('mode');
  const viewer = input.viewer;
  if (viewer !== null && (!object(viewer) || !id(viewer.id) ||
      (viewer.role !== 'parent' && viewer.role !== 'child' && viewer.role !== 'guest'))) {
    return invalid('viewer');
  }
  if (viewer === null || !object(viewer) || viewer.role === 'guest' || input.mode !== 'normal') {
    return {
      readiness: 'suppressed', ownerId: null, counts: null,
      diagnostics: [diagnostic('visibility-suppressed', 'viewer')],
    };
  }
  // The viewer ID was validated above; keep narrowing local to this boundary.
  if (!id(viewer.id)) return invalid('viewer');
  const ownerId = viewer.id;
  const nowMs = input.nowMs;
  const messages = countSnapshot(input.messages, ownerId, 'messages', (row) => {
    if (!id(row.id) || !id(row.authorId) || !time(row.createdAtMs) ||
        !(row.expiresAtMs === null || time(row.expiresAtMs)) ||
        typeof row.readByViewer !== 'boolean') return null;
    return {
      id: row.id,
      signature: JSON.stringify([row.authorId, row.createdAtMs, row.expiresAtMs, row.readByViewer]),
      counts: row.authorId !== ownerId && !row.readByViewer && row.createdAtMs <= nowMs &&
        (row.expiresAtMs === null || row.expiresAtMs > nowMs),
    };
  });
  const completions = viewer.role === 'parent'
    ? countSnapshot(input.completions, ownerId, 'completions', (row) => {
      if (!id(row.id) || !id(row.choreId) || !time(row.completedAtMs) ||
          typeof row.requiresApproval !== 'boolean' ||
          !(row.approvedById === null || id(row.approvedById)) ||
          !(row.approvedAtMs === null || time(row.approvedAtMs))) return null;
      return {
        id: row.id,
        signature: JSON.stringify([row.choreId, row.completedAtMs, row.requiresApproval, row.approvedById, row.approvedAtMs]),
        counts: row.requiresApproval && row.completedAtMs <= nowMs &&
          row.approvedById === null && row.approvedAtMs === null,
      };
    })
    : { count: 0, diagnostics: [] };
  if (messages.count === null || completions.count === null) {
    return {
      readiness: 'unknown', ownerId, counts: null,
      diagnostics: [...messages.diagnostics, ...completions.diagnostics],
    };
  }
  return {
    readiness: 'exact', ownerId,
    counts: {
      unapprovedChores: completions.count,
      unreadMessages: messages.count,
      total: completions.count + messages.count,
    },
    diagnostics: [],
  };
}

/**
 * Keep unknown-input accessors/proxies from escaping the public boundary.
 * Failed inspection cannot establish ownership, so hide and clear conservatively.
 * @param {unknown} input
 * @returns {BadgePlan}
 */
export function planNotificationBadges(input) {
  try { return planInput(input); }
  catch {
    return {
      readiness: 'suppressed', ownerId: null, counts: null,
      diagnostics: [diagnostic('context-invalid', 'input')],
    };
  }
}

/** @param {BadgePlan} plan @param {string} reason @returns {BadgeFallback} */
function fallback(plan, reason) {
  if (plan.readiness === 'suppressed') return { kind: 'hidden', count: null, reason };
  if (plan.readiness === 'unknown') return { kind: 'unknown', count: null, reason };
  return { kind: 'exact', count: plan.counts?.total ?? null, reason };
}

/**
 * Inject bound host methods. Native effects are serialized and obsolete queued
 * work is skipped. In-flight calls cannot be canceled; corrections follow their
 * settlement. renderFallback is synchronous and may reenter update or dispose.
 * @param {BadgePorts} ports
 * @param {BadgeControllerOptions} [options]
 * @returns {{update: (input: unknown) => Promise<BadgeControllerResult>, dispose: () => Promise<BadgeControllerResult>}}
 */
export function createNotificationBadgeController(ports, options = {}) {
  if (!ports || typeof ports.renderFallback !== 'function') {
    throw new TypeError('renderFallback must be a function');
  }
  if ((ports.setAppBadge !== undefined && typeof ports.setAppBadge !== 'function') ||
      (ports.clearAppBadge !== undefined && typeof ports.clearAppBadge !== 'function')) {
    throw new TypeError('Badge ports must be functions');
  }
  const setBadge = ports.setAppBadge;
  const clearBadge = ports.clearAppBadge;
  const renderFallback = ports.renderFallback;
  const initial = options.initialApplied;
  if (initial && (!(initial.ownerId === null || id(initial.ownerId)) ||
      !time(initial.count) || initial.count > BADGE_LIMITS.recordsPerSource * 2)) {
    throw new TypeError('initialApplied is invalid');
  }
  /** @type {{ownerId: string|null, count: number}|null} */
  let applied = initial ? { ...initial } : null;
  /** @type {Job|null} */
  let current = null;
  /** @type {Promise<void>|null} */
  let worker = null;
  let disposed = false;
  let cleanupStarted = false;
  /** @type {Promise<BadgeControllerResult>|null} */
  let disposal = null;
  /** @type {((result: BadgeControllerResult) => void)|null} */
  let finishDisposal = null;
  /** @type {BadgeDiagnostic[]} */
  const disposalDiagnostics = [];

  /** @param {Job} job @returns {boolean} */
  function newest(job) { return !disposed && current === job; }

  /** @param {Job} job @param {BadgeControllerResult['status']} status */
  function settle(job, status) {
    if (job.settled) return;
    job.settled = true;
    job.resolve({ status, diagnostics: [...job.plan.diagnostics, ...job.diagnostics] });
  }

  /** @param {Job} job @param {BadgeFallback} state */
  function publish(job, state) {
    if (!newest(job)) return;
    try { renderFallback(state); }
    catch { job.diagnostics.push(diagnostic('fallback-render-failed', 'ports.renderFallback')); }
  }

  /** @param {Job} job @param {'set'|'clear'} operation @param {number} [count] @returns {Promise<boolean>} */
  async function native(job, operation, count = 0) {
    if (!newest(job)) return false;
    try {
      if (operation === 'set' && setBadge) await setBadge(count);
      else if (operation === 'clear' && clearBadge) await clearBadge();
      else return false;
      // Record the actual effect even if a newer update arrived while awaiting.
      applied = { ownerId: job.plan.ownerId, count: operation === 'set' ? count : 0 };
      return true;
    } catch {
      applied = null;
      job.diagnostics.push(diagnostic(`native-${operation}-failed`, `ports.${operation}AppBadge`));
      publish(job, fallback(job.plan, `native-${operation}-failed`));
      return false;
    }
  }

  /** @param {Job} job @returns {Promise<BadgeControllerResult['status']>} */
  async function reconcile(job) {
    const plan = job.plan;
    if (plan.readiness === 'suppressed') {
      if (clearBadge && (applied === null || applied.count !== 0)) {
        return await native(job, 'clear') ? 'applied' : 'fallback';
      }
      return clearBadge ? 'applied' : 'fallback';
    }
    if (!setBadge || !clearBadge) {
      if (clearBadge && (applied === null || applied.ownerId !== plan.ownerId)) {
        await native(job, 'clear');
      }
      publish(job, fallback(plan, 'native-unsupported'));
      return 'fallback';
    }
    if (plan.readiness === 'unknown') {
      if (applied !== null && applied.ownerId === plan.ownerId) return 'held';
      if (!await native(job, 'clear')) return 'fallback';
      return 'held';
    }
    if (applied === null || applied.ownerId !== plan.ownerId) {
      if (!await native(job, 'clear')) return 'fallback';
      if (!newest(job)) return 'superseded';
    }
    const count = plan.counts?.total ?? 0;
    if (applied === null || applied.count !== count) {
      if (!await native(job, count === 0 ? 'clear' : 'set', count)) return 'fallback';
    }
    publish(job, { kind: 'hidden', count: null, reason: 'native-applied' });
    return 'applied';
  }

  async function drain() {
    while (true) {
      if (disposed) {
        if (!cleanupStarted) {
          cleanupStarted = true;
          if (clearBadge) {
            try { await clearBadge(); applied = { ownerId: null, count: 0 }; }
            catch { disposalDiagnostics.push(diagnostic('native-clear-failed', 'ports.clearAppBadge')); }
          }
          finishDisposal?.({ status: 'disposed', diagnostics: [...disposalDiagnostics] });
        }
        return;
      }
      const job = current;
      if (!job || job.processed) return;
      job.processed = true;
      const status = await reconcile(job);
      settle(job, newest(job) ? status : 'superseded');
    }
  }

  function schedule() {
    if (worker) return;
    // Defer host effects until after the immediate fallback callback, including
    // any update/dispose reentry, has returned.
    worker = Promise.resolve().then(drain).finally(() => {
      worker = null;
      if ((disposed && !cleanupStarted) || (!disposed && current && !current.processed)) schedule();
    });
  }

  /** @param {unknown} input @returns {Promise<BadgeControllerResult>} */
  function update(input) {
    if (disposed) return Promise.resolve({ status: 'disposed', diagnostics: [] });
    const plan = planNotificationBadges(input);
    if (current) settle(current, 'superseded');
    /** @type {Job} */
    let job;
    /** @type {Promise<BadgeControllerResult>} */
    const promise = new Promise((resolve) => {
      job = { plan, processed: false, settled: false, diagnostics: [], resolve };
      current = job;
    });
    // Promise executors run synchronously, so current is installed before render.
    if (current) publish(current, fallback(plan, 'pending'));
    schedule();
    return promise;
  }

  /** @returns {Promise<BadgeControllerResult>} */
  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    disposal = new Promise((resolve) => { finishDisposal = resolve; });
    if (current) settle(current, 'disposed');
    current = null;
    try { renderFallback({ kind: 'hidden', count: null, reason: 'disposed' }); }
    catch { disposalDiagnostics.push(diagnostic('fallback-render-failed', 'ports.renderFallback')); }
    schedule();
    return disposal;
  }

  return { update, dispose };
}
