/** Raw Jira REST JSON (Cloud v3 or Server/DC v2) → IssueRecord. Pure, no I/O. */
import { fromSet, toSet, type ActorKind, type Event, type IssueRecord } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
type RawUser = { accountId?: string; accountType?: string; key?: string; name?: string } | null | undefined;
export type RawIssue = { id: string; key: string; fields: Record<string, any> };
// `toString` is a real changelog key; read it as an own property, never the inherited Object.prototype.toString
export type RawItem = { field: string; fieldId?: string; from?: string | null; to?: string | null; fromString?: string | null; toString?: unknown };
const toStr = (it: RawItem): string | null => (Object.hasOwn(it, 'toString') && typeof it.toString === 'string' ? it.toString : null);
export type RawHistory = { id: string; created: string | number; author?: RawUser; items: RawItem[] };
export type RawComment = { id: string; created: string | number; author?: RawUser; jsdPublic?: boolean };

export const AUTOMATION_FOR_JIRA = '557058:f58131cb-b67d-43c7-b30d-6b58d40bd077';

export interface FromJiraOptions {
  hash: (id: string) => string;
  /** canonical name → site field id, for JSM custom fields */
  fieldIds?: { requestType?: string; organizations?: string };
  automationIds?: string[];
}

const NAME_MAP: Record<string, string> = {
  status: 'status', priority: 'priority', resolution: 'resolution', issuetype: 'issuetype', 'issue type': 'issuetype',
  assignee: 'assignee', labels: 'labels', component: 'components', components: 'components',
  'fix version': 'fixVersions', fixversions: 'fixVersions', summary: 'summary', 'request type': 'requestType', organizations: 'organizations',
};
const DELTA = new Set(['components', 'fixVersions']);

/** Jira returns ISO strings from most endpoints but epoch ms from changelog/bulkfetch. */
const time = (v: string | number) => (typeof v === 'number' ? v : Date.parse(v));
const userId = (u: RawUser) => u?.accountId ?? u?.key ?? u?.name ?? null;
const idsOf = (xs: any[] | null | undefined) => fromSet((xs ?? []).map((x) => String(x.id)));
const bracketIds = (s: string | null | undefined) => (s ?? '').match(/[^[\],\s]+/g) ?? [];

function adfText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(adfText).filter(Boolean).join(' ');
}

