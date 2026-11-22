import { describe, expect, test } from 'vitest';
import { toJql } from '../src/jql';
import { analyse } from '../src/pipeline';
import { DEFAULT_SETTINGS } from '../src/settings';
import { BOT_CONFIG, SIM_IDS, simulateHistory } from '../src/sim';

const DAY = 86_400_000;
const now = Date.parse('2026-12-06T00:00:00Z');
const issues = simulateHistory(BOT_CONFIG, { days: 90, seed: 2026, end: now });
const result = analyse(issues, DEFAULT_SETTINGS, now);
const chore = (id: string) => result.chores.find((c) => c.id === id);

describe('analyse — test B (planted chores recovered with correct trigger + conditions)', () => {
  test('window and 2/3 : 1/3 split', () => {
    expect(result.window.end).toBe(now);
    expect(result.window.cut - result.window.start).toBeCloseTo((2 / 3) * (result.window.end - result.window.start), -3);
    expect(result.window.end - result.window.start).toBeLessThanOrEqual(90 * DAY);
  });

  test('billing: created + summary mentions invoice', () => {
    const c = chore(`set:requestType:${SIM_IDS.requestType.Billing}`)!;
    expect(c.trigger).toEqual({ type: 'created' });
    expect(c.clauses.map((x) => toJql(x))).toContain('summary ~ "invoice"');
    expect(c.verdict).toBe('proven');
  });

  test('vpn: created + summary mentions vpn → Network', () => {
    const c = chore(`add:components:${SIM_IDS.components.Network}`)!;
    expect(c.trigger).toEqual({ type: 'created' });
    expect(c.clauses.map((x) => toJql(x))).toContain('summary ~ "vpn"');
  });

  test('outage: created + outage/down → Highest', () => {
    const c = chore(`set:priority:${SIM_IDS.priority.Highest}`)!;
    const jql = c.clauses.map((x) => toJql(x)).join(' ');
    expect(c.trigger).toEqual({ type: 'created' });
    expect(jql).toMatch(/outage/);
    expect(jql).toMatch(/down/);
  });

  test('customer reply: customer commented → In Progress', () => {
    const c = chore(`transition:status:${SIM_IDS.status['In Progress']}`)!;
    expect(c.trigger).toEqual({ type: 'customerCommented' });
  });

  test('normal work is not a chore; ranked by matches per month; holdout numbers are real', () => {
    expect(chore(`transition:status:${SIM_IDS.status.Resolved}`)).toBeUndefined();
    const per = result.chores.map((c) => c.perMonth);
    expect([...per].sort((a, b) => b - a)).toEqual(per);
    for (const c of result.chores) expect(c.proof.range).toEqual({ from: result.window.cut, to: result.window.end });
  });

  test('noise with no learnable pattern is not a chore; nothing weak is called proven', () => {
    expect(chore('add:labels:follow-up')).toBeUndefined();
    expect(result.unexplained.some((u) => u.id === 'add:labels:follow-up' && u.reason === 'no-pattern')).toBe(true);
    for (const c of result.chores) if (c.verdict === 'proven') expect(c.proof.precision).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.minPrecision);
  });

  test('empty project: no chores, no throw', () => {
    expect(analyse([], DEFAULT_SETTINGS, now).chores).toEqual([]);
  });
});
