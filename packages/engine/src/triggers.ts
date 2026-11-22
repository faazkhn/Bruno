import { performs, type Action, type Candidate } from './candidates';
import { toSet, type Event, type IssueRecord, type Snapshot } from './model';
import type { Range, Settings } from './settings';
import { snapshotAfter } from './snapshot';

export type Trigger =
  | { type: 'created' }
  | { type: 'statusTo'; value: string }
  | { type: 'customerCommented' }
  | { type: 'fieldChanged'; field: string };

export const triggerKey = (t: Trigger) => t.type + ('value' in t ? `:${t.value}` : 'field' in t ? `:${t.field}` : '');

export function triggerEvents(issue: IssueRecord, t: Trigger): Event[] {
  switch (t.type) {
    case 'created': return issue.events.slice(0, 1);
    case 'customerCommented': return issue.events.filter((e) => e.kind === 'comment' && e.actorKind === 'customer' && e.field !== 'internal');
    case 'statusTo': return issue.events.filter((e) => e.kind === 'field' && e.field === 'status' && e.to === t.value);
    case 'fieldChanged': return issue.events.filter((e) => e.kind === 'field' && e.field === t.field);
  }
}

/** The first human event performing `a` strictly after trigger `t` and within W. */
export function followingAction(issue: IssueRecord, t: Event, a: Action, windowMs: number): Event | undefined {
  return issue.events.find((e) => e.seq > t.seq && e.ts > t.ts && e.ts <= t.ts + windowMs && performs(e, a));
}

/** The item already has the action's result: nothing to automate. */
export function isNoOp(snap: Snapshot, a: Action): boolean {
  if (a.kind === 'add') return toSet(snap[a.field]).includes(a.value);
  return snap[a.field] === a.value;
}

export interface TriggerChoice { trigger: Trigger; coverage: number; precision: number; medianDelayMs: number }

const SKIP_FIELDS = new Set(['summary', 'resolution', 'description']);

export function chooseTrigger(c: Candidate, issues: IssueRecord[], range: Range, s: Settings): TriggerChoice | null {
  const W = s.windowHours * 3_600_000;
  const occ = c.occurrences.filter((o) => o.event.ts >= range.from && o.event.ts < range.to);
  if (!occ.length) return null;

  // candidate triggers: the fixed ones plus whatever changed shortly before the action
  const options = new Map<string, Trigger>([['created', { type: 'created' }], ['customerCommented', { type: 'customerCommented' }]]);
  for (const o of occ) {
    for (const e of o.issue.events) {
      if (e.kind !== 'field' || !e.field || e.ts >= o.event.ts || o.event.ts - e.ts > W || SKIP_FIELDS.has(e.field)) continue;
      if (e.field === 'status' && e.to) options.set(`statusTo:${e.to}`, { type: 'statusTo', value: e.to });
      if (e.field !== c.action.field) options.set(`fieldChanged:${e.field}`, { type: 'fieldChanged', field: e.field });
    }
  }

  const scored: TriggerChoice[] = [];
  for (const trigger of options.values()) {
    const delays: number[] = [];
    for (const o of occ) {
      const prev = triggerEvents(o.issue, trigger).filter((t) => t.ts < o.event.ts && o.event.ts - t.ts <= W && t.seq < o.event.seq).at(-1);
      if (prev) delays.push(o.event.ts - prev.ts);
    }
    const coverage = delays.length / occ.length;
    if (coverage < s.minTriggerCoverage) continue;
    delays.sort((a, b) => a - b);
    const medianDelayMs = delays[Math.floor(delays.length / 2)]!;
    if (medianDelayMs > s.maxMedianDelayHours * 3_600_000) continue;

    let fired = 0;
    let followed = 0;
    for (const issue of issues) {
      for (const t of triggerEvents(issue, trigger)) {
        if (t.ts < range.from || t.ts >= range.to || isNoOp(snapshotAfter(issue, t), c.action)) continue;
        fired++;
        if (followingAction(issue, t, c.action, W)) followed++;
      }
    }
    scored.push({ trigger, coverage, precision: fired ? followed / fired : 0, medianDelayMs });
  }
  scored.sort((a, b) => b.precision - a.precision || b.coverage - a.coverage || triggerKey(a.trigger).localeCompare(triggerKey(b.trigger)));
  return scored[0] ?? null;
}
