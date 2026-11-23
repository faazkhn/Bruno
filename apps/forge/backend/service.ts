/** Use cases shared by the UI resolvers, triggers and Rovo actions. Numbers only ever come from stored runs. */
import { applyExclusion, describeClause, findExceptions, fromNativeRule, replay, sentence, type NativeExport } from '@wind-tunnel/engine';
import { detail, namesOf, startAnalysis } from './ingest';
import { browsableIds, canBrowse } from './jira';
import { caseIdsOf, redactCases, retentionCutoff, summarise, type ChoreStatus, type StoredChore } from './logic';
import * as db from './store';

export * from './ingest';
export * from './handoff';
export * from './live';

const DAY = 86_400_000;

export interface Detail extends StoredChore {
  sentence?: string;
  clauseText?: string[];
  exceptions?: ReturnType<typeof findExceptions> & { described?: string[]; suggestionText?: string };
  firstSeen?: number;
}

export class Forbidden extends Error {}
export async function assertCanBrowse(projectKey: string) {
  if (!(await canBrowse(projectKey))) throw new Forbidden(`You can't browse project ${projectKey}.`);
}



// ---------- reads ----------

export async function overview(projectKey: string) {
  const [rows, meta, progress, settings, handoffs] = await Promise.all([db.getChores(projectKey), db.getAnalysisMeta(projectKey), db.getProgress(projectKey), db.getSettings(projectKey), db.getHandoffs(projectKey)]);
  const chores = rows
    .map((r) => ({ ...summarise(projectKey, r.chore, (r.chore as Detail).sentence ?? r.chore.id, r.status), handoff: handoffs.find((h) => h.chore_id === r.chore.id)?.handoff_key ?? null }))
    .sort((a, b) => b.perMonth - a.perMonth);
  return { projectKey, chores, meta: meta ?? null, progress, settings, demo: await db.isDemo(projectKey) };
}

export async function choreDetail(projectKey: string, choreId: string) {
  const row = (await db.getChores(projectKey)).find((r) => r.chore.id === choreId);
  if (!row) return null;
  const meta = await db.getAnalysisMeta(projectKey);
  const settings = await db.getSettings(projectKey);
  const handoff = (await db.getHandoffs(projectKey)).find((h) => h.chore_id === choreId) ?? null;
  return { demo: await db.isDemo(projectKey), chore: row.chore as Detail, status: row.status, names: await db.getNames(projectKey), window: meta?.window ?? null, settings, handoff, summary: summarise(projectKey, row.chore, (row.chore as Detail).sentence ?? choreId, row.status) };
}

/** What the viewer may see: simulated items are not Jira items; real ones go through a per-item permission check. */
const allowedFor = async (projectKey: string, ids: string[]): Promise<Set<string> | 'all'> => ((await db.isDemo(projectKey)) ? 'all' : browsableIds(ids));

/** choreDetail for a person: example items they can't browse are hidden (counts stay). */
export async function choreView(projectKey: string, choreId: string) {
  const d = await choreDetail(projectKey, choreId);
  if (!d) return null;
  return { ...d, chore: redactCases(d.chore, await allowedFor(projectKey, caseIdsOf(d.chore))) };
}

// ---------- writes ----------

export async function applySuggestedExclusion(projectKey: string, choreId: string) {
  const row = (await db.getChores(projectKey)).find((r) => r.chore.id === choreId);
  const meta = await db.getAnalysisMeta(projectKey);
  const sug = (row?.chore as Detail | undefined)?.exceptions?.suggestion;
  if (!row || !meta || !sug) throw new Error('No suggested exclusion for this chore.');
  const issues = await db.getIssues(projectKey);
  const s = await db.getSettings(projectKey);
  const v2 = applyExclusion(row.chore, sug.clause, issues, meta.window, s);
  await db.putChore(projectKey, detail(v2, issues, meta.window, s, await namesOf(projectKey), (row.chore as Detail).firstSeen), row.status === 'dismissed' ? 'new' : row.status);
  return choreView(projectKey, choreId);
}

