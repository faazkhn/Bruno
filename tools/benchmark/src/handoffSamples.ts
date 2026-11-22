/** Writes importable rule JSON for the chores test B recovers, with the WT demo project's real ids (test D material). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { analyse, DEFAULT_SETTINGS, sentence, toNativeRule } from '@wind-tunnel/engine';
import { BOT_CONFIG, SIM_IDS, simulateHistory } from '@wind-tunnel/engine/sim';

const OUT = new URL('../../../docs/handoff-samples/', import.meta.url).pathname;
const now = Date.parse('2026-12-06T00:00:00Z');
const result = analyse(simulateHistory(BOT_CONFIG, { days: 90, seed: 2026, end: now }), DEFAULT_SETTINGS, now);
// WT ids from tools/history-bot setup (projectId 10202; Billing 339, Network 10132, In Progress 3); org names resolve in JQL
const flip = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));
const ctx = {
  projectId: '10202', projectTypeKey: 'service_desk', fieldIds: { requestType: 'customfield_10010', organizations: 'customfield_10002' },
  names: { values: { requestType: flip(SIM_IDS.requestType), components: flip(SIM_IDS.components), priority: flip(SIM_IDS.priority), status: flip(SIM_IDS.status), organizations: flip(SIM_IDS.organizations) } },
};
mkdirSync(OUT, { recursive: true });
for (const c of result.chores.filter((x) => x.verdict === 'proven')) {
  const name = `Wind Tunnel: ${sentence(c, ctx.names)}`;
  writeFileSync(`${OUT}${c.id.replace(/[^a-z0-9]+/gi, '-')}.json`, JSON.stringify(toNativeRule(c, name.slice(0, 255), ctx), null, 2) + '\n');
  console.log(name);
}
