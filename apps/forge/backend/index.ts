/** Forge entry points (see manifest.yml). Bundled with the engine into src/index.js by build.mjs. */
import ResolverModule from '@forge/resolver';
import { parseChoreRef } from './logic';
import * as svc from './service';
import * as db from './store';

/* eslint-disable @typescript-eslint/no-explicit-any */
// @forge/resolver is CommonJS (exports.default): unwrap explicitly, an ESM default import gets the module object
const Resolver = ((ResolverModule as any).default ?? ResolverModule) as typeof ResolverModule;
const resolverDef = new Resolver();
const projectOf = (context: any, payload: any): string => payload?.projectKey ?? context?.extension?.project?.key;

const guarded = (fn: (payload: any, context: any, projectKey: string) => Promise<unknown>) => async ({ payload, context }: any) => {
  const projectKey = projectOf(context, payload);
  if (!projectKey) return { error: 'No project in context.' };
  try {
    await svc.assertCanBrowse(projectKey);
    return await fn(payload ?? {}, context, projectKey);
  } catch (e) {
    return { error: e instanceof svc.Forbidden ? e.message : `Something went wrong: ${String(e).slice(0, 200)}` };
  }
};

resolverDef.define('overview', guarded((_p, _c, k) => svc.overview(k)));
resolverDef.define('start', guarded((_p, _c, k) => svc.startAnalysis(k)));
resolverDef.define('progress', guarded((_p, _c, k) => db.getProgress(k)));
resolverDef.define('chore', guarded((p, _c, k) => svc.choreDetail(k, p.choreId)));
resolverDef.define('exclude', guarded((p, _c, k) => svc.applySuggestedExclusion(k, p.choreId)));
resolverDef.define('setStatus', guarded((p, _c, k) => svc.setStatus(k, p.choreId, p.status === 'dismissed' ? 'dismissed' : 'new')));
resolverDef.define('sendToAdmin', guarded((p, _c, k) => svc.sendToAdmin(k, p.choreId, p.confirm === true)));
resolverDef.define('replay', guarded((p, _c, k) => svc.replayRule(k, String(p.ruleJson ?? ''), p.windowDays ? Number(p.windowDays) : undefined)));
resolverDef.define('timeline', guarded((p, _c, k) => svc.caseTimeline(k, String(p.issueId), Number(p.around))));
resolverDef.define('demo', guarded((p, _c, k) => svc.useDemo(k, p.on === true)));
resolverDef.define('weekly', guarded((_p, _c, k) => svc.weeklyReport(k)));
resolverDef.define('settings', guarded(async (p, _c, k) => {
  if (p.save) {
    const allowed = ['windowDays', 'minCount', 'minPeople', 'anchor', 'excludedFields', 'adminProjectKey'];
    await db.putSettings(k, Object.fromEntries(Object.entries(p.save).filter(([key]) => allowed.includes(key))));
  }
  return db.getSettings(k);
}));
resolverDef.define('nudge', guarded((_p, c, k) => svc.nudgeFor(k, String(c.extension?.issue?.id), c.accountId)));
resolverDef.define('answerNudge', guarded((p, c, k) => svc.answerNudge(k, String(c.extension?.issue?.id), c.accountId, p.choreId, p.answer === 'not-a-chore' ? 'not-a-chore' : 'seen')));
resolverDef.define('projects', async () => db.projects());

export const resolver = resolverDef.getDefinitions();

// ---- product events (incremental ingestion, signatures, nudges) ----
export async function onIssueEvent(event: any) {
  const projectKey = event?.issue?.fields?.project?.key;
  const issueId = event?.issue?.id;
  if (!projectKey || !issueId) return;
  await svc.onIssueChanged(projectKey, String(issueId), event?.atlassianId);
}

// ---- schedules ----
export async function nightly() {
  await svc.nightly();
}
export async function weekly() {
  for (const p of await db.projects()) await db.putWeekly(p, await svc.weeklyReport(p));
}

// ---- async consumer ----
export async function worker(event: any) {
  await svc.runJob(event.body as svc.Job);
}

