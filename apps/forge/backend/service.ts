/** Use cases shared by the UI resolvers, triggers and Rovo actions. Numbers only ever come from stored runs. */
import { asApp, asUser, route } from '@forge/api';
import { Queue } from '@forge/events';
import {
  BOT_CONFIG, SIM_IDS, simulateHistory,
  actionOf, analyse, applyExclusion, describeClause, findExceptions, fromJira, fromNativeRule, replay, sentence, snapshotBefore, toNativeRule,
  type Chore, type IssueRecord, type NativeExport, type Names,
} from '@wind-tunnel/engine';
import { call, canBrowse, changelogs, commentsOf, fieldIds, names, searchPage } from './jira';
import { choreRef, isReversal, nudgeMatches, summarise, trimChore, type ChoreStatus, type StoredChore } from './logic';
import * as db from './store';

const queue = new Queue({ key: 'ingest-queue' });
const MAX_ISSUES = 5000;
const DAY = 86_400_000;

export type Job = { type: 'ingest'; projectKey: string; nextPageToken?: string } | { type: 'analyse'; projectKey: string } | { type: 'demo'; projectKey: string };

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

const namesOf = async (projectKey: string): Promise<Names> => ({ values: await db.getNames(projectKey) });

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
    if (old && old.status !== 'new') continue;
    await db.putChore(projectKey, detail(c, issues, result.window, s, nm, (old?.chore as Detail | undefined)?.firstSeen), 'new');
  }
  await db.deleteChoresExcept(projectKey, result.chores.map((c) => c.id));
  await db.putAnalysisMeta(projectKey, {
    window: result.window, runAt: Date.now(), issues: issues.length,
    unexplained: result.unexplained.map((u) => ({ id: u.id, count: u.count, reason: u.reason })),
  });
  await db.putProgress(projectKey, { ...started, phase: 'done', done: issues.length, finishedAt: Date.now() });
}

function detail(c: Chore, issues: IssueRecord[], window: { start: number; cut: number; end: number }, s: Awaited<ReturnType<typeof db.getSettings>>, nm: Names, firstSeen?: number): Detail {
  const ex = findExceptions(c, issues, window, s);
  return {
    ...trimChore(c),
    sentence: sentence(c, nm),
    clauseText: c.clauses.map((cl) => describeClause(cl, nm)),
    exceptions: { ...ex, described: ex.groups.map((g) => describeClause(g.clause, nm)), suggestionText: ex.suggestion ? describeClause(ex.suggestion.clause, nm) : undefined },
    firstSeen: firstSeen ?? Date.now(),
  };
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
  return choreDetail(projectKey, choreId);
}

export async function setStatus(projectKey: string, choreId: string, status: Extract<ChoreStatus, 'new' | 'dismissed'>) {
  await db.setChoreStatus(projectKey, choreId, status);
}

