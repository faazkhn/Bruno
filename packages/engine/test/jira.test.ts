import { describe, expect, test } from 'vitest';
import { fromJira, AUTOMATION_FOR_JIRA, type RawHistory } from '../src/jira';

const hash = (id: string) => `h(${id})`;
const agent = { accountId: 'agent-1', accountType: 'atlassian' };
const cust = { accountId: 'cust-1', accountType: 'customer' };

const cloudIssue = {
  id: '100',
  key: 'WT-7',
  fields: {
    project: { key: 'WT' },
    created: '2026-11-22T10:00:00.000+0000',
    summary: 'Question about my invoice',
    description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Finance flagged it' }] }] },
    status: { id: '3' },
    priority: { id: '1' },
    issuetype: { id: '10007' },
    resolution: null,
    assignee: null,
    reporter: cust,
    creator: agent,
    labels: ['cleanup', 'follow-up'],
    components: [{ id: '10132' }],
    customfield_10010: { requestType: { id: '339' } },
    customfield_10002: [{ id: '4' }],
  },
};
const cloudHistories: RawHistory[] = [
  { id: '2', created: '2026-11-22T10:30:00.000+0000', author: agent, items: [{ field: 'Request Type', fieldId: 'customfield_10010', from: '320', to: '339' }] },
  {
    id: '3',
    created: '2026-11-22T11:00:00.000+0000',
    author: agent,
    items: [
      { field: 'Component', fieldId: 'components', from: null, to: '10132' },
      { field: 'labels', fieldId: 'labels', fromString: 'follow-up', toString: 'cleanup follow-up' },
    ],
  },
  { id: '4', created: '2026-11-22T12:00:00.000+0000', author: { accountId: AUTOMATION_FOR_JIRA, accountType: 'app' }, items: [{ field: 'status', fieldId: 'status', from: '10004', to: '3' }] },
];
const cloudComments = [
  { id: 'c1', created: '2026-11-22T11:30:00.000+0000', author: cust, jsdPublic: true },
  { id: 'c2', created: '2026-11-22T11:45:00.000+0000', author: agent, jsdPublic: false },
];
const opts = { hash, fieldIds: { requestType: 'customfield_10010', organizations: 'customfield_10002' } };

describe('fromJira (Cloud)', () => {
  const rec = fromJira(cloudIssue, cloudHistories, cloudComments, opts);

  test('current values are ids, multi-value fields are sorted sets', () => {
    expect(rec.current).toMatchObject({
      status: '3',
      priority: '1',
      requestType: '339',
      organizations: '4',
      labels: 'cleanup,follow-up',
      components: '10132',
      assignee: null,
    });
    expect(rec.text).toEqual({ summary: 'Question about my invoice', description: 'Finance flagged it' });
  });

  test('events are ordered, first is created by the creator', () => {
    expect(rec.events.map((e) => [e.kind, e.field ?? null])).toEqual([
      ['created', null],
      ['field', 'requestType'],
      ['field', 'components'],
      ['field', 'labels'],
      ['comment', 'public'],
      ['comment', 'internal'],
      ['field', 'status'],
    ]);
    expect(rec.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rec.events[0]).toMatchObject({ actorKind: 'human_agent', actorHash: 'h(agent-1)', ts: Date.parse('2026-11-22T10:00:00Z') });
  });

  test('delta components become full sets; label strings become sets', () => {
    expect(rec.events[2]).toMatchObject({ field: 'components', from: null, to: '10132' });
    expect(rec.events[3]).toMatchObject({ field: 'labels', from: 'follow-up', to: 'cleanup,follow-up' });
  });

  test('actor kinds: customer, human agent, Automation for Jira', () => {
    expect(rec.events[4]!.actorKind).toBe('customer');
    expect(rec.events[5]!.actorKind).toBe('human_agent');
    expect(rec.events[6]!.actorKind).toBe('automation');
    expect(rec.reporterHash).toBe('h(cust-1)');
  });

  test('other apps are app, not automation', () => {
    const h: RawHistory[] = [{ id: '9', created: '2026-11-22T13:00:00.000+0000', author: { accountId: 'x', accountType: 'app' }, items: [{ field: 'priority', fieldId: 'priority', from: '2', to: '1' }] }];
    expect(fromJira(cloudIssue, h, [], opts).events.at(-1)!.actorKind).toBe('app');
  });
});

