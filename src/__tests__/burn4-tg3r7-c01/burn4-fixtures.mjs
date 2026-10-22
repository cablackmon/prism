import assert from 'node:assert/strict';
import { previewChores } from '../../../scripts/burn4-chore-anchor-preview.mjs';

/** @param {Record<string, unknown>} [changes] */
export function chore(changes = {}) {
  return { id: 'synthetic-a', title: 'Synthetic dishes', enabled: true, state: 'outstanding', nextDue: '2026-10-21', frequency: 'daily', noInterveningCompletion: true, ...changes };
}
/** @param {Record<string, unknown>} [changes] */
export function snapshot(changes = {}) {
  return { asOf: '2026-10-21', through: '2026-10-24', chores: [chore()], ...changes };
}
/** @param {unknown} value */
export function projected(value) {
  const result = previewChores(value).chores[0];
  assert.ok(result, 'Synthetic projection exists');
  return result;
}
/** @param {{missed:{date:string}[],current:{date:string}[],future:{date:string}[]}} row */
export function dates(row) { return [...row.missed, ...row.current, ...row.future].map(item => item.date); }
