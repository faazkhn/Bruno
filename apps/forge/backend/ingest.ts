/** Pipelines 1–3: ingest history (or simulated demo history), then mine and prove chores. Runs on the async queue. */
import { asApp, route } from '@forge/api';
import { Queue } from '@forge/events';
import { BOT_CONFIG, SIM_IDS, simulateHistory, analyse, riskOf, verdictOf, describeClause, findExceptions, fromJira, sentence, type Chore, type IssueRecord, type Names } from '@wind-tunnel/engine';
import { call, changelogs, commentsOf, doneStatuses, fieldIds, names, searchPage } from './jira';
import { liveKey, trimChore } from './logic';
import type { Detail } from './service';
import * as db from './store';

const queue = new Queue({ key: 'ingest-queue' });
const MAX_ISSUES = 5000;

export type Job = { type: 'ingest'; projectKey: string; nextPageToken?: string } | { type: 'analyse'; projectKey: string } | { type: 'demo'; projectKey: string };

export const namesOf = async (projectKey: string): Promise<Names> => ({ values: await db.getNames(projectKey) });

// ---------- pipeline 1 + 2/3: ingest then analyse (async consumer) ----------

export async function startAnalysis(projectKey: string) {
  const p = await db.getProgress(projectKey);
  if (['listing', 'fetching', 'mining', 'proving'].includes(p.phase) && Date.now() - p.startedAt < 30 * 60_000) return p;
  const progress: db.Progress = { phase: 'listing', done: 0, startedAt: Date.now() };
  await db.putProgress(projectKey, progress);
  await db.addProject(projectKey);
  // demo projects re-run analysis on their simulated history only
  await queue.push({ body: (await db.isDemo(projectKey)) ? { type: 'analyse', projectKey } : { type: 'ingest', projectKey } });
  return progress;
}

const kvs_clearMeta = (p: string) => db.clearAnalysisMeta(p);

/** Simulated demo history: 90 days generated from the published history-bot config, clearly labelled in the UI. */
export async function useDemo(projectKey: string, on: boolean) {
  await db.clearIssues(projectKey);
  if (!on) await db.clearIssues(liveKey(projectKey)); // real items are stored under the main key again
  await db.clearChores(projectKey);
  await kvs_clearMeta(projectKey);
  await db.setDemo(projectKey, on);
  const progress: db.Progress = { phase: on ? 'listing' : 'idle', done: 0, startedAt: Date.now() };
  await db.putProgress(projectKey, progress);
  if (on) {
    await db.addProject(projectKey);
    await queue.push({ body: { type: 'demo', projectKey } });
  }
  return progress;
}

async function loadDemoHistory(projectKey: string) {
  const issues = simulateHistory(BOT_CONFIG, { days: 90, seed: 2026, end: Date.now() });
  const flip = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));
  await db.putNames(projectKey, {
    requestType: flip(SIM_IDS.requestType), components: flip(SIM_IDS.components), priority: flip(SIM_IDS.priority),
    status: flip(SIM_IDS.status), organizations: flip(SIM_IDS.organizations), issuetype: { [SIM_IDS.issuetype]: 'Service request' },
  });
  await db.putDoneStatuses(projectKey, [SIM_IDS.status.Resolved!]);
  const ids = (await db.getFieldIds(projectKey)) as Record<string, string>;
  if (!ids.projectId) {
    const project = await call(asApp(), route`/rest/api/3/project/${projectKey}`);
    await db.putFieldIds(projectKey, { ...(await fieldIds()), projectId: String(project.id), projectTypeKey: project.projectTypeKey });
  }
  const start = await db.getProgress(projectKey);
  for (let i = 0; i < issues.length; i += 1000) {
    await db.putIssuesBatch(projectKey, issues.slice(i, i + 1000));
    await db.putProgress(projectKey, { ...start, phase: 'fetching', done: Math.min(issues.length, i + 1000) });
  }
  await queue.push({ body: { type: 'analyse', projectKey } });
}

export async function runJob(job: Job) {
  try {
    if (job.type === 'ingest') await ingestPage(job.projectKey, job.nextPageToken);
    else if (job.type === 'demo') await loadDemoHistory(job.projectKey);
    else await runAnalysis(job.projectKey);
  } catch (e) {
    const p = await db.getProgress(job.projectKey);
    await db.putProgress(job.projectKey, { ...p, phase: 'error', error: String(e).slice(0, 300), finishedAt: Date.now() });
    throw e;
  }
}

