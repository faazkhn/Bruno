/**
 * Exceptions (PRD §12): group the rule's differences by a single trigger-time fact, rank by lift,
 * suggest "NOT group" when it explains >= 50% of "rule would act" differences and raises F1.
 * Everything here is computed on the LEARNING period: the holdout is only ever used for the
 * re-proof, so the reported holdout numbers stay an unbiased test (review 2026-11-22).
 */
import { evalJql, toJql, type Expr } from './jql';
import { buildExamples, scoreClauses, type Example } from './learner';
import { SET_FIELDS, toSet } from './model';
import { splitOf, verdictOf, type Analysis, type Chore } from './pipeline';
import { replay } from './replay';
import type { IssueRecord } from './model';
import type { Settings } from './settings';
import { descriptionAt } from './snapshot';
import { tokenize } from './text';

export interface ExceptionGroup {
  outcome: 'FP' | 'FN';
  clause: Expr;
  /** differences of this outcome in the group / of all differences of this outcome */
  differences: number;
  ofDifferences: number;
  lift: number;
  caseKeys: string[];
  /** item ids, parallel to caseKeys (permission checks are by id) */
  caseIds: string[];
}
export interface Suggestion { clause: Expr; share: number; lift: number; learnF1Before: number; learnF1After: number }

const MIN_GROUP = 2;
const TOP = 5;

function factsOf(ex: Example): Expr[] {
  const out: Expr[] = [];
  for (const [field, v] of Object.entries(ex.snap)) {
    if (field === 'summary' || field === 'resolution') continue;
    if (v === null) out.push({ op: 'empty', field });
    else if (SET_FIELDS.has(field)) toSet(v).forEach((m) => out.push({ op: 'eq', field, value: m }));
    else out.push({ op: 'eq', field, value: v });
  }
  for (const t of tokenize(ex.snap.summary ?? '')) out.push({ op: 'contains', field: 'summary', value: t });
  return out;
}

export function findExceptions(chore: Chore, issues: IssueRecord[], window: Analysis['window'], s: Settings): { period: { from: number; to: number }; groups: ExceptionGroup[]; suggestion?: Suggestion } {
  const { learn } = splitOf(window);
  const W = s.windowHours * 3_600_000;
  const examples = buildExamples(issues, chore.trigger, chore.action, learn, W);
  const fires = (e: Example) => chore.clauses.map((c) => evalJql(c, e.snap, { description: descriptionAt(e.issue, e.event.ts) }));
  const rows = examples
    .map((e) => ({ e, r: fires(e) }))
    .filter(({ r }) => !r.includes('unknown'))
    .map(({ e, r }) => ({ e, fired: r.every((x) => x === true), facts: new Map(factsOf(e).map((f) => [toJql(f), f])) }));

  const groups: ExceptionGroup[] = [];
  for (const outcome of ['FP', 'FN'] as const) {
    const base = rows.filter((x) => x.fired === (outcome === 'FP'));
    const diffs = base.filter((x) => x.e.positive === (outcome === 'FN'));
    const isDiff = new Set(diffs);
    if (!diffs.length) continue;
    const counts = new Map<string, { clause: Expr; d: number; b: number; keys: string[]; ids: string[] }>();
    for (const x of base) {
      for (const [k, clause] of x.facts) {
        const g = counts.get(k) ?? { clause, d: 0, b: 0, keys: [], ids: [] };
        g.b++;
        if (isDiff.has(x)) { g.d++; g.keys.push(x.e.issue.key); g.ids.push(x.e.issue.id); }
        counts.set(k, g);
      }
    }
    const ranked = [...counts.entries()]
      .filter(([, g]) => g.d >= MIN_GROUP)
      .map(([k, g]) => ({ k, g, lift: g.d / diffs.length / (g.b / base.length) }))
      .filter((x) => x.lift > 1)
      .sort((a, b) => b.g.d - a.g.d || b.lift - a.lift || a.k.localeCompare(b.k))
      .slice(0, TOP);
    for (const { g, lift } of ranked) groups.push({ outcome, clause: g.clause, differences: g.d, ofDifferences: diffs.length, lift, caseKeys: g.keys, caseIds: g.ids });
  }

  const top = groups.find((g) => g.outcome === 'FP');
  const period = learn;
  if (!top || top.differences / top.ofDifferences < 0.5) return { period, groups };
  const learnEx = examples;
  const clause: Expr = { op: 'not', arg: top.clause };
  const before = scoreClauses(learnEx, chore.clauses).f1;
  const after = scoreClauses(learnEx, [...chore.clauses, clause]).f1;
  if (after <= before) return { period, groups };
  return { period, groups, suggestion: { clause, share: top.differences / top.ofDifferences, lift: top.lift, learnF1Before: before, learnF1After: after } };
}

export function applyExclusion(chore: Chore, clause: Expr, issues: IssueRecord[], window: Analysis['window'], s: Settings): Chore {
  const { learn, holdout } = splitOf(window);
  const W = s.windowHours * 3_600_000;
  const clauses = [...chore.clauses, clause];
  const proof = replay(clauses, chore.trigger, chore.action, issues, holdout, W);
  const learnEx = buildExamples(issues, chore.trigger, chore.action, learn, W);
  return {
    ...chore,
    version: chore.version + 1,
    note: 'exclusion learned on the learning period; holdout untouched until this re-proof',
    clauses,
    learn: { ...scoreClauses(learnEx, clauses), examples: learnEx.length },
    proof,
    verdict: verdictOf(proof, s, chore.risk),
    perMonth: (proof.tp / Math.max(1, (window.end - window.cut) / 86_400_000)) * 30,
  };
}