describe('fromJira (Server/DC, Apache-style)', () => {
  const issue = {
    id: '1',
    key: 'ZK-1',
    fields: {
      project: { key: 'ZK' },
      created: '2008-06-06T22:02:18.000+0000',
      summary: 'Initial code',
      description: 'plain text',
      status: { id: '5' },
      priority: { id: '3' },
      issuetype: { id: '1' },
      resolution: { id: '1' },
      assignee: { name: 'bob', key: 'bob' },
      reporter: { name: 'ann', key: 'ann' },
      labels: [],
      components: [{ id: '20' }, { id: '21' }],
      fixVersions: [{ id: '7' }],
    },
  };
  const histories: RawHistory[] = [
    { id: '11', created: '2008-06-07T10:00:00.000+0000', author: { name: 'ann', key: 'ann' }, items: [{ field: 'Component', from: null, to: '20' }, { field: 'Component', from: null, to: '21' }] },
    { id: '12', created: '2008-06-08T10:00:00.000+0000', author: { name: 'bob', key: 'bob' }, items: [{ field: 'status', from: '1', to: '5' }, { field: 'resolution', from: null, to: '1' }, { field: 'Fix Version', from: null, to: '7' }, { field: 'Attachment', from: null, to: '99' }] },
  ];
  const rec = fromJira(issue, histories, [], { hash });

  test('maps display-name fields, ignores unmodelled ones', () => {
    expect(rec.events.filter((e) => e.kind === 'field').map((e) => e.field)).toEqual(['components', 'components', 'status', 'resolution', 'fixVersions']);
  });

  test('two component adds in one history chain into sets', () => {
    const [a, b] = rec.events.filter((e) => e.field === 'components');
    expect(a).toMatchObject({ from: null, to: '20' });
    expect(b).toMatchObject({ from: '20', to: '20,21' });
  });

  test('server authors without accountType are human agents; missing author is automation', () => {
    expect(rec.events[1]!.actorKind).toBe('human_agent');
    const anon = fromJira(issue, [{ id: '13', created: '2008-06-09T10:00:00.000+0000', items: [{ field: 'priority', from: '3', to: '2' }] }], [], { hash });
    expect(anon.events.at(-1)!.actorKind).toBe('automation');
    expect(rec.current.assignee).toBe('bob');
  });

  test('delta anomalies are counted, not thrown', () => {
    const bad: RawHistory[] = [{ id: '14', created: '2008-06-07T10:00:00.000+0000', author: { name: 'ann' }, items: [{ field: 'Component', from: null, to: '99' }] }];
    expect(fromJira(issue, bad, [], { hash }).anomalies).toEqual({ components: 1 });
  });
});

test('a label item without toString yields an empty set, not the inherited function', () => {
  const h: RawHistory[] = [{ id: '5', created: '2026-11-22T13:00:00.000+0000', author: agent, items: [{ field: 'labels', fieldId: 'labels', fromString: 'cleanup follow-up' }] }];
  expect(fromJira(cloudIssue, h, [], opts).events.at(-1)).toMatchObject({ from: 'cleanup,follow-up', to: null });
});

test('delta items whose id was renumbered (migrated site) resolve by display name, counted as remaps', () => {
  const issue = {
    id: '9', key: 'SP-1',
    fields: { project: { key: 'SP' }, created: '2013-07-05T14:11:50.000+0000', summary: 's', fixVersions: [{ id: '12326677', name: '0.8.0' }], components: [] },
  };
  const h: RawHistory[] = [{ id: '1', created: '2013-12-07T00:00:00.000+0000', author: { name: 'x' }, items: [{ field: 'Fix Version', from: null, to: '10500', toString: '0.8.0' }] }];
  const rec = fromJira(issue, h, [], { hash });
  expect(rec.anomalies).toEqual({});
  expect(rec.remaps).toBe(1);
  expect(rec.events.at(-1)).toMatchObject({ field: 'fixVersions', from: null, to: '12326677' });
});

test('description edits are recorded so later text never leaks into trigger-time facts', () => {
  const h: RawHistory[] = [{ id: '6', created: '2026-11-22T14:00:00.000+0000', author: agent, items: [{ field: 'description', fieldId: 'description', fromString: 'a', toString: 'b' }] }];
  expect(fromJira(cloudIssue, h, [], opts).descriptionEdits).toEqual([Date.parse('2026-11-22T14:00:00Z')]);
});

test('bulk changelog timestamps arrive as epoch ms numbers and are accepted', () => {
  const ms = Date.parse('2026-11-22T10:30:00Z');
  const h = [{ id: '7', created: ms, author: agent, items: [{ field: 'priority', fieldId: 'priority', from: '3', to: '1' }] }] as unknown as RawHistory[];
  expect(fromJira(cloudIssue, h, [], opts).events.at(-1)!.ts).toBe(ms);
});
