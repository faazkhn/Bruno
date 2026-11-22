import { expect, test } from 'vitest';
import { findCandidates } from '../src/candidates';
import { DEFAULT_SETTINGS } from '../src/settings';
import { BOT_CONFIG, SIM_IDS, simulateHistory } from '../src/sim';
import { chooseTrigger, followingAction, isNoOp, triggerEvents } from '../src/triggers';

const end = Date.parse('2026-12-01T00:00:00Z');
const issues = simulateHistory(BOT_CONFIG, { days: 30, seed: 11, end });
const range = { from: 0, to: end };
const cands = findCandidates(issues, range, DEFAULT_SETTINGS);
const cand = (id: string) => cands.find((c) => c.id === id)!;

test('trigger events by type', () => {
  const withComment = issues.find((i) => i.events.some((e) => e.kind === 'comment'))!;
  expect(triggerEvents(withComment, { type: 'created' })).toEqual([withComment.events[0]]);
  expect(triggerEvents(withComment, { type: 'customerCommented' }).every((e) => e.kind === 'comment' && e.actorKind === 'customer')).toBe(true);
});

test('billing chore: created is the trigger', () => {
  const t = chooseTrigger(cand(`set:requestType:${SIM_IDS.requestType.Billing}`), issues, range, DEFAULT_SETTINGS)!;
  expect(t.trigger).toEqual({ type: 'created' });
  expect(t.coverage).toBeGreaterThan(0.95);
  expect(t.medianDelayMs).toBeLessThan(2 * 3_600_000);
});

test('customer-reply chore: customer comment beats created despite created covering it too', () => {
  const t = chooseTrigger(cand(`transition:status:${SIM_IDS.status['In Progress']}`), issues, range, DEFAULT_SETTINGS)!;
  expect(t.trigger).toEqual({ type: 'customerCommented' });
  expect(t.precision).toBeGreaterThan(0.6);
});

test('normal work long after the trigger is not a chore trigger', () => {
  expect(chooseTrigger(cand(`transition:status:${SIM_IDS.status.Resolved}`), issues, range, DEFAULT_SETTINGS)).toBeNull();
});

test('followingAction finds the human action within W; isNoOp spots items already done', () => {
  const billed = issues.find((i) => i.events.some((e) => e.field === 'requestType' && e.to === '339'))!;
  const action = { kind: 'set' as const, field: 'requestType', value: '339' };
  expect(followingAction(billed, billed.events[0]!, action, 48 * 3_600_000)?.to).toBe('339');
  expect(followingAction(billed, billed.events[0]!, action, 1)).toBeUndefined();
  expect(isNoOp({ requestType: '339' }, action)).toBe(true);
  expect(isNoOp({ labels: 'a,vip' }, { kind: 'add', field: 'labels', value: 'vip' })).toBe(true);
  expect(isNoOp({ status: '3' }, { kind: 'transition', field: 'status', value: '5' })).toBe(false);
});
