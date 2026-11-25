/** Pure helpers shared by resolvers, triggers and Rovo actions (no Forge imports, unit-tested). */
import { actionOf, evalJql, performs, replay, wilson, type IssueRecord, type Expr, type Settings, type Action, type Chore, type Event, type Snapshot } from '@wind-tunnel/engine';

export type ChoreStatus = 'new' | 'dismissed' | 'proven' | 'handed_off' | 'live';
export interface StoredChore extends Chore { casesTruncated?: boolean }

/** Chore ids are per project; Rovo and MCP see "<projectKey>/<choreId>". */
export const choreRef = (projectKey: string, choreId: string) => `${projectKey}/${choreId}`;
export function parseChoreRef(ref: string): { projectKey: string; choreId: string } | null {
  const m = /^([A-Z][A-Z0-9_]+)\/(.+)$/.exec(ref.trim());
  return m ? { projectKey: m[1]!, choreId: m[2]! } : null;
}

/** Keep every count, store at most `perOutcome` example cases of each kind (Forge SQL row size). */
export function trimChore(c: Chore, perOutcome = 50): StoredChore {
  const seen: Record<string, number> = {};
  const cases = c.proof.cases.filter((x) => (seen[x.outcome] = (seen[x.outcome] ?? 0) + 1) <= perOutcome);
  return { ...c, proof: { ...c.proof, cases }, casesTruncated: cases.length < c.proof.cases.length };
}

export interface ChoreSummary {
  risk: Chore['risk'];
  ref: string;
  id: string;
  version: number;
  sentence: string;
  count: number;
  people: number;
  matches: number;
  fires: number;
  differences: number;
  precision: number;
  recall: number;
  coverage: number;
  verdict: Chore['verdict'];
  status: ChoreStatus;
  perMonth: number;
  /** 95% Wilson intervals: the honest range behind precision and recall */
  precisionLikely: { low: number; high: number };
  recallLikely: { low: number; high: number };
}

export function summarise(projectKey: string, c: Chore, sentence: string, status: ChoreStatus): ChoreSummary {
  return {
    ref: choreRef(projectKey, c.id), id: c.id, version: c.version, sentence, risk: c.risk, count: c.count, people: c.people,
    matches: c.proof.tp, fires: c.proof.tp + c.proof.fp, differences: c.proof.fp + c.proof.fn,
    precision: c.proof.precision, recall: c.proof.recall, coverage: c.proof.coverage, verdict: c.verdict, status, perMonth: c.perMonth,
    precisionLikely: wilson(c.proof.tp, c.proof.tp + c.proof.fp), recallLikely: wilson(c.proof.tp, c.proof.tp + c.proof.fn),
  };
}

/** The person just did this chore by hand and the rule's conditions held on the item. */
export function nudgeMatches(c: Chore, done: Action, snapBefore: Snapshot, description: string): boolean {
  if (done.kind !== c.action.kind || done.field !== c.action.field || done.value !== c.action.value) return false;
  return c.clauses.every((cl) => evalJql(cl, snapBefore, { description }) === true);
}

/** A human undid what the live rule did, within 24 h. */
export function isReversal(a: Action, runTs: number, e: Event): boolean {
  if (e.actorKind !== 'human_agent' || e.kind !== 'field' || e.field !== a.field) return false;
  if (e.ts < runTs || e.ts - runTs > 24 * 3_600_000) return false;
  return !performs({ ...e }, a) && (e.from ?? '').split(',').includes(a.value) && !(e.to ?? '').split(',').includes(a.value);
}

/** The windtunnel.run issue property our generated rules set (object, or JSON string from older rule versions). */
export function parseSignature(value: unknown, now: number): { choreId: string; version: number | null; runMs: number } | null {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || typeof v !== 'object') return null;
  const o = v as { choreId?: unknown; version?: unknown; ts?: unknown };
  if (typeof o.choreId !== 'string' || !o.choreId) return null;
  const ts = typeof o.ts === 'string' ? Date.parse(o.ts) : NaN;
  return { choreId: o.choreId, version: typeof o.version === 'number' ? o.version : null, runMs: Number.isFinite(ts) ? ts : now };
}

