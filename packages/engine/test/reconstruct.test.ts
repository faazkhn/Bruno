import { expect, test } from 'vitest';
import type { Event, IssueRecord } from '../src/model';
import { reconstructionCheck } from '../src/reconstruct';

const ev = (seq: number, field: string, from: string | null, to: string | null): Event => ({
  issueId: '1', ts: seq * 10, seq, actorKind: 'human_agent', actorHash: 'a', kind: 'field', field, from, to,
});
const base = (events: Event[], current: Record<string, string | null>, anomalies: Record<string, number> = {}): IssueRecord => ({
  id: '1', key: 'T-1', projectKey: 'T', createdAt: 0, reporterHash: 'r', anomalies, remaps: 0, text: { summary: '', description: '' }, current,
  events: [{ issueId: '1', ts: 0, seq: 0, actorKind: 'customer', actorHash: 'r', kind: 'created' }, ...events],
});

test('consistent history: every forward value agrees with the backward rebuild', () => {
  const r = reconstructionCheck(base([ev(1, 'status', '1', '3'), ev(2, 'status', '3', '5'), ev(3, 'priority', '2', '1')], { status: '5', priority: '1' }));
  expect(r).toMatchObject({ checks: 3, agree: 3, misses: [] });
});

test('a gap in the changelog shows up as a miss on that field', () => {
  // status went 3 → ? → 5 but the middle change is missing: event 2 says from 4
  const r = reconstructionCheck(base([ev(1, 'status', '1', '3'), ev(2, 'status', '4', '5')], { status: '5' }));
  expect(r.checks).toBe(2);
  expect(r.agree).toBe(1);
  expect(r.misses).toEqual([{ key: 'T-1', field: 'status', seq: 1, expected: '3', rebuilt: '4' }]);
});

test('last change disagreeing with current value is a miss', () => {
  const r = reconstructionCheck(base([ev(1, 'priority', '2', '1')], { priority: '3' }));
  expect(r.misses[0]).toMatchObject({ field: 'priority', expected: '1', rebuilt: '3' });
});

test('delta fields are scored by anomalies, not by our own derived values', () => {
  const r = reconstructionCheck(base([ev(1, 'components', null, '10')], { components: '10' }, { components: 2 }));
  expect(r.checks).toBe(3); // 1 delta event + 2 anomalies counted as checks
  expect(r.agree).toBe(1);
  expect(r.byField.components).toEqual({ checks: 3, agree: 1 });
});