async function ingestPage(projectKey: string, nextPageToken?: string) {
  const s = await db.getSettings(projectKey);
  if (!nextPageToken) {
    const ids = await fieldIds();
    const project = await call(asApp(), route`/rest/api/3/project/${projectKey}`);
    await db.putFieldIds(projectKey, { ...ids, projectId: String(project.id), projectTypeKey: project.projectTypeKey });
    await db.putNames(projectKey, await names(projectKey));
    await db.putDoneStatuses(projectKey, await doneStatuses());
  }
  const ids = await db.getFieldIds(projectKey);
  // 'lastActivity' (seeded/old projects): no date filter, newest first, capped
  const jql = s.anchor === 'now' ? `project = "${projectKey}" AND updated >= -${s.windowDays}d ORDER BY created DESC` : `project = "${projectKey}" ORDER BY updated DESC`;
  const page = await searchPage(jql, ids, nextPageToken);
  const logs = await changelogs(page.issues.map((i) => i.id));
  const hash = await db.hasher();
  const recs = page.issues.map((i) => fromJira(i, logs.get(i.id) ?? [], commentsOf(i), { hash, fieldIds: ids }));
  await db.putIssues(projectKey, recs);
  const prev = await db.getProgress(projectKey);
  const done = (nextPageToken ? prev.done : 0) + recs.length;
  await db.putProgress(projectKey, { ...prev, phase: 'fetching', done });
  if (page.nextPageToken && done < MAX_ISSUES) await queue.push({ body: { type: 'ingest', projectKey, nextPageToken: page.nextPageToken } });
  else await queue.push({ body: { type: 'analyse', projectKey } });
}

async function runAnalysis(projectKey: string) {
  const started = await db.getProgress(projectKey);
  await db.putProgress(projectKey, { ...started, phase: 'mining' });
  const issues = await db.getIssues(projectKey);
  const s = await db.getSettings(projectKey);
  const result = analyse(issues, s, Date.now());
  await db.putProgress(projectKey, { ...started, phase: 'proving' });
  const nm = await namesOf(projectKey);
  const existing = new Map((await db.getChores(projectKey)).map((r) => [r.chore.id, r]));
  for (const c of result.chores) {
    const old = existing.get(c.id);
    // chores a person already acted on keep their version and status; only fresh ones are replaced
    if (old && old.status !== 'new') {
      // keep the version a person acted on, but judge its stored proof by today's verdict rule
      const risk = old.chore.risk ?? riskOf(old.chore.action, s); // chores stored before risk existed
      const v = verdictOf(old.chore.proof, s, risk);
      if (v !== old.chore.verdict || risk !== old.chore.risk) await db.putChore(projectKey, { ...old.chore, risk, verdict: v }, old.status);
      continue;
    }
    await db.putChore(projectKey, detail(c, issues, result.window, s, nm, (old?.chore as Detail | undefined)?.firstSeen), 'new');
  }
  await db.deleteChoresExcept(projectKey, result.chores.map((c) => c.id));
  await db.putAnalysisMeta(projectKey, {
    window: result.window, runAt: Date.now(), issues: issues.length,
    unexplained: result.unexplained.map((u) => ({ id: u.id, count: u.count, reason: u.reason })),
  });
  await db.putProgress(projectKey, { ...started, phase: 'done', done: issues.length, finishedAt: Date.now() });
}

export function detail(c: Chore, issues: IssueRecord[], window: { start: number; cut: number; end: number }, s: Awaited<ReturnType<typeof db.getSettings>>, nm: Names, firstSeen?: number): Detail {
  const ex = findExceptions(c, issues, window, s);
  return {
    ...trimChore(c),
    sentence: sentence(c, nm),
    clauseText: c.clauses.map((cl) => describeClause(cl, nm)),
    exceptions: { ...ex, described: ex.groups.map((g) => describeClause(g.clause, nm)), // the suggestion is NOT(group): describe the group, the UI/Rovo say "exclude when <group>"
    suggestionText: ex.suggestion ? describeClause(ex.suggestion.clause.op === 'not' ? ex.suggestion.clause.arg : ex.suggestion.clause, nm) : undefined },
    firstSeen: firstSeen ?? Date.now(),
  };
}
