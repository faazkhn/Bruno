/** Pure helpers shared by resolvers, triggers and Rovo actions (no Forge imports, unit-tested). */
import { evalJql, performs, type Action, type Chore, type Event, type Snapshot } from '@wind-tunnel/engine';

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
}

export function summarise(projectKey: string, c: Chore, sentence: string, status: ChoreStatus): ChoreSummary {
  return {
    ref: choreRef(projectKey, c.id), id: c.id, version: c.version, sentence, risk: c.risk, count: c.count, people: c.people,
    matches: c.proof.tp, fires: c.proof.tp + c.proof.fp, differences: c.proof.fp + c.proof.fn,
    precision: c.proof.precision, recall: c.proof.recall, coverage: c.proof.coverage, verdict: c.verdict, status, perMonth: c.perMonth,
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