export function fromJira(issue: RawIssue, histories: RawHistory[], comments: RawComment[], opts: FromJiraOptions): IssueRecord {
  const f = issue.fields;
  const automation = new Set(opts.automationIds ?? [AUTOMATION_FOR_JIRA]);
  const byFieldId: Record<string, string> = {};
  if (opts.fieldIds?.requestType) byFieldId[opts.fieldIds.requestType] = 'requestType';
  if (opts.fieldIds?.organizations) byFieldId[opts.fieldIds.organizations] = 'organizations';
  const reporter = userId(f.reporter);

  const current: Record<string, string | null> = {
    status: f.status?.id ?? null,
    priority: f.priority?.id ?? null,
    resolution: f.resolution?.id ?? null,
    issuetype: f.issuetype?.id ?? null,
    assignee: userId(f.assignee),
    labels: fromSet(f.labels ?? []),
    components: idsOf(f.components),
    fixVersions: idsOf(f.fixVersions),
    summary: f.summary ?? null,
    requestType: opts.fieldIds?.requestType ? (f[opts.fieldIds.requestType]?.requestType?.id ?? null) : null,
    organizations: opts.fieldIds?.organizations ? idsOf(f[opts.fieldIds.organizations]) : null,
  };

  const kindOf = (u: RawUser, isComment: boolean): ActorKind => {
    if (!u) return 'automation';
    if (u.accountType === 'app') return automation.has(u.accountId ?? '') ? 'automation' : 'app';
    if (u.accountType === 'customer') return 'customer';
    if (isComment && reporter && userId(u) === reporter) return 'customer';
    return 'human_agent';
  };
  const actor = (u: RawUser, isComment = false) => ({ actorKind: kindOf(u, isComment), actorHash: opts.hash(userId(u) ?? 'system') });

  type Raw = { ts: number; ev: Omit<Event, 'seq'>; item?: RawItem };
  const raws: Raw[] = [];
  const descriptionEdits: number[] = [];
  const sortedHist = [...histories].sort((a, b) => time(a.created) - time(b.created) || Number(a.id) - Number(b.id));
  for (const h of sortedHist) {
    const ts = time(h.created);
    for (const item of h.items) {
      if (item.field.toLowerCase() === 'description') descriptionEdits.push(ts);
      const field = (item.fieldId && byFieldId[item.fieldId]) || NAME_MAP[item.field.toLowerCase()];
      if (!field) continue;
      raws.push({ ts, item, ev: { issueId: issue.id, ts, kind: 'field', field, ...actor(h.author) } });
    }
  }
  for (const c of comments) {
    const ts = time(c.created);
    raws.push({ ts, ev: { issueId: issue.id, ts, kind: 'comment', field: c.jsdPublic === false ? 'internal' : 'public', ...actor(c.author, true) } });
  }
  raws.sort((a, b) => a.ts - b.ts); // stable: changelog order kept on ties, comments after field items

  // from/to values: walk backwards from current so delta fields become full sets
  const anomalies: Record<string, number> = {};
  const miss = (f: string) => (anomalies[f] = (anomalies[f] ?? 0) + 1);
  let remaps = 0;
  const nameToId: Record<string, Record<string, string>> = {
    components: Object.fromEntries((f.components ?? []).map((x: any) => [x.name, String(x.id)])),
    fixVersions: Object.fromEntries((f.fixVersions ?? []).map((x: any) => [x.name, String(x.id)])),
  };
  const state: Record<string, string | null> = { ...current };
  for (let i = raws.length - 1; i >= 0; i--) {
    const { ev, item } = raws[i]!;
    if (!item || !ev.field) continue;
    const field = ev.field;
    if (DELTA.has(field)) {
      const after = new Set(toSet(state[field]));
      const before = new Set(after);
      if (item.to && !before.delete(item.to)) {
        const renumbered = nameToId[field]?.[toStr(item) ?? ''];
        if (renumbered && before.delete(renumbered)) remaps++;
        else miss(field);
      }
      if (item.from) { if (before.has(item.from)) miss(field); before.add(item.from); }
      ev.from = fromSet(before);
      ev.to = fromSet(after);
    } else if (field === 'labels') {
      ev.from = fromSet((item.fromString ?? '').split(/\s+/));
      ev.to = fromSet((toStr(item) ?? '').split(/\s+/));
    } else if (field === 'organizations') {
      ev.from = fromSet(bracketIds(item.from ?? item.fromString));
      ev.to = fromSet(bracketIds(item.to ?? toStr(item)));
    } else if (field === 'summary') {
      ev.from = item.fromString ?? null;
      ev.to = toStr(item);
    } else {
      ev.from = item.from ?? null;
      ev.to = item.to ?? null;
    }
    state[field] = ev.from ?? null;
  }

  const createdAt = Date.parse(f.created);
  const events: Event[] = [
    { issueId: issue.id, ts: createdAt, seq: 0, kind: 'created', ...actor(f.creator ?? f.reporter) },
    ...raws.map((r, i) => ({ ...r.ev, seq: i + 1 })),
  ];
  return {
    id: issue.id,
    key: issue.key,
    projectKey: f.project?.key ?? issue.key.split('-')[0]!,
    createdAt,
    current,
    text: { summary: f.summary ?? '', description: adfText(f.description) },
    reporterHash: opts.hash(reporter ?? 'unknown'),
    events,
    anomalies,
    remaps,
    descriptionEdits,
  };
}
