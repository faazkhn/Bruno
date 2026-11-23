/** Hand-off: a work item for the Jira admin with the rule JSON and its proof. */
import { asUser, route } from '@forge/api';
import { toNativeRule, type NativeExport } from '@wind-tunnel/engine';
import { call } from './jira';
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
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  const p = c.proof;
  const text = [
    `Rule: ${c.sentence}`,
    `Proof (holdout ${fmt(p.range.from)} → ${fmt(p.range.to)}, not used for learning or for choosing exclusions). This measures agreement with what the team did, not whether the team was right: the rule agreed with the team on ${p.tp} of ${p.tp + p.fp} times it would act (precision ${(p.precision * 100).toFixed(1)}%); people did it ${p.tp + p.fn} times, the rule would have caught ${p.tp} (recall ${(p.recall * 100).toFixed(1)}%); coverage ${(p.coverage * 100).toFixed(1)}%.`,
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

