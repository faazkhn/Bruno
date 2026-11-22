/**
 * Condition learner (PRD §11.4): greedy conjunctive covering, <= maxClauses
 * clauses, F1 on the learn split, stop when gain < minGain; then each keyword /
 * equality clause may widen to an OR of values (decision 2026-11-22).
 * Clauses are JQL-subset expressions over trigger-time snapshots only.
 */
import type { Action } from './candidates';
import { evalJql, toJql, type Expr } from './jql';
import { SET_FIELDS, toSet, type Event, type IssueRecord, type Snapshot } from './model';
import type { Range, Settings } from './settings';
import { descriptionAt, snapshotAfter } from './snapshot';
import { tokenize } from './text';
import { followingAction, isNoOp, triggerEvents, type Trigger } from './triggers';

export interface Example {
  issue: IssueRecord;
  event: Event;
  snap: Snapshot;
  positive: boolean;
  actionEvent?: Event;
}

export interface LearnedRule { clauses: Expr[]; f1: number; precision: number; recall: number }

const NOT_FEATURES = new Set(['summary', 'resolution']);
const MAX_WIDEN = 5;

export function buildExamples(issues: IssueRecord[], trigger: Trigger, action: Action, range: Range, windowMs: number): Example[] {
  const out: Example[] = [];
  for (const issue of issues) {
    for (const event of triggerEvents(issue, trigger)) {
      if (event.ts < range.from || event.ts >= range.to) continue;
      const snap = snapshotAfter(issue, event);
      if (isNoOp(snap, action)) continue;
      const actionEvent = followingAction(issue, event, action, windowMs);
      out.push({ issue, event, snap, positive: !!actionEvent, actionEvent });
    }
  }
  return out;
}

/** Candidate clauses: facts true at trigger time on at least one positive example. */
export function candidateClauses(examples: Example[], vocab: Set<string>): Expr[] {
  const keys = new Map<string, Expr>();
  const add = (e: Expr) => keys.set(toJql(e), e);
  for (const ex of examples) {
    if (!ex.positive) continue;
    for (const [field, v] of Object.entries(ex.snap)) {
      if (NOT_FEATURES.has(field)) continue;
      if (v === null) add({ op: 'empty', field });
      else if (SET_FIELDS.has(field)) toSet(v).forEach((m) => add({ op: 'eq', field, value: m }));
      else add({ op: 'eq', field, value: v });
    }
    for (const t of tokenize(ex.snap.summary ?? '')) if (vocab.has(t)) add({ op: 'contains', field: 'summary', value: t });
    for (const t of tokenize(descriptionAt(ex.issue, ex.event.ts) ?? '')) if (vocab.has(t)) add({ op: 'contains', field: 'description', value: t });
  }
  return [...keys.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, e]) => e);
}

function score(mask: Uint8Array, labels: Uint8Array) {
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) { if (labels[i]) tp++; else fp++; }
    else if (labels[i]) fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
}

const and = (masks: Uint8Array[], n: number) => {
  const m = new Uint8Array(n).fill(1);
  for (const x of masks) for (let i = 0; i < n; i++) m[i]! &= x[i]!;
  return m;
};
const or = (a: Uint8Array, b: Uint8Array) => a.map((x, i) => x | b[i]!);

/** Can clause `c` be widened with clause `f` into one OR / IN clause? */
const widenable = (c: Expr, f: Expr) =>
  (c.op === 'contains' && f.op === 'contains' && c.field === f.field) || (c.op === 'eq' && f.op === 'eq' && c.field === f.field);

function widen(c: Expr, f: Expr): Expr {
  if (c.op === 'eq' && f.op === 'eq') return { op: 'in', field: c.field, values: [c.value, f.value] };
  if (c.op === 'in' && f.op === 'eq') return { ...c, values: [...c.values, f.value] };
  if (c.op === 'or') return { op: 'or', args: [...c.args, f] };
  return { op: 'or', args: [c, f] };
}
const baseOf = (c: Expr): Expr => (c.op === 'or' ? c.args[0]! : c.op === 'in' ? { op: 'eq', field: c.field, value: c.values[0]! } : c);
const sizeOf = (c: Expr) => (c.op === 'or' ? c.args.length : c.op === 'in' ? c.values.length : 1);

/** Precision / recall / F1 of a clause set on examples (unknown counts as not firing). */
export function scoreClauses(examples: Example[], clauses: Expr[]) {
  const labels = Uint8Array.from(examples, (e) => (e.positive ? 1 : 0));
  const mask = Uint8Array.from(examples, (e) => (clauses.every((c) => evalJql(c, e.snap, { description: descriptionAt(e.issue, e.event.ts) }) === true) ? 1 : 0));
  return score(mask, labels);
}

export function learnRule(examples: Example[], vocab: Set<string>, s: Settings): LearnedRule {
  if (!examples.length) return { clauses: [], f1: 0, precision: 0, recall: 0 };
  const n = examples.length;
  const labels = Uint8Array.from(examples, (e) => (e.positive ? 1 : 0));
  const features = candidateClauses(examples, vocab).map((expr) => ({
    expr,
    mask: Uint8Array.from(examples, (e) => (evalJql(expr, e.snap, { description: descriptionAt(e.issue, e.event.ts) }) === true ? 1 : 0)),
  }));

  const chosen: { expr: Expr; mask: Uint8Array }[] = [];
  let best = score(and([], n), labels);
  while (chosen.length < s.maxClauses) {
    let pick: { expr: Expr; mask: Uint8Array; sc: ReturnType<typeof score> } | null = null;
    for (const f of features) {
      if (chosen.some((c) => toJql(c.expr) === toJql(f.expr))) continue;
      const sc = score(and([...chosen.map((c) => c.mask), f.mask], n), labels);
      if (!pick || sc.f1 > pick.sc.f1) pick = { ...f, sc };
    }
    if (!pick || pick.sc.f1 - best.f1 < s.minGain) break;
    chosen.push({ expr: pick.expr, mask: pick.mask });
    best = pick.sc;
  }

  for (let k = 0; k < chosen.length; k++) {
    for (;;) {
      const c = chosen[k]!;
      if (sizeOf(c.expr) >= MAX_WIDEN) break;
      const others = chosen.filter((_, j) => j !== k).map((x) => x.mask);
      let pick: { expr: Expr; mask: Uint8Array; sc: ReturnType<typeof score> } | null = null;
      for (const f of features) {
        if (!widenable(baseOf(c.expr), f.expr) || toJql(c.expr).includes(toJql(f.expr).split(' ').pop()!)) continue;
        const mask = or(c.mask, f.mask);
        const sc = score(and([...others, mask], n), labels);
        if (!pick || sc.f1 > pick.sc.f1) pick = { expr: widen(c.expr, f.expr), mask, sc };
      }
      if (!pick || pick.sc.f1 - best.f1 < s.minGain) break;
      chosen[k] = { expr: pick.expr, mask: pick.mask };
      best = pick.sc;
    }
  }
  return { clauses: chosen.map((c) => c.expr), ...best };
}