export async function setStatus(projectKey: string, choreId: string, status: Extract<ChoreStatus, 'new' | 'dismissed'>) {
  await db.setChoreStatus(projectKey, choreId, status);
}

/** Replay an existing rule (PRD bonus flow): what would it have done, versus what people did. */
export async function replayRule(projectKey: string, ruleJson: string, windowDays?: number) {
  let exp: NativeExport;
  try {
    exp = JSON.parse(ruleJson);
  } catch {
    return { understood: { projectKey, windowDays }, error: 'That is not valid JSON. Paste a rule exported from Automation.' };
  }
  const ids = (await db.getFieldIds(projectKey)) as { requestType?: string; organizations?: string; projectId?: string };
  const nm = await db.getNames(projectKey);
  const parsed = fromNativeRule(exp, { projectId: ids.projectId ?? '', projectTypeKey: 'service_desk', fieldIds: { requestType: ids.requestType ?? '', organizations: ids.organizations ?? '' }, names: { values: nm } });
  const understood = { projectKey, windowDays: windowDays ?? null, rule: exp.rules?.[0]?.name ?? '(unnamed)', trigger: parsed.trigger, action: parsed.action, conditions: parsed.clauses.map((c) => describeClause(c, { values: nm })) };
  if (!parsed.trigger || !parsed.action || parsed.unsupported.length) {
    return { understood, inconclusive: true, unsupported: parsed.unsupported, reason: 'Parts of this rule can’t be modelled, so we won’t guess: the replay is inconclusive.' };
  }
  const issues = await db.getIssues(projectKey);
  const s = await db.getSettings(projectKey);
  const now = Date.now();
  const range = { from: now - (windowDays ?? s.windowDays) * DAY, to: now };
  const p = replay(parsed.clauses, parsed.trigger, parsed.action, issues, range, s.windowHours * 3_600_000);
  const first = p.cases.slice(0, 20);
  const allowed = await allowedFor(projectKey, first.map((c) => c.issueId));
  const shown = first.filter((c) => allowed === 'all' || allowed.has(c.issueId));
  return {
    understood, inconclusive: false, range,
    wouldAct: p.tp + p.fp, matchesPeople: p.tp, ruleOnly: p.fp, peopleOnly: p.fn, inconclusiveCases: p.inconclusive,
    precision: p.precision, recall: p.recall, coverage: p.coverage,
    sentence: sentence({ trigger: parsed.trigger, clauses: parsed.clauses, action: parsed.action }, { values: nm }),
    examples: shown.map((c) => ({ key: c.key, outcome: c.outcome, reason: c.reason ?? null })),
    hiddenExamples: first.length - shown.length,
  };
}

/** Events on one item around a moment, with display names and actor kind only (no identities). */
export async function caseTimeline(projectKey: string, issueId: string, around: number) {
  const allowed = await allowedFor(projectKey, [issueId]);
  if (allowed !== 'all' && !allowed.has(issueId)) return null;
  const rec = await db.getIssue(projectKey, issueId);
  if (!rec) return null;
  const nm = await db.getNames(projectKey);
  const name = (field: string | undefined, v: string | null | undefined) =>
    v == null ? null : field && nm[field] ? v.split(',').map((x) => nm[field]![x] ?? x).join(', ') : v;
  const span = 3 * DAY;
  return {
    key: rec.key,
    summary: rec.text.summary,
    events: rec.events
      .filter((e) => Math.abs(e.ts - around) <= span)
      .map((e) => ({ ts: e.ts, kind: e.kind, actor: e.actorKind, field: e.field ?? null, from: name(e.field, e.from), to: name(e.field, e.to) })),
  };
}

export async function nightly() {
  for (const p of await db.projects()) {
    // simulated demo history is regenerated, not retained
    const cutoff = (await db.isDemo(p)) ? null : retentionCutoff(await db.getSettings(p), Date.now());
    if (cutoff !== null) await db.purgeBefore(p, cutoff);
    await startAnalysis(p);
  }
}
