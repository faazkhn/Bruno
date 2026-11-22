/**
 * Test A check: does the backward rebuild agree with forward data?
 * For each field event e, the value rebuilt just after e (by undoing every later
 * event from current values) must equal e.to. That compares two independent
 * sources (later `from`s / current value vs this `to`), so it is not circular.
 * Delta fields (components, fix versions) derive both sides from one source, so
 * they are scored by the anomalies seen while normalising them instead.
 */
import type { IssueRecord } from './model';
import { snapshotAfter } from './snapshot';

const DELTA = new Set(['components', 'fixVersions']);

export interface Miss { key: string; field: string; seq: number; expected: string | null; rebuilt: string | null }
export interface ReconstructionResult {
  checks: number;
  agree: number;
  misses: Miss[];
  byField: Record<string, { checks: number; agree: number }>;
}

export function reconstructionCheck(issue: IssueRecord): ReconstructionResult {
  const r: ReconstructionResult = { checks: 0, agree: 0, misses: [], byField: {} };
  const tally = (field: string, ok: boolean, n = 1) => {
    const b = (r.byField[field] ??= { checks: 0, agree: 0 });
    b.checks += n;
    r.checks += n;
    if (ok) { b.agree += n; r.agree += n; }
  };
  const fieldEvents = issue.events.filter((e) => e.kind === 'field' && e.field);
  fieldEvents.forEach((e) => {
    const field = e.field!;
    if (DELTA.has(field)) return tally(field, true);
    const rebuilt = snapshotAfter(issue, e)[field] ?? null;
    const expected = e.to ?? null;
    const ok = rebuilt === expected;
    tally(field, ok);
    if (!ok) r.misses.push({ key: issue.key, field, seq: e.seq, expected, rebuilt });
  });
  for (const [field, n] of Object.entries(issue.anomalies)) {
    tally(field, false, n);
    r.misses.push({ key: issue.key, field, seq: -1, expected: null, rebuilt: `${n} delta anomalies` });
  }
  return r;
}
