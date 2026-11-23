/** Pipeline 4: live issue events (signatures, reversals, nudges) and the weekly report. */
import { asApp, route } from '@forge/api';
import { actionOf, fromJira, snapshotBefore } from '@wind-tunnel/engine';
import { call, changelogs, commentsOf, searchPage } from './jira';
import { choreRef, isReversal, nudgeMatches, parseSignature, summarise } from './logic';
import type { Detail } from './service';
import * as db from './store';

const DAY = 86_400_000;

// ---------- pipeline 4: live events, nudges, weekly ----------

export async function onIssueChanged(projectKey: string, issueId: string, actorAccountId?: string) {
  if (!(await db.projects()).includes(projectKey)) return;
  // demo mode: the stored history is simulated, so real items are not stored and nobody is nudged; live runs are still tracked
  const demo = await db.isDemo(projectKey);
  const ids = await db.getFieldIds(projectKey);
  const page = await searchPage(`id = ${issueId}`, ids);
  const raw = page.issues[0];
  if (!raw) return;
  const logs = await changelogs([raw.id]);
  const hash = await db.hasher();
  const rec = fromJira(raw, logs.get(raw.id) ?? [], commentsOf(raw), { hash, fieldIds: ids });
  if (!demo) await db.putIssues(projectKey, [rec]);
  const rows = await db.getChores(projectKey);

  // signature: our generated rules set windtunnel.run when they run (PRD §12)
  const prop = await call(asApp(), route`/rest/api/3/issue/${issueId}/properties/windtunnel.run`).catch(() => null);
  const sig = parseSignature(prop?.value, Date.now());
  if (sig) {
    await db.addLiveRun(projectKey, sig.choreId, issueId, sig.runMs);
    if (rows.some((r) => r.chore.id === sig.choreId && r.status !== 'live')) await db.setChoreStatus(projectKey, sig.choreId, 'live');
  }
  // reversals within 24 h of a live run
  for (const run of await db.getLiveRuns(projectKey, Date.now() - 2 * DAY)) {
    if (run.issue_id !== issueId || run.reversed) continue;
    const c = rows.find((r) => r.chore.id === run.chore_id)?.chore;
    if (c && rec.events.some((e) => isReversal(c.action, Number(run.run_ms), e))) await db.markReversed(projectKey, run.chore_id, issueId, Number(run.run_ms));
  }
  // nudges: this person just did a proven chore by hand
  if (!actorAccountId || demo) return;
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

