import { BOT_CONFIG, type ActionKind, type SimConfig } from './config';
import { pick, rng } from './rng';

export interface PlannedAction {
  /** ms after the request is created */
  afterMs: number;
  kind: ActionKind;
  value: string;
  /** planted chore id, or null for realistic noise / normal work */
  planted: string | null;
  bulk?: boolean;
}

export interface PlannedRequest {
  /** ms offset within the day */
  at: number;
  /** customer index, 0-based across all orgs */
  customer: number;
  org: string;
  topic: string;
  summary: string;
  description: string;
  actions: PlannedAction[];
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export function customersOf(config: SimConfig = BOT_CONFIG): { index: number; org: string; email: string; name: string }[] {
  let i = 0;
  return config.orgs.flatMap((o) =>
    Array.from({ length: o.customers }, (_, k) => {
      const n = String(++i).padStart(2, '0');
      return { index: i - 1, org: o.name, email: `customer${n}@${o.domain}`, name: `${o.name} Customer ${k + 1}` };
    }),
  );
}

export function planDay(config: SimConfig, dayIndex: number, seed: number): PlannedRequest[] {
  const r = rng(seed * 100_003 + dayIndex);
  const customers = customersOf(config);
  const count = Math.round(config.requestsPerDay * (0.85 + r() * 0.3));
  const between = (lo: number, hi: number) => lo + r() * (hi - lo);
  const out: PlannedRequest[] = [];

  for (let i = 0; i < count; i++) {
    // business-hours bias: 80% between 08:00 and 18:00
    const at = Math.floor(r() < 0.8 ? between(8 * HOUR, 18 * HOUR) : between(0, 24 * HOUR));
    const c = pick(r, customers);
    let roll = r();
    const topic = config.topics.find((t) => (roll -= t.weight) < 0) ?? config.topics[config.topics.length - 1]!;
    const n = String(1000 + Math.floor(r() * 9000));
    const summary = pick(r, topic.summaries).replace('{n}', n);
    const description = pick(r, topic.descriptions);
    const vip = c.org === config.vipOrg;
    const actions: PlannedAction[] = [];

    if (vip) {
      // realistic exception: a senior agent handles VIP requests by hand, differently
      actions.push({ afterMs: between(2 * MIN, 20 * MIN), kind: 'setPriority', value: 'High', planted: null });
    } else {
      for (const ch of config.chores) {
        if (ch.topic === topic.id && r() < ch.probability) {
          actions.push({ afterMs: between(ch.minDelayMs, ch.maxDelayMs), kind: ch.kind, value: ch.value, planted: ch.id });
        }
      }
      // humans also set Billing on some refunds without the keyword (gives honest misses)
      if (topic.id === 'refund' && r() < 0.5) {
        actions.push({ afterMs: between(10 * MIN, 3 * HOUR), kind: 'setRequestType', value: 'Billing', planted: null });
      }
      if (r() < config.noiseRate) {
        const noise = pick(r, [
          { kind: 'setPriority', value: pick(r, ['Low', 'High']) },
          { kind: 'addLabel', value: pick(r, ['follow-up', 'hardware', 'escalated']) },
          { kind: 'setComponent', value: 'Network' },
          { kind: 'setRequestType', value: 'Billing' },
        ] as const);
        actions.push({ afterMs: between(5 * MIN, 6 * HOUR), kind: noise.kind, value: noise.value, planted: null });
      }
    }

    if (r() < config.customerReplyRate) {
      const replyAt = between(3 * HOUR, 20 * HOUR);
      actions.push({ afterMs: replyAt, kind: 'customerComment', value: 'Any update on this?', planted: null });
      const reply = config.chores.find((ch) => ch.id === 'customer-reply');
      if (reply && !vip && r() < reply.probability) {
        actions.push({ afterMs: replyAt + between(reply.minDelayMs, reply.maxDelayMs), kind: reply.kind, value: reply.value, planted: reply.id });
      }
    }

    // most requests get resolved eventually (normal work, not a chore with a clear trigger)
    if (r() < 0.7) actions.push({ afterMs: between(20 * HOUR, 40 * HOUR), kind: 'transition', value: 'Resolved', planted: null });

    out.push({ at, customer: c.index, org: c.org, topic: topic.id, summary, description, actions });
  }

  out.sort((a, b) => a.at - b.at);

  if (config.bulkEditEveryDays > 0 && dayIndex % config.bulkEditEveryDays === config.bulkEditEveryDays - 1) {
    // one human bulk-labels a batch within seconds at 23:00 (PRD §17: some bulk edits)
    const bulkAt = 23 * HOUR;
    out.filter((q) => q.at < bulkAt).slice(0, config.bulkEditSize).forEach((q, k) => {
      q.actions.push({ afterMs: bulkAt - q.at + k * 1000, kind: 'addLabel', value: 'cleanup', planted: null, bulk: true });
    });
  }
  for (const q of out) q.actions.sort((a, b) => a.afterMs - b.afterMs);
  return out;
}
