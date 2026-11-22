/** Holdout replay (PRD §12): walk trigger occurrences in order, evaluate the rule on the snapshot at that moment. */
import { performs, type Action } from './candidates';
import { evalJql, toJql, type Expr, type Truth } from './jql';
import type { Event, IssueRecord, Snapshot } from './model';
import type { Range } from './settings';
import { snapshotAfter } from './snapshot';
import { followingAction, isNoOp, triggerEvents, type Trigger } from './triggers';

export type Outcome = 'TP' | 'FP' | 'FN' | 'TN' | 'inconclusive';

export interface ProofCase {
  issueId: string;
  key: string;
  outcome: Exclude<Outcome, 'TN'>;
  /** 'no-trigger': a person did it but the trigger never happened before it within W */
  reason?: 'no-trigger';
  triggerTs: number | null;
  actionTs: number | null;
  clauses: { jql: string; value: Truth }[];
  snapshot: Snapshot;
}

export interface Proof {
  range: Range;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  inconclusive: number;
  precision: number;
  recall: number;
  coverage: number;
  /** every non-TN case, trigger cases in time order, then no-trigger differences */
  cases: ProofCase[];
}

export function replay(clauses: Expr[], trigger: Trigger, action: Action, issues: IssueRecord[], range: Range, windowMs: number): Proof {
  const counts = { TP: 0, FP: 0, FN: 0, TN: 0, inconclusive: 0 };
  const cases: ProofCase[] = [];
  const explained = new Set<Event>();

  for (const issue of issues) {
    for (const t of triggerEvents(issue, trigger)) {
      if (t.ts < range.from || t.ts >= range.to) continue;
      const snapshot = snapshotAfter(issue, t);
      if (isNoOp(snapshot, action)) continue;
      const ctx = { description: issue.text.description };
      const results = clauses.map((c) => ({ jql: toJql(c), value: evalJql(c, snapshot, ctx) }));
      const fires: Truth = results.some((r) => r.value === false) ? false : results.some((r) => r.value === 'unknown') ? 'unknown' : true;
      const human = followingAction(issue, t, action, windowMs);
      if (human) explained.add(human);
      const outcome: Outcome = fires === 'unknown' ? 'inconclusive' : fires ? (human ? 'TP' : 'FP') : human ? 'FN' : 'TN';
      counts[outcome]++;
      if (outcome !== 'TN') cases.push({ issueId: issue.id, key: issue.key, outcome, triggerTs: t.ts, actionTs: human?.ts ?? null, clauses: results, snapshot });
    }
  }
  cases.sort((a, b) => a.triggerTs! - b.triggerTs!);

  const uncovered: ProofCase[] = [];
  for (const issue of issues) {
    for (const e of issue.events) {
      if (e.ts < range.from || e.ts >= range.to || explained.has(e) || !performs(e, action)) continue;
      counts.FN++;
      uncovered.push({ issueId: issue.id, key: issue.key, outcome: 'FN', reason: 'no-trigger', triggerTs: null, actionTs: e.ts, clauses: [], snapshot: snapshotAfter(issue, { ...e, seq: e.seq - 1 }) });
    }
  }
  uncovered.sort((a, b) => a.actionTs! - b.actionTs!);

  const total = counts.TP + counts.FP + counts.FN + counts.TN + counts.inconclusive;
  return {
    range,
    tp: counts.TP,
    fp: counts.FP,
    fn: counts.FN,
    tn: counts.TN,
    inconclusive: counts.inconclusive,
    precision: counts.TP + counts.FP ? counts.TP / (counts.TP + counts.FP) : 0,
    recall: counts.TP + counts.FN ? counts.TP / (counts.TP + counts.FN) : 0,
    coverage: total ? (total - counts.inconclusive) / total : 0,
    cases: [...cases, ...uncovered],
  };
}