/** Hand-off (PRD §13): needs a proof on the holdout with coverage >= 80%, and the person's confirmation. Created as the user. */
export async function sendToAdmin(projectKey: string, choreId: string, confirm: boolean) {
  const d = await choreDetail(projectKey, choreId);
  if (!d) throw new Error(`No chore ${choreId} in ${projectKey}.`);
  const c = d.chore;
  const blocked = c.verdict !== 'proven' ? `its proof is "${c.verdict}"` : c.proof.coverage < d.settings.minCoverage ? `coverage is ${(c.proof.coverage * 100).toFixed(0)}% (needs ${(d.settings.minCoverage * 100).toFixed(0)}%)` : null;
  const understood = { projectKey, choreId, version: c.version, sentence: c.sentence };
  if (blocked) return { understood, created: false, reason: `Not ready for hand-off: ${blocked}.` };
  if (!confirm) return { understood, created: false, reason: 'Confirmation needed: this creates a work item for your Jira admin.' };
  if (d.handoff) return { understood, created: false, key: d.handoff.handoff_key, reason: 'Already handed off.' };

  const ids = (await db.getFieldIds(projectKey)) as { requestType?: string; organizations?: string; projectId?: string; projectTypeKey?: string };
  const ctx = { projectId: ids.projectId ?? '', projectTypeKey: ids.projectTypeKey ?? 'service_desk', fieldIds: { requestType: ids.requestType ?? '', organizations: ids.organizations ?? '' }, names: { values: d.names } };
  const rule = toNativeRule(c, `Wind Tunnel: ${c.sentence}`.slice(0, 255), ctx);
  const s = await db.getSettings(projectKey);
  const targetProject = s.adminProjectKey || projectKey;
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  const p = c.proof;
  const text = [
    `Rule: ${c.sentence}`,
    `Proof (holdout ${fmt(p.range.from)} → ${fmt(p.range.to)}, not used for learning): matched the team on ${p.tp} of ${p.tp + p.fp} times it would act (precision ${(p.precision * 100).toFixed(1)}%); people did it ${p.tp + p.fn} times, the rule would have caught ${p.tp} (recall ${(p.recall * 100).toFixed(1)}%); coverage ${(p.coverage * 100).toFixed(1)}%.`,
    c.note ? `Note: ${c.note}.` : '',
    'Import: Settings → System → Global automation → … → Import rules → choose the attached JSON. Imported rules arrive disabled; review, then enable. When it runs it sets the issue property windtunnel.run so Wind Tunnel can report live results.',
    'Rule JSON format verification against a real export: pending (see Wind Tunnel docs).',
  ].filter(Boolean);
  const issue = await call(asUser(), route`/rest/api/3/issue`, {
    method: 'POST',
    body: {
      fields: {
        project: { key: targetProject },
        issuetype: { name: 'Task' },
        summary: `Automate: ${c.sentence}`.slice(0, 254),
        description: { type: 'doc', version: 1, content: [...text.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })), { type: 'codeBlock', attrs: { language: 'json' }, content: [{ type: 'text', text: JSON.stringify(rule, null, 2) }] }] },
      },
    },
  });
  await attachJson(issue.key, `wind-tunnel-${choreId.replace(/[^a-z0-9]+/gi, '-')}-v${c.version}.json`, rule).catch(() => null); // JSON is also in the description
  await db.addHandoff(projectKey, choreId, c.version, issue.key);
  await db.setChoreStatus(projectKey, choreId, 'handed_off');
  return { understood, created: true, key: issue.key };
}

async function attachJson(issueKey: string, filename: string, json: NativeExport) {
  const form = new FormData();
  form.append('file', new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), filename);
  const r = await asUser().requestJira(route`/rest/api/3/issue/${issueKey}/attachments`, { method: 'POST', headers: { 'X-Atlassian-Token': 'no-check' }, body: form as unknown as string });
  if (!r.ok) throw new Error(`attach ${r.status}`);
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
  return {
    understood, inconclusive: false, range,
    wouldAct: p.tp + p.fp, matchesPeople: p.tp, ruleOnly: p.fp, peopleOnly: p.fn, inconclusiveCases: p.inconclusive,
    precision: p.precision, recall: p.recall, coverage: p.coverage,
    sentence: sentence({ trigger: parsed.trigger, clauses: parsed.clauses, action: parsed.action }, { values: nm }),
    examples: p.cases.slice(0, 20).map((c) => ({ key: c.key, outcome: c.outcome, reason: c.reason ?? null })),
  };
}

// ---------- pipeline 4: live events, nudges, weekly ----------

