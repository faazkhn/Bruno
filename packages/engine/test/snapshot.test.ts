import { expect, test } from 'vitest';
import type { Event, IssueRecord } from '../src/model';
import { snapshotAt, snapshotBefore, statusSince } from '../src/snapshot';

const ev = (seq: number, ts: number, field: string, from: string | null, to: string | null): Event => ({
  issueId: '1', ts, seq, actorKind: 'human_agent', actorHash: 'a', kind: 'field', field, from, to,
});
// created at 100: status 1, priority 3; at 200 status 1→3 and priority 3→2 (same history);
// at 300 status 3→5; at 300 labels null→x (same ts, later seq)
const issue: IssueRecord = {
  id: '1', key: 'T-1', projectKey: 'T', createdAt: 100, reporterHash: 'r', anomalies: {}, remaps: 0,
  text: { summary: 's', description: '' },
  current: { status: '5', priority: '2', labels: 'x', assignee: null },
  events: [
    { issueId: '1', ts: 100, seq: 0, actorKind: 'customer', actorHash: 'r', kind: 'created' },
    ev(1, 200, 'status', '1', '3'),
    ev(2, 200, 'priority', '3', '2'),
    { issueId: '1', ts: 250, seq: 3, actorKind: 'customer', actorHash: 'r', kind: 'comment', field: 'public' },
    ev(4, 300, 'status', '3', '5'),
    ev(5, 300, 'labels', null, 'x'),
  ],
};

test('before creation the item did not exist', () => {
  expect(snapshotAt(issue, 99)).toBeNull();
});

test('at creation: every later change undone', () => {
  expect(snapshotAt(issue, 100)).toEqual({ status: '1', priority: '3', labels: null, assignee: null });
});

test('an event at exactly t is included', () => {
  expect(snapshotAt(issue, 200)).toMatchObject({ status: '3', priority: '2' });
  expect(snapshotAt(issue, 299)).toMatchObject({ status: '3', labels: null });
  expect(snapshotAt(issue, 300)).toEqual(issue.current);
});

test('snapshotBefore excludes the event and later ones with the same ts', () => {
  expect(snapshotBefore(issue, issue.events[5]!)).toMatchObject({ status: '5', labels: null });
  expect(snapshotBefore(issue, issue.events[4]!)).toMatchObject({ status: '3', labels: null });
});

test('snapshot does not mutate current', () => {
  snapshotAt(issue, 100);
  expect(issue.current.status).toBe('5');
});

test('statusSince: time the status last changed at or before t', () => {
  expect(statusSince(issue, 150)).toBe(100);
  expect(statusSince(issue, 260)).toBe(200);
  expect(statusSince(issue, 400)).toBe(300);
});
