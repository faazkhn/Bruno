/**
 * Synthetic history for test B: the same BOT_CONFIG as the live bot, but with
 * 4 agents and real customer comments (which the one live account can't produce).
 */
import { fromSet, toSet, type ActorKind, type Event, type IssueRecord } from '../model';
import type { SimConfig } from './config';
import { customersOf, planDay } from './plan';
import { pick, rng } from './rng';

/** Ids mirror the WT demo project where known (request types 320/339, component 10132); others are synthetic. */
export const SIM_IDS = {
  requestType: { 'Get IT help': '320', Billing: '339' } as Record<string, string>,
  components: { Network: '10132' } as Record<string, string>,
  priority: { Highest: '1', High: '2', Medium: '3', Low: '4' } as Record<string, string>,
  status: { 'Waiting for support': '10004', 'In Progress': '3', Resolved: '10005' } as Record<string, string>,
  organizations: { Acme: '1', Globex: '2', Umbrella: '3', Initech: '4' } as Record<string, string>,
  resolutionDone: '10000',
  issuetype: '10007',
};

const DAY = 86_400_000;
const AGENTS = ['sim:agent-1', 'sim:agent-2', 'sim:agent-3'];
const SENIOR = 'sim:agent-4';

export function simulateHistory(config: SimConfig, opts: { days: number; seed: number; end: number }): IssueRecord[] {
  const r = rng(opts.seed);
  const customers = customersOf(config);
  const start = opts.end - opts.days * DAY;
  const out: IssueRecord[] = [];
  let n = 0;

  for (let d = 0; d < opts.days; d++) {
    for (const req of planDay(config, d, opts.seed)) {
      const createdAt = start + d * DAY + req.at;
      if (createdAt >= opts.end) continue;
      const id = String(++n);
      const cust = customers[req.customer]!;
      const vip = req.org === config.vipOrg;
      const state: Record<string, string | null> = {
        status: SIM_IDS.status['Waiting for support']!, priority: SIM_IDS.priority.Medium!, resolution: null, issuetype: SIM_IDS.issuetype,
        assignee: null, labels: null, components: null, fixVersions: null, summary: req.summary,
        requestType: SIM_IDS.requestType['Get IT help']!, organizations: SIM_IDS.organizations[req.org]!,
      };
      const events: Event[] = [{ issueId: id, ts: createdAt, seq: 0, kind: 'created', actorKind: 'customer', actorHash: `sim:${cust.email}` }];
      const push = (ts: number, actorKind: ActorKind, actorHash: string, kind: Event['kind'], field: string, to?: string | null) => {
        const e: Event = { issueId: id, ts, seq: events.length, kind, actorKind, actorHash, field };
        if (kind === 'field') {
          e.from = state[field] ?? null;
          e.to = to ?? null;
          state[field] = e.to;
        }
        events.push(e);
      };
      for (const a of req.actions) {
        const ts = createdAt + a.afterMs;
        if (ts > opts.end) break;
        const who = vip ? SENIOR : a.bulk ? AGENTS[0]! : pick(r, AGENTS);
        switch (a.kind) {
          case 'customerComment': push(ts, 'customer', `sim:${cust.email}`, 'comment', 'public'); break;
          case 'setRequestType': push(ts, 'human_agent', who, 'field', 'requestType', SIM_IDS.requestType[a.value]); break;
          case 'setPriority': push(ts, 'human_agent', who, 'field', 'priority', SIM_IDS.priority[a.value]); break;
          case 'setComponent': if (!toSet(state.components).includes(SIM_IDS.components[a.value]!)) push(ts, 'human_agent', who, 'field', 'components', fromSet([...toSet(state.components), SIM_IDS.components[a.value]!])); break;
          case 'addLabel': if (!toSet(state.labels).includes(a.value)) push(ts, 'human_agent', who, 'field', 'labels', fromSet([...toSet(state.labels), a.value])); break;
          case 'transition':
            if (state.status === SIM_IDS.status[a.value]) break;
            push(ts, 'human_agent', who, 'field', 'status', SIM_IDS.status[a.value]);
            if (a.value === 'Resolved') push(ts, 'human_agent', who, 'field', 'resolution', SIM_IDS.resolutionDone);
            break;
        }
      }
      out.push({
        id, key: `SIM-${id}`, projectKey: 'SIM', createdAt, current: { ...state },
        text: { summary: req.summary, description: req.description }, reporterHash: `sim:${cust.email}`,
        events, anomalies: {}, remaps: 0,
      });
    }
  }
  return out;
}
