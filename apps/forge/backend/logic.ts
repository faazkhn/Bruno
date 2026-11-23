/** Pure helpers shared by resolvers, triggers and Rovo actions (no Forge imports, unit-tested). */
import { evalJql, performs, wilson, type Action, type Chore, type Event, type Snapshot } from '@wind-tunnel/engine';

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
