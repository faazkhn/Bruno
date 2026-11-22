import { expect, test } from 'vitest';
import { BOT_CONFIG, SIM_IDS, simulateHistory } from '../src/sim';
import { snapshotAt } from '../src/snapshot';

const end = Date.parse('2026-12-01T00:00:00Z');
const issues = simulateHistory(BOT_CONFIG, { days: 30, seed: 7, end });

test('deterministic and roughly requestsPerDay per day', () => {
  expect(simulateHistory(BOT_CONFIG, { days: 30, seed: 7, end }).map((i) => i.events.length)).toEqual(issues.map((i) => i.events.length));
  expect(issues.length).toBeGreaterThan(30 * BOT_CONFIG.requestsPerDay * 0.8);
  expect(issues.every((i) => i.createdAt < end && i.events.every((e) => e.ts <= end))).toBe(true);
});

test('events are ordered, start with created, and current is the final state', () => {
  for (const i of issues.slice(0, 200)) {
    expect(i.events[0]!.kind).toBe('created');
    expect(i.events.map((e) => e.seq)).toEqual(i.events.map((_, k) => k));
    expect(i.events.every((e, k) => k === 0 || e.ts >= i.events[k - 1]!.ts)).toBe(true);
    expect(snapshotAt(i, end)).toEqual(i.current);
  }
});

test('customers comment, agents act, VIP work is done by the senior agent only', () => {
  const all = issues.flatMap((i) => i.events);
  expect(all.some((e) => e.kind === 'comment' && e.actorKind === 'customer')).toBe(true);
  expect(new Set(all.filter((e) => e.kind === 'field').map((e) => e.actorHash)).size).toBe(4);
  const vip = issues.filter((i) => i.current.organizations === SIM_IDS.organizations.Initech);
  expect(vip.length).toBeGreaterThan(10);
  expect(vip.flatMap((i) => i.events).filter((e) => e.kind === 'field').every((e) => e.actorHash === 'sim:agent-4')).toBe(true);
});

test('invoice requests start as Get IT help and are mostly moved to Billing', () => {
  const inv = issues.filter((i) => /invoice/i.test(i.text.summary) && i.current.organizations !== SIM_IDS.organizations.Initech);
  const billed = inv.filter((i) => i.events.some((e) => e.field === 'requestType' && e.to === SIM_IDS.requestType.Billing));
  expect(snapshotAt(inv[0]!, inv[0]!.createdAt)!.requestType).toBe(SIM_IDS.requestType['Get IT help']);
  expect(billed.length / inv.length).toBeGreaterThan(0.75);
});
