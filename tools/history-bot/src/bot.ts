/**
 * One bot tick (run every 15 min by launchd). Executes due jobs from the
 * deterministic plan; state in data/state.json makes restarts safe.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BOT_CONFIG, customersOf, type PlannedAction } from '@wind-tunnel/engine/sim';
import { Jira } from './jira';
import { dueJobs } from './schedule';

import { DATA_DIR, loadSite, type SiteIds } from './setup';

const STATE = `${DATA_DIR}/state.json`;
const TRUTH = `${DATA_DIR}/ground-truth.jsonl`;
const SEED = 2026;
const MAX_JOBS_PER_TICK = 60;

interface State {
  startMidnight: number;
  startedAt: number;
  done: string[];
  keys: Record<string, string>; // requestId → issue key
}

function loadState(now: number): State {
  if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, 'utf8'));
  const m = new Date(now);
  return { startMidnight: new Date(m.getFullYear(), m.getMonth(), m.getDate()).getTime(), startedAt: now, done: [], keys: {} };
}

async function act(jira: Jira, site: SiteIds, key: string, a: PlannedAction) {
  switch (a.kind) {
    case 'setRequestType':
      return jira.put(`/rest/api/3/issue/${key}`, { fields: { customfield_10010: site.requestTypes[a.value] } });
    case 'setComponent':
      return jira.put(`/rest/api/3/issue/${key}`, { update: { components: [{ add: { name: a.value } }] } });
    case 'setPriority':
      return jira.put(`/rest/api/3/issue/${key}`, { fields: { priority: { name: a.value } } });
    case 'addLabel':
      return jira.put(`/rest/api/3/issue/${key}`, { update: { labels: [{ add: a.value }] } });
    case 'transition': {
      const { transitions } = await jira.get(`/rest/api/3/issue/${key}/transitions`);
      const t = (transitions as { id: string; to: { name: string } }[]).find((x) => x.to.name.toLowerCase() === a.value.toLowerCase());
      if (!t) return 'no-transition';
      return jira.post(`/rest/api/3/issue/${key}/transitions`, { transition: { id: t.id } });
    }
    default:
      return 'skipped';
  }
}

async function main() {
  const now = Date.now();
  const jira = Jira.fromEnv();
  const site = loadSite();
  const state = loadState(now);
  const done = new Set(state.done);
  const customers = customersOf();
  const jobs = dueJobs(BOT_CONFIG, state.startMidnight, state.startedAt, now, done, SEED).slice(0, MAX_JOBS_PER_TICK);
  let ok = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      let key = state.keys[job.requestId];
      let result: unknown = null;
      if (job.type === 'create') {
        const c = customers[job.request.customer]!;
        const accountId = site.customers.find((x) => x.email === c.email)!.accountId;
        const r = await jira.post('/rest/servicedeskapi/request', {
          serviceDeskId: site.serviceDeskId,
          requestTypeId: site.defaultRequestType,
          // org set at creation so it is a creation-time fact, not a later 'human edit'
          requestFieldValues: { summary: job.request.summary, description: job.request.description, customfield_10002: [Number(site.orgs[job.request.org])] },
          raiseOnBehalfOf: accountId,
        });
        key = state.keys[job.requestId] = r.issueKey;
      } else if (key) {
        result = await act(jira, site, key, job.action);
      }
      done.add(job.id);
      ok++;
      appendFileSync(
        TRUTH,
        JSON.stringify({
          ts: new Date().toISOString(),
          dueAt: new Date(job.dueAt).toISOString(),
          key,
          job: job.id,
          ...(job.type === 'create'
            ? { type: 'create', org: job.request.org, topic: job.request.topic, summary: job.request.summary }
            : { type: 'action', kind: job.action.kind, value: job.action.value, planted: job.action.planted, bulk: !!job.action.bulk, result: typeof result === 'string' ? result : 'ok' }),
        }) + '\n',
      );
    } catch (e) {
      failed++;
      console.error(`job ${job.id} failed: ${String(e).slice(0, 300)}`);
      if (failed >= 5) break; // site trouble: stop this tick, retry next one
    }
  }
  // keep state small: forget done ids older than 3 plan days
  const today = Math.floor((now - state.startMidnight) / 86_400_000);
  state.done = [...done].filter((id) => Number(id.split(':')[0]) >= today - 3);
  writeFileSync(STATE, JSON.stringify(state));
  console.log(`${new Date(now).toISOString()} tick: ${ok} ok, ${failed} failed, ${jobs.length} due`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
