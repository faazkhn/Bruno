/** Hand-off: a work item for the Jira admin with the rule JSON and its proof. */
import { asUser, route } from '@forge/api';
import { toNativeRule, type NativeExport } from '@wind-tunnel/engine';
import { call } from './jira';
import { passport, type Passport } from './logic';
import { choreDetail } from './service';
import * as db from './store';

/** Hand-off (PRD §13): needs a proof on the holdout with coverage >= 80%, and the person's confirmation. Created as the user. */
export async function sendToAdmin(projectKey: string, choreId: string, confirm: boolean) {
  const d = await choreDetail(projectKey, choreId);
  if (!d) throw new Error(`No chore ${choreId} in ${projectKey}.`);
  const c = d.chore;
  const blocked = c.verdict === 'needs-judgment' ? 'this action ends or resolves work, which needs human judgment' : c.verdict !== 'proven' ? `its proof is "${c.verdict}"` : c.proof.coverage < d.settings.minCoverage ? `coverage is ${(c.proof.coverage * 100).toFixed(0)}% (needs ${(d.settings.minCoverage * 100).toFixed(0)}%)` : null;
  const understood = { projectKey, choreId, version: c.version, sentence: c.sentence };
  if (blocked) return { understood, created: false, reason: `Not ready for hand-off: ${blocked}.` };
  if (!confirm) return { understood, created: false, reason: 'Confirmation needed: this creates a work item for your Jira admin.' };
  if (d.handoff) return { understood, created: false, key: d.handoff.handoff_key, reason: 'Already handed off.' };

  const ids = (await db.getFieldIds(projectKey)) as { requestType?: string; organizations?: string; projectId?: string; projectTypeKey?: string };
  const ctx = { projectId: ids.projectId ?? '', projectTypeKey: ids.projectTypeKey ?? 'service_desk', fieldIds: { requestType: ids.requestType ?? '', organizations: ids.organizations ?? '' }, names: { values: d.names } };
  const rule = toNativeRule(c, `Wind Tunnel: ${c.sentence}`.slice(0, 255), ctx);
  const s = await db.getSettings(projectKey);
  const targetProject = s.adminProjectKey || projectKey;
  const pp = passport({ projectKey, chore: c, demo: d.demo, window: d.window ?? { start: c.proof.range.from, cut: c.proof.range.from, end: c.proof.range.to }, now: Date.now() });
  const h = pp.holdout;
  const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const heading = (t: string) => ({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: t }] });
  const bullets = (xs: string[]) => ({ type: 'bulletList', content: xs.map((t) => ({ type: 'listItem', content: [para(t)] })) });
  const content = [
    para(`Rule: ${c.sentence}`),
    para(`Validated on ${pp.testedOn.from} → ${pp.testedOn.to}, a period not used for learning: it agreed with the team on ${h.agreed} of the ${h.ruleWouldAct} times it would act (${h.precision}, likely ${h.precisionLikely}). People did it ${h.peopleDid} times; the rule would have caught ${h.agreed} (recall ${h.recall}). Coverage ${h.coverage}.`),
    heading('Review checklist'),
    bullets([
      'Trigger and conditions match how the team works today.',
      'The action sets the right field and value.',
      'Exceptions listed below are acceptable.',
      'Import (Settings → System → Global automation → … → Import rules → attached JSON). It arrives disabled; enable it after review.',
    ]),
    heading('Automation passport'),
    bullets([
      `Evidence from: ${pp.provenance}`,
      `Learned on ${pp.learnedOn.from} → ${pp.learnedOn.to}; tested on ${pp.testedOn.from} → ${pp.testedOn.to}`,
      `Holdout: people did it ${h.peopleDid} times; the rule would act ${h.ruleWouldAct} times; agreed ${h.agreed}; inconclusive ${h.inconclusive}`,
      `Exclusion: ${pp.exclusion ?? 'none'}`,
      ...pp.limitations.map((l) => `Limit: ${l}`),
      `Chore ${pp.chore}, version ${pp.version}, generated ${pp.generatedAt}. When the rule runs it sets the issue property windtunnel.run so Wind Tunnel can report live runs and possible human corrections.`,
    ]),
    heading('Rule JSON'),
    { type: 'codeBlock', attrs: { language: 'json' }, content: [{ type: 'text', text: JSON.stringify(rule, null, 2) }] },
  ];
  const issue = await call(asUser(), route`/rest/api/3/issue`, {
    method: 'POST',
    body: { fields: { project: { key: targetProject }, issuetype: { name: 'Task' }, summary: `Automate: ${c.sentence}`.slice(0, 254), description: { type: 'doc', version: 1, content } } },
  });
  await attachJson(issue.key, `wind-tunnel-${choreId.replace(/[^a-z0-9]+/gi, '-')}-v${c.version}.json`, rule).catch(() => null); // JSON is also in the description
  await attachJson(issue.key, `wind-tunnel-passport-${choreId.replace(/[^a-z0-9]+/gi, '-')}-v${c.version}.json`, pp).catch(() => null); // passport is also in the description
  await db.addHandoff(projectKey, choreId, c.version, issue.key);
  await db.setChoreStatus(projectKey, choreId, 'handed_off');
  return { understood, created: true, key: issue.key };
}

async function attachJson(issueKey: string, filename: string, json: NativeExport | Passport) {
  const form = new FormData();
  form.append('file', new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), filename);
  const r = await asUser().requestJira(route`/rest/api/3/issue/${issueKey}/attachments`, { method: 'POST', headers: { 'X-Atlassian-Token': 'no-check' }, body: form as unknown as string });
  if (!r.ok) throw new Error(`attach ${r.status}`);
}

