import { invoke } from '@forge/bridge';

/** Resolver call; resolvers return { error } instead of throwing. */
export async function call<T>(name: string, payload: Record<string, unknown> = {}): Promise<T> {
  const r = (await invoke(name, payload)) as T & { error?: string };
  if (r && typeof r === 'object' && 'error' in r && r.error) throw new Error(r.error);
  return r;
}

/* Shapes returned by apps/forge/backend/service.ts */
export type Status = 'new' | 'dismissed' | 'proven' | 'handed_off' | 'live';
export type Verdict = 'proven' | 'too-few' | 'low-coverage' | 'weak' | 'needs-judgment';
export interface Summary {
  ref: string; id: string; version: number; sentence: string; count: number; people: number; matches: number; fires: number;
  differences: number; precision: number; recall: number; coverage: number; verdict: Verdict; status: Status; perMonth: number; handoff?: string | null;
  precisionLikely: Range; recallLikely: Range;
}
export interface Range { low: number; high: number }
export interface Progress { phase: 'idle' | 'listing' | 'fetching' | 'mining' | 'proving' | 'done' | 'error'; done: number; startedAt: number; finishedAt?: number; error?: string }
export interface Settings { windowDays: number; minCount: number; minPeople: number; minCoverage: number; anchor: 'now' | 'lastActivity'; adminProjectKey?: string; excludedFields: string[] }
export interface Window { start: number; cut: number; end: number }
export interface Overview {
  projectKey: string; chores: Summary[]; progress: Progress; settings: Settings; demo: boolean;
  meta: { window: Window; runAt: number; issues: number; unexplained: { id: string; count: number; reason: string }[] } | null;
}
export type Truth = boolean | 'unknown';
export interface Case { issueId: string; key: string; outcome: 'TP' | 'FP' | 'FN' | 'inconclusive'; reason?: 'no-trigger'; triggerTs: number | null; actionTs: number | null; clauses: { jql: string; value: Truth }[]; snapshot: Record<string, string | null> }
export interface Group { outcome: 'FP' | 'FN'; differences: number; ofDifferences: number; lift: number; caseKeys: string[] }
export interface ChoreDetail {
  chore: {
    id: string; version: number; note?: string; sentence?: string; clauseText?: string[]; count: number; people: number; verdict: Verdict; casesTruncated?: boolean; hiddenCases?: number;
    trigger: { type: string; value?: string; field?: string }; action: { kind: string; field: string; value: string };
    proof: { range: { from: number; to: number }; tp: number; fp: number; fn: number; tn: number; inconclusive: number; precision: number; recall: number; coverage: number; cases: Case[] };
    learn: { f1: number; precision: number; recall: number; examples: number };
    exceptions?: { period?: { from: number; to: number }; groups: Group[]; described?: string[]; suggestion?: { share: number; lift: number; learnF1Before: number; learnF1After: number }; suggestionText?: string };
  };
  shadow?: { from: number; to: number; items: number; wouldAct: number; agreed: number; ruleOnly: number; peopleOnly: number; inconclusive: number; realItemsOnSimulatedRule: boolean } | null;
  demo: boolean; status: Status; names: Record<string, Record<string, string>>; window: Window | null; settings: Settings; handoff: { handoff_key: string } | null; summary: Summary;
}