// ---- Rovo actions (every action echoes what it understood, PRD §14) ----
const fail = (understood: object, message: string) => ({ understood, error: message });
/** Rovo quotes numbers exactly: give it the same rounding the page shows. */
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function listChoresAction(payload: any) {
  const projectKey = String(payload?.projectKey ?? '').trim().toUpperCase();
  const limit = Math.max(1, Math.min(25, Number(payload?.limit) || 10));
  const understood = { projectKey, limit };
  if (!projectKey) return fail(understood, 'Which project? Give me a project key, e.g. WT.');
  try {
    await svc.assertCanBrowse(projectKey);
    const o = await svc.overview(projectKey);
    if (!o.chores.length) return { understood, chores: [], note: o.meta ? 'No chores found: needs ≥ 20 repeated actions by enough people.' : 'This project has not been analysed yet. Open the Autopilot page and choose "Analyse history".' };
    return {
      understood,
      window: o.meta?.window ?? null,
      chores: o.chores.slice(0, limit).map((c) => ({ choreId: c.ref, sentence: c.sentence, timesByHand: c.count, people: c.people, agreed: c.matches, wouldAct: c.fires, precision: pct(c.precision), verdict: c.verdict, status: c.status, handoffKey: c.handoff ?? null })),
    };
  } catch (e) {
    return fail(understood, String(e));
  }
}

export async function proveChoreAction(payload: any) {
  const ref = parseChoreRef(String(payload?.choreId ?? ''));
  const understood = { choreId: payload?.choreId ?? null, projectKey: ref?.projectKey ?? null };
  if (!ref) return fail(understood, 'I need a chore id like "WT/set:requestType:339" — list the chores first.');
  try {
    await svc.assertCanBrowse(ref.projectKey);
    const d = await svc.choreDetail(ref.projectKey, ref.choreId);
    if (!d) return fail(understood, 'No such chore in that project.');
    const c = d.chore;
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    return {
      understood: { ...understood, sentence: c.sentence, version: c.version },
      holdout: { from: day(c.proof.range.from), to: day(c.proof.range.to), note: 'not used for learning' },
      agreed: c.proof.tp, wouldAct: c.proof.tp + c.proof.fp, peopleDid: c.proof.tp + c.proof.fn,
      precision: pct(c.proof.precision), recall: pct(c.proof.recall), coverage: pct(c.proof.coverage), verdict: c.verdict, note: c.note ?? null,
      status: d.status, handoffKey: d.handoff?.handoff_key ?? null,
      topDifferences: c.proof.cases.filter((x) => x.outcome === 'FP' || x.outcome === 'FN').slice(0, 5).map((x) => ({ key: x.key, kind: x.outcome === 'FP' ? 'rule would act where people didn’t' : 'people acted where the rule wouldn’t', reason: x.reason ?? null })),
      suggestedExclusion: c.exceptions?.suggestion ? { text: `Exclude when ${c.exceptions.suggestionText}`, explains: `${pct(c.exceptions.suggestion.share)} of the learning-period times the rule would act where people didn't` } : null,
    };
  } catch (e) {
    return fail(understood, String(e));
  }
}

export async function sendToAdminAction(payload: any) {
  const ref = parseChoreRef(String(payload?.choreId ?? ''));
  const understood = { choreId: payload?.choreId ?? null, version: payload?.version ?? null, confirm: payload?.confirm === true || payload?.confirm === 'true' };
  if (!ref) return fail(understood, 'I need a chore id like "WT/set:requestType:339".');
  try {
    await svc.assertCanBrowse(ref.projectKey);
    return await svc.sendToAdmin(ref.projectKey, ref.choreId, understood.confirm);
  } catch (e) {
    return fail(understood, String(e));
  }
}

export async function replayRuleAction(payload: any) {
  const projectKey = String(payload?.projectKey ?? '').trim().toUpperCase();
  const understood = { projectKey, windowDays: payload?.windowDays ?? null };
  if (!projectKey || !payload?.ruleJson) return fail(understood, 'I need a project key and the exported rule JSON.');
  try {
    await svc.assertCanBrowse(projectKey);
    return await svc.replayRule(projectKey, String(payload.ruleJson), payload.windowDays ? Number(payload.windowDays) : undefined);
  } catch (e) {
    return fail(understood, String(e));
  }
}