interface CaseGroups { exceptions?: { groups: { caseKeys: string[]; caseIds?: string[] }[] } }

/** Item ids a chore's stored examples point at (proof cases + exception groups). */
export function caseIdsOf(c: StoredChore & CaseGroups): string[] {
  return [...new Set([...c.proof.cases.map((x) => x.issueId), ...(c.exceptions?.groups ?? []).flatMap((g) => g.caseIds ?? [])])];
}

/**
 * Hide example items the viewer can't browse ('all' = simulated history, not Jira items). Counts stay complete.
 * Groups stored before caseIds existed can't be checked, so their keys are hidden (fail closed).
 */
export function redactCases<T extends StoredChore & CaseGroups>(c: T, allowed: Set<string> | 'all'): T & { hiddenCases: number } {
  if (allowed === 'all') return { ...c, hiddenCases: 0 };
  const hidden = new Set<string>();
  const ok = (id: string) => allowed.has(id) || (hidden.add(id), false);
  const cases = c.proof.cases.filter((x) => ok(x.issueId));
  const groups = c.exceptions?.groups.map((g) => {
    if (!g.caseIds) { g.caseKeys.forEach((k) => hidden.add(`key:${k}`)); return { ...g, caseKeys: [] }; }
    return { ...g, caseKeys: g.caseKeys.filter((_, i) => ok(g.caseIds![i]!)), caseIds: g.caseIds.filter((id) => allowed.has(id)) };
  });
  return { ...c, proof: { ...c.proof, cases }, ...(c.exceptions ? { exceptions: { ...c.exceptions, groups } } : {}), hiddenCases: hidden.size };
}

/** Stored data older than this is purged (PRD §18: window + 7 days); null = keep (window anchored at last activity). */
export const retentionCutoff = (s: { windowDays: number; anchor: string }, now: number): number | null =>
  s.anchor === 'now' ? now - (s.windowDays + 7) * 86_400_000 : null;

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Automation passport: the evidence behind a hand-off, in one structure (description table + attached JSON). Same numbers as the page. */
export function passport(i: { projectKey: string; chore: StoredChore & { sentence?: string }; demo: boolean; window: { start: number; cut: number; end: number }; now: number }) {
  const c = i.chore, p = c.proof, w = wilson(p.tp, p.tp + p.fp);
  return {
    format: 'bruno-passport/1',
    chore: choreRef(i.projectKey, c.id), version: c.version, rule: c.sentence ?? c.id,
    verdict: c.verdict === 'proven' ? 'validated' : c.verdict,
    provenance: i.demo ? 'simulated demo history (not this site)' : "this site's own history",
    learnedOn: { from: isoDay(i.window.start), to: isoDay(i.window.cut) },
    testedOn: { from: isoDay(p.range.from), to: isoDay(p.range.to) },
    holdout: {
      peopleDid: p.tp + p.fn, ruleWouldAct: p.tp + p.fp, agreed: p.tp,
      precision: pct1(p.precision), precisionLikely: `${Math.floor(w.low * 100)}–${Math.ceil(w.high * 100)}%`,
      recall: pct1(p.recall), coverage: pct1(p.coverage), inconclusive: p.inconclusive,
    },
    exclusion: c.note ?? null,
    limitations: [
      'Measures agreement with what the team did, not whether the team was right.',
      'Conditions use only facts known when the trigger happened.',
      'The tested period was not used for learning or for choosing exclusions.',
      'Time-based rules (time in status, SLAs) are out of scope.',
    ],
    generatedAt: isoDay(i.now),
  };
}
export type Passport = ReturnType<typeof passport>;

