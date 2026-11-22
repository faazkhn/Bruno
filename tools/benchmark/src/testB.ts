/**
 * Test B — miner recovery (PRD §16) on synthetic history generated from the published
 * history-bot config (BOT_CONFIG), 90 days, 4 agents, seed 2026. Writes docs/accuracy.md section B.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { analyse, applyExclusion, DEFAULT_SETTINGS, findExceptions, toJql, triggerKey, type Chore } from '@wind-tunnel/engine';
import { BOT_CONFIG, SIM_IDS, simulateHistory } from '@wind-tunnel/engine/sim';

const ROOT = new URL('../../../', import.meta.url).pathname;
const SEED = 2026;
const DAYS = 90;
const now = Date.parse('2026-12-06T00:00:00Z');
const issues = simulateHistory(BOT_CONFIG, { days: DAYS, seed: SEED, end: now });
const t0 = performance.now();
const result = analyse(issues, DEFAULT_SETTINGS, now);
const ms = Math.round(performance.now() - t0);

const planted = [
  { id: 'billing', chore: `set:requestType:${SIM_IDS.requestType.Billing}`, trigger: 'created', must: ['invoice'] },
  { id: 'vpn-network', chore: `add:components:${SIM_IDS.components.Network}`, trigger: 'created', must: ['vpn'] },
  { id: 'outage-priority', chore: `set:priority:${SIM_IDS.priority.Highest}`, trigger: 'created', must: ['outage', 'down'] },
  { id: 'customer-reply', chore: `transition:status:${SIM_IDS.status['In Progress']}`, trigger: 'customerCommented', must: [] },
];
const pct = (x: number) => (100 * x).toFixed(1) + '%';
const jql = (c: Chore) => c.clauses.map((x) => toJql(x)).join(' AND ') || '(no conditions)';
const v2 = (c: Chore) => {
  const ex = findExceptions(c, issues, result.window, DEFAULT_SETTINGS);
  return ex.suggestion ? applyExclusion(c, ex.suggestion.clause, issues, result.window, DEFAULT_SETTINGS) : null;
};
const after = (c: Chore) => {
  const x = v2(c);
  return x ? `${toJql(x.clauses.at(-1)!)} → ${x.proof.tp} / ${x.proof.tp + x.proof.fp}, ${pct(x.proof.precision)}, ${x.verdict}` : '—';
};
const row = (c: Chore) => `${triggerKey(c.trigger)} | ${jql(c)} | ${c.proof.tp} / ${c.proof.tp + c.proof.fp} | ${pct(c.proof.precision)} | ${pct(c.proof.recall)} | ${pct(c.proof.coverage)} | ${c.verdict} (${c.risk} risk) | ${after(c)}`;

let recovered = 0;
const rows = planted.map((p) => {
  const c = result.chores.find((x) => x.id === p.chore);
  const ok = !!c && triggerKey(c.trigger) === p.trigger && p.must.every((w) => jql(c).includes(`"${w}"`));
  if (ok) recovered++;
  return `| ${p.id} | ${ok ? '✅' : '❌'} | ${c ? row(c) : '— not found — | | | | | | |'} |`;
});
const extra = result.chores.filter((c) => !planted.some((p) => p.chore === c.id));
const date = new Date().toISOString().slice(0, 10);
const section = `## Test B — miner recovery (run ${date})

History: ${issues.length} requests, ${issues.reduce((n, i) => n + i.events.length, 0)} events, ${DAYS} days generated from the published bot config (\`packages/engine/src/sim/config.ts\`, seed ${SEED}; 4 agents incl. a senior who handles VIP Initech differently, real customer comments, 7% noise, weekly bulk edits). Learn ${new Date(result.window.start).toISOString().slice(0, 10)} → ${new Date(result.window.cut).toISOString().slice(0, 10)}, holdout → ${new Date(result.window.end).toISOString().slice(0, 10)}. Analysis took ${ms} ms.

A planted chore counts as recovered when the miner finds the same action, the same trigger and conditions containing the planted keyword(s).

**Result: ${recovered} / ${planted.length} planted chores recovered (${pct(recovered / planted.length)})** (pass bar ≥ 90%) — ${recovered / planted.length >= 0.9 ? 'PASS' : 'FAIL'}

| Planted | Recovered | Trigger | Learned conditions | Holdout agreed / would act | Precision | Recall | Coverage | Verdict v1 | After the exclusion learned on the learning period (re-proved on the untouched holdout) |
|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

Precision is measured over every moment the rule could act on the holdout (not only items people changed), and it is agreement with what the team did, not proof the team was right. "Proven" needs ≥ 80% precision for low-risk changes (labels, components, request type) and ≥ 85% for medium (priority, assignee, status); closing/resolving work is never recommended. Exceptions are learned on the learning period only, so the re-proof stays an unbiased test. The bot plants ~15% deviations, so even a perfect rule can't reach 100%. Recall counts every human action in the holdout, including ones with no trigger before them.

Other chores the miner reported that are not in the planted list (e.g. the senior agent's VIP habit is a real pattern in this history), ${extra.length}:

| Chore | Trigger | Conditions | Holdout agreed / would act | Precision | Recall | Coverage | Verdict v1 | After learned exclusion |
|---|---|---|---|---|---|---|---|---|
${extra.map((c) => `| ${c.id} | ${row(c)} |`).join('\n') || '| — | | | | | | | | |'}

Not automatable (no trigger within the rules): ${result.unexplained.map((u) => `${u.id} (${u.count}, ${u.reason})`).join(', ') || 'none'}.

Reproduce: \`pnpm --filter benchmark test-b\`.
`;
const ACC = `${ROOT}docs/accuracy.md`;
const prev = existsSync(ACC) ? readFileSync(ACC, 'utf8') : '# Accuracy (PRD §16)\n\n';
writeFileSync(ACC, prev.includes('## Test B') ? prev.replace(/## Test B[\s\S]*?(?=\n## |$)/, section) : prev + '\n' + section);
console.log(`test B: ${recovered}/${planted.length} recovered, ${extra.length} extra chores, ${ms} ms`);