export async function onIssueChanged(projectKey: string, issueId: string, actorAccountId?: string) {
  if (!(await db.projects()).includes(projectKey) || (await db.isDemo(projectKey))) return;
  const ids = await db.getFieldIds(projectKey);
  const page = await searchPage(`id = ${issueId}`, ids);
  const raw = page.issues[0];
  if (!raw) return;
  const logs = await changelogs([raw.id]);
  const hash = await db.hasher();
  const rec = fromJira(raw, logs.get(raw.id) ?? [], commentsOf(raw), { hash, fieldIds: ids });
  await db.putIssues(projectKey, [rec]);
  const rows = await db.getChores(projectKey);

  // signature: our generated rules set windtunnel.run when they run (PRD §12)
  const prop = await call(asApp(), route`/rest/api/3/issue/${issueId}/properties/windtunnel.run`).catch(() => null);
  const sig = prop?.value && typeof prop.value === 'object' ? prop.value : typeof prop?.value === 'string' ? safeJson(prop.value) : null;
  if (sig?.choreId) {
    const runMs = Date.parse(sig.ts) || Date.now();
    await db.addLiveRun(projectKey, String(sig.choreId), issueId, runMs);
    if (rows.some((r) => r.chore.id === sig.choreId && r.status !== 'live')) await db.setChoreStatus(projectKey, String(sig.choreId), 'live');
  }
  // reversals within 24 h of a live run
  for (const run of await db.getLiveRuns(projectKey, Date.now() - 2 * DAY)) {
    if (run.issue_id !== issueId || run.reversed) continue;
    const c = rows.find((r) => r.chore.id === run.chore_id)?.chore;
    if (c && rec.events.some((e) => isReversal(c.action, Number(run.run_ms), e))) await db.markReversed(projectKey, run.chore_id, issueId, Number(run.run_ms));
  }
  // nudges: this person just did a proven chore by hand
  if (!actorAccountId) return;
  const me = hash(actorAccountId);
  const recent = rec.events.filter((e) => e.actorHash === me && e.kind === 'field' && Date.now() - e.ts < 10 * 60_000);
  for (const e of recent) {
    for (const done of actionOf(e)) {
      for (const r of rows) {
        if (r.status === 'dismissed' || r.status === 'handed_off' || r.status === 'live' || r.chore.verdict !== 'proven') continue;
        if (nudgeMatches(r.chore, done, snapshotBefore(rec, e), rec.text.description)) await db.addNudge(projectKey, issueId, me, r.chore.id);
      }
    }
  }
}

const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };

export async function nudgeFor(projectKey: string, issueId: string, accountId: string) {
  const hash = await db.hasher();
  const me = hash(accountId);
  const skip = await db.notAChore(me);
  const rows = await db.getChores(projectKey);
  for (const n of await db.getNudges(issueId, me)) {
    const r = rows.find((x) => x.chore.id === n.chore_id);
    if (!r || skip.includes(n.chore_id) || ['dismissed', 'handed_off', 'live'].includes(r.status)) continue;
    // "you and N teammates": distinct people only, the viewer is the only one resolved (PRD §9)
    const teammates = Math.max(0, r.chore.people - 1);
    return { chore: summarise(projectKey, r.chore, (r.chore as Detail).sentence ?? r.chore.id, r.status), teammates, count: r.chore.count };
  }
  return null;
}

export async function answerNudge(projectKey: string, issueId: string, accountId: string, choreId: string, answer: 'seen' | 'not-a-chore') {
  const me = (await db.hasher())(accountId);
  await db.setNudgeState(issueId, me, choreId, answer === 'seen' ? 'seen' : 'dismissed');
  if (answer === 'not-a-chore') await db.addNotAChore(me, choreId);
}

export async function weeklyReport(projectKey: string, now = Date.now()) {
  const since = now - 7 * DAY;
  const rows = await db.getChores(projectKey);
  const runs = await db.getLiveRuns(projectKey, since);
  const live = rows
    .filter((r) => r.status === 'live' || runs.some((x) => x.chore_id === r.chore.id))
    .map((r) => {
      const mine = runs.filter((x) => x.chore_id === r.chore.id);
      return { ref: choreRef(projectKey, r.chore.id), sentence: (r.chore as Detail).sentence ?? r.chore.id, runs: mine.length, reversed: mine.filter((x) => Number(x.reversed)).length };
    });
  const fresh = rows.filter((r) => ((r.chore as Detail).firstSeen ?? 0) >= since && r.status === 'new').map((r) => ({ ref: choreRef(projectKey, r.chore.id), sentence: (r.chore as Detail).sentence ?? r.chore.id }));
  return { projectKey, from: since, to: now, live, newChores: fresh };
}

/** Events on one item around a moment, with display names and actor kind only (no identities). */
export async function caseTimeline(projectKey: string, issueId: string, around: number) {
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
  for (const p of await db.projects()) await startAnalysis(p);
}
