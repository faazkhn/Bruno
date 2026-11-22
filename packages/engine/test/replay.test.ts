import { expect, test } from 'vitest';
import { parseJql } from '../src/jql';
import type { Event, IssueRecord } from '../src/model';
import { replay } from '../src/replay';

const H = 3_600_000;
let n = 0;
/** item created at `at` as 'Get help' (320); optional human Billing (339) after `billAfter` ms */
function item(summary: string, at: number, billAfter?: number, startAs = '320'): IssueRecord {
  const id = String(++n);
  const events: Event[] = [{ issueId: id, ts: at, seq: 0, kind: 'created', actorKind: 'customer', actorHash: 'c' }];
  if (billAfter !== undefined) events.push({ issueId: id, ts: at + billAfter, seq: 1, kind: 'field', field: 'requestType', from: startAs, to: '339', actorKind: 'human_agent', actorHash: 'a' });
  return {
    id, key: `T-${id}`, projectKey: 'T', createdAt: at, reporterHash: 'c', anomalies: {}, remaps: 0,
    text: { summary, description: '' }, current: { requestType: billAfter !== undefined ? '339' : startAs, summary }, events,
  };
}

const range = { from: 100 * H, to: 200 * H };
const issues = [
  item('my invoice', 110 * H, 1 * H), // TP
  item('invoice copy', 120 * H), // FP
  item('refund please', 130 * H, 2 * H), // FN
  item('printer jam', 140 * H), // TN
  item('invoice again', 150 * H, undefined, '339'), // no-op: already Billing → skipped
  item('old invoice', 90 * H, 15 * H), // created before the holdout, action inside → FN no-trigger
];
const action = { kind: 'set' as const, field: 'requestType', value: '339' };
const rule = [parseJql('summary ~ invoice')];

test('outcomes, metrics and stored differences', () => {
  const p = replay(rule, { type: 'created' }, action, issues, range, 48 * H);
  expect(p).toMatchObject({ tp: 1, fp: 1, fn: 2, tn: 1, inconclusive: 0, precision: 0.5, recall: 1 / 3, coverage: 1 });
  expect(p.cases.map((c) => [c.key, c.outcome, c.reason ?? null])).toEqual([
    ['T-1', 'TP', null], ['T-2', 'FP', null], ['T-3', 'FN', null], ['T-6', 'FN', 'no-trigger'],
  ]);
  expect(p.cases[0]).toMatchObject({ triggerTs: 110 * H, actionTs: 111 * H, clauses: [{ jql: 'summary ~ "invoice"', value: true }] });
  expect(p.cases[0]!.snapshot.requestType).toBe('320');
});

test('clauses we cannot evaluate make cases inconclusive, never safe', () => {
  const p = replay([parseJql('sprint = 4')], { type: 'created' }, action, issues, range, 48 * H);
  expect(p.inconclusive).toBe(4);
  expect(p.coverage).toBeCloseTo(0.2); // 4 inconclusive + 1 no-trigger difference (a real, counted case)
  expect(p.tp + p.fp + p.tn).toBe(0);
});

test('an action outside W after the trigger is a no-trigger difference', () => {
  const late = item('invoice late', 160 * H, 30 * H);
  const p = replay(rule, { type: 'created' }, action, [late], range, 24 * H);
  expect(p.cases.map((c) => [c.outcome, c.reason ?? null])).toEqual([['FP', null], ['FN', 'no-trigger']]);
});
