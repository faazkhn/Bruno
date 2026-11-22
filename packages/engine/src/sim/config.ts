/**
 * Published history-bot behaviour (PRD §17). The live bot and the synthetic
 * history for test B both read this, so judges can see exactly what was planted.
 */
export interface Topic {
  id: string;
  weight: number;
  summaries: string[];
  descriptions: string[];
}

export interface PlantedChore {
  id: string;
  /** Topic whose requests get the action. 'customer-reply' is driven by a customer comment instead. */
  topic: string | null;
  kind: ActionKind;
  value: string;
  probability: number;
  minDelayMs: number;
  maxDelayMs: number;
  /** false = the single live account cannot produce it; synthetic history only. */
  live: boolean;
}

export type ActionKind = 'setRequestType' | 'setComponent' | 'setPriority' | 'addLabel' | 'transition' | 'customerComment';

export interface SimConfig {
  requestsPerDay: number;
  orgs: { name: string; domain: string; customers: number }[];
  vipOrg: string;
  topics: Topic[];
  chores: PlantedChore[];
  /** most requests use these; topic descriptions only sometimes (so descriptions don't give the topic away) */
  genericDescriptions: string[];
  topicDescriptionRate: number;
  noiseRate: number;
  customerReplyRate: number;
  bulkEditEveryDays: number;
  bulkEditSize: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export const BOT_CONFIG: SimConfig = {
  requestsPerDay: 120,
  orgs: [
    { name: 'Acme', domain: 'acme.example', customers: 10 },
    { name: 'Globex', domain: 'globex.example', customers: 8 },
    { name: 'Umbrella', domain: 'umbrella.example', customers: 7 },
    { name: 'Initech', domain: 'initech.example', customers: 5 },
  ],
  vipOrg: 'Initech',
  topics: [
    {
      id: 'invoice',
      weight: 0.22,
      summaries: ['Invoice {n} looks wrong', 'Question about my invoice', 'Duplicate charge on invoice {n}', 'Need a copy of invoice {n}', 'Invoice not received this month'],
      descriptions: ['Hi, can you check this for me?', 'Our finance team flagged it.', 'Please advise, thanks.'],
    },
    {
      id: 'refund',
      weight: 0.04,
      summaries: ['Refund request for last month', 'Charged twice, need refund'],
      descriptions: ['The amount on my invoice is higher than agreed.', 'Please refund the extra charge.'],
    },
    {
      id: 'vpn',
      weight: 0.15,
      summaries: ['VPN keeps disconnecting', "Can't connect to VPN from home", 'VPN client error 809', 'VPN very slow today'],
      descriptions: ['Started this morning.', 'Tried restarting, no luck.', 'Working remotely this week.'],
    },
    {
      id: 'outage',
      weight: 0.08,
      summaries: ['Email is down', 'Shared drive outage', 'Website down for our team', 'Outage: cannot log in to portal'],
      descriptions: ['Whole team affected.', 'Urgent, customers are waiting.'],
    },
    {
      id: 'generic',
      weight: 0.51,
      summaries: ['Laptop running slow', 'Password reset please', 'Need access to the sales folder', 'Install design software', 'Printer on floor 3 jammed', 'New starter needs an account', 'Monitor flickering'],
      descriptions: ['Thanks in advance.', 'When you get a chance.', 'Details attached.', 'This is blocking my work.'],
    },
  ],
  chores: [
    { id: 'billing', topic: 'invoice', kind: 'setRequestType', value: 'Billing', probability: 0.85, minDelayMs: 5 * MIN, maxDelayMs: 2 * HOUR, live: true },
    { id: 'vpn-network', topic: 'vpn', kind: 'setComponent', value: 'Network', probability: 0.85, minDelayMs: 5 * MIN, maxDelayMs: 1 * HOUR, live: true },
    { id: 'outage-priority', topic: 'outage', kind: 'setPriority', value: 'Highest', probability: 0.8, minDelayMs: 2 * MIN, maxDelayMs: 30 * MIN, live: true },
    { id: 'customer-reply', topic: null, kind: 'transition', value: 'In Progress', probability: 0.85, minDelayMs: 10 * MIN, maxDelayMs: 3 * HOUR, live: false },
  ],
  genericDescriptions: ['Thanks in advance.', 'When you get a chance.', 'Details attached.', 'This is blocking my work.', 'Started this morning.', 'Please advise, thanks.', 'Urgent please.', 'Whole team affected.'],
  topicDescriptionRate: 0.3,
  noiseRate: 0.07,
  customerReplyRate: 0.3,
  bulkEditEveryDays: 7,
  bulkEditSize: 10,
};
