import { expect, test } from 'vitest';
import { actionOf, findCandidates } from '../src/candidates';
import type { Event, IssueRecord } from '../src/model';
import { DEFAULT_SETTINGS } from '../src/settings';

const issue = (id: string, events: Omit<Event, 'issueId' | 'seq'>[]): IssueRecord => ({
  id, key: `T-${id}`, projectKey: 'T', createdAt: 0, reporterHash: 'r', anomalies: {}, remaps: 0, text: { summary: '', description: '' }, current: {},
  events: [{ issueId: id, seq: 0, ts: 0, kind: 'created', actorKind: 'customer', actorHash: 'c' }, ...events.map((e, k) => ({ ...e, issueId: id, seq: k + 1 }))],
});
const set = (ts: number, who: string, field: string, from: string | null, to: string | null, actorKind: Event['actorKind'] = 'human_agent') =>
  ({ ts, actorKind, actorHash: who, kind: 'field' as const, field, from, to });

test('actionOf: set, add-to-set, transition; ignores non-humans and free text', () => {
  expect(actionOf({ ...set(1, 'a', 'requestType', '320', '339'), issueId: '1', seq: 1 })).toEqual([{ kind: 'set', field: 'requestType', value: '339' }]);
  expect(actionOf({ ...set(1, 'a', 'labels', 'x', 'vip,x,y'), issueId: '1', seq: 1 })).toEqual([{ kind: 'add', field: 'labels', value: 'vip' }, { kind: 'add', field: 'labels', value: 'y' }]);
  expect(actionOf({ ...set(1, 'a', 'status', '1', '3'), issueId: '1', seq: 1 })).toEqual([{ kind: 'transition', field: 'status', value: '3' }]);
  expect(actionOf({ ...set(1, 'a', 'summary', 'x', 'y'), issueId: '1', seq: 1 })).toEqual([]);
  expect(actionOf({ ...set(1, 'a', 'priority', '3', null), issueId: '1', seq: 1 })).toEqual([]);
  expect(actionOf({ ...set(1, 'a', 'priority', '3', '1', 'automation'), issueId: '1', seq: 1 })).toEqual([]);
});

const many = (n: number, people: string[], spacingMs = 3_600_000) =>
  Array.from({ length: n }, (_, i) => issue(String(i), [set(1000 + i * spacingMs, people[i % people.length]!, 'priority', '3', '1')]));
const range = { from: 0, to: Number.MAX_SAFE_INTEGER };

test('keeps actions done on >= 20 items by >= 2 people', () => {
  const [c] = findCandidates(many(25, ['a', 'b']), range, DEFAULT_SETTINGS);
  expect(c).toMatchObject({ id: 'set:priority:1', items: 25, people: 2, bulkCollapsed: 0 });
  expect(c!.occurrences).toHaveLength(25);
});

test('drops actions below the count or people thresholds', () => {
  expect(findCandidates(many(19, ['a', 'b']), range, DEFAULT_SETTINGS)).toEqual([]);
  expect(findCandidates(many(25, ['a']), range, DEFAULT_SETTINGS)).toEqual([]);
  expect(findCandidates(many(25, ['a']), range, { ...DEFAULT_SETTINGS, minPeople: 1 })).toHaveLength(1);
});

test('bulk edits (one person, >= 5 items within 60 s) are collapsed', () => {
  const normal = many(22, ['a', 'b']);
  const bulk = Array.from({ length: 6 }, (_, i) => issue(`b${i}`, [set(5_000_000_000 + i * 1000, 'a', 'priority', '3', '1')]));
  const [c] = findCandidates([...normal, ...bulk], range, DEFAULT_SETTINGS);
  expect(c).toMatchObject({ items: 22, bulkCollapsed: 6 });
});

test('only occurrences inside the range count', () => {
  expect(findCandidates(many(25, ['a', 'b']), { from: 0, to: 1000 + 10 * 3_600_000 }, DEFAULT_SETTINGS)).toEqual([]);
});

test('excluded fields are never candidates', () => {
  expect(findCandidates(many(25, ['a', 'b']), range, { ...DEFAULT_SETTINGS, excludedFields: ['priority'] })).toEqual([]);
});