/** Rovo "why not?": the verdict's reason in one sentence, real numbers only. null = validated. */
export function whyNot(c: Chore, s: Pick<Settings, 'minPrecisionByRisk' | 'minHoldoutPositives' | 'minCoverage'>, suggestion?: string): string | null {
  const p = c.proof;
  switch (c.verdict) {
    case 'proven': return null;
    case 'needs-judgment': return 'This action closes or resolves work, which needs human judgment: Bruno never recommends automating it.';
    case 'too-few': return `Only ${p.tp + p.fn} holdout cases where people did this; at least ${s.minHoldoutPositives} are needed before anything is validated.`;
    case 'low-coverage': return `Only ${pct1(p.coverage)} of holdout cases could be modelled; at least ${pct1(s.minCoverage)} is needed. Unknown is never treated as safe.`;
    case 'weak': {
      const w = wilson(p.tp, p.tp + p.fp);
      const bar = s.minPrecisionByRisk[c.risk as 'low' | 'medium'] ?? s.minPrecisionByRisk.medium;
      return `Agreed with the team on ${p.tp} of ${p.tp + p.fp} times it would act (${pct1(p.precision)}, likely ${Math.floor(w.low * 100)}–${Math.ceil(w.high * 100)}%); a ${c.risk}-risk change needs the cautious end of that range to reach ${Math.round(bar * 100)}%.${suggestion ? ` Suggested exclusion: ${suggestion}.` : ''}`;
    }
  }
}

/** Words → engine field, for what-if exclusions. Only facts known when the trigger happens. */
const WHATIF_FIELDS: Record<string, string> = {
  organization: 'organizations', organizations: 'organizations', 'request type': 'requestType', requesttype: 'requestType', priority: 'priority',
  component: 'components', components: 'components', label: 'labels', labels: 'labels', 'work type': 'issuetype', issuetype: 'issuetype',
  status: 'status', assignee: 'assignee', summary: 'summary',
};
export function exclusionClause(field: string, value: string, names: Record<string, Record<string, string>>): { clause: Expr } | { error: string } {
  const f = field.trim().toLowerCase();
  if (f === 'resolution') return { error: 'Resolution is only known after the work is done, so it can’t be a condition when the rule runs.' };
  const canon = WHATIF_FIELDS[f];
  if (!canon) return { error: `I can try: organization, request type, priority, component, label, work type, status, assignee, summary (a word). "${field}" isn't one of them.` };
  const v = value.trim();
  if (canon === 'summary') return { clause: { op: 'contains', field: 'summary', value: v.toLowerCase() } };
  const id = Object.entries(names[canon] ?? {}).find(([, n]) => n.toLowerCase() === v.toLowerCase())?.[0];
  return { clause: { op: 'eq', field: canon, value: id ?? v } };
}

/** Shadow mode: score a rule on items that arrived after its test period. Read-only; same replay as the proof. */
export function shadowOf(c: Chore, items: IssueRecord[], now: number, windowHours: number) {
  const range = { from: c.proof.range.to, to: now };
  const p = replay(c.clauses, c.trigger, c.action, items, range, windowHours * 3_600_000);
  return {
    ...range,
    items: items.filter((i) => i.createdAt >= range.from && i.createdAt < range.to).length,
    wouldAct: p.tp + p.fp, agreed: p.tp, ruleOnly: p.fp, peopleOnly: p.fn, inconclusive: p.inconclusive,
  };
}
export type Shadow = ReturnType<typeof shadowOf>;

/** In demo mode, real items arriving on the project are stored apart under this key (the main key holds simulated history). */
export const liveKey = (projectKey: string) => `${projectKey}#live`;

/** Hand actions per week for each chore across the analysis window (people only, bulk edits included). */
export function weeklyTrend(chores: Chore[], issues: IssueRecord[], window: { start: number; end: number }) {
  const WEEK = 7 * 86_400_000;
  const n = Math.ceil((window.end - window.start) / WEEK);
  const byChore: Record<string, number[]> = Object.fromEntries(chores.map((c) => [c.id, new Array<number>(n).fill(0)]));
  for (const issue of issues) {
    for (const e of issue.events) {
      if (e.actorKind !== 'human_agent' || e.ts < window.start || e.ts >= window.end) continue;
      for (const a of actionOf(e)) {
        for (const c of chores) {
          if (a.kind === c.action.kind && a.field === c.action.field && a.value === c.action.value) byChore[c.id]![Math.floor((e.ts - window.start) / WEEK)]!++;
        }
      }
    }
  }
  return { start: window.start, byChore };
}
export type Trend = ReturnType<typeof weeklyTrend>;
