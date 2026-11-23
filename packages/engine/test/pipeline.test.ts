import { describe, expect, test } from 'vitest';
import { toJql } from '../src/jql';
import { analyse, riskOf, verdictOf } from '../src/pipeline';
import { applyExclusion, findExceptions } from '../src/exceptions';
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
  });

  test('empty project: no chores, no throw', () => {
    expect(analyse([], DEFAULT_SETTINGS, now).chores).toEqual([]);
  });
});

describe('risk: precision first, and knowing when not to automate', () => {
  test('risk levels by action', () => {
    const s = { ...DEFAULT_SETTINGS, doneStatuses: [SIM_IDS.status.Resolved!] };
    expect(riskOf({ kind: 'add', field: 'labels', value: 'x' }, s)).toBe('low');
    expect(riskOf({ kind: 'set', field: 'requestType', value: '339' }, s)).toBe('low');
    expect(riskOf({ kind: 'set', field: 'priority', value: '1' }, s)).toBe('medium');
    expect(riskOf({ kind: 'transition', field: 'status', value: SIM_IDS.status['In Progress']! }, s)).toBe('medium');
    expect(riskOf({ kind: 'transition', field: 'status', value: SIM_IDS.status.Resolved! }, s)).toBe('high');
    expect(riskOf({ kind: 'set', field: 'resolution', value: '1' }, s)).toBe('high');
  });

  test('proven needs the precision bar for its risk; high-risk actions need judgment', () => {
    for (const c of result.chores) {
      if (c.verdict === 'proven') expect(c.proof.precision).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.minPrecisionByRisk[c.risk as 'low' | 'medium']);
    }
    const p = { tp: 50, fp: 5, fn: 10, tn: 100, inconclusive: 0, precision: 50 / 55, recall: 50 / 60, coverage: 1 } as never;
    expect(verdictOf(p, DEFAULT_SETTINGS, 'high')).toBe('needs-judgment');
    expect(verdictOf(p, DEFAULT_SETTINGS, 'low')).toBe('proven');
  });

  test('the bar applies to the cautious end of the 95% interval, not the point estimate', () => {
    const at = (tp: number, fp: number) => ({ tp, fp, fn: 10, tn: 0, inconclusive: 0, precision: tp / (tp + fp), recall: 0.5, coverage: 1 }) as never;
    expect(verdictOf(at(17, 3), DEFAULT_SETTINGS, 'low')).toBe('weak'); // 85%, but likely 64–95%
    expect(verdictOf(at(557, 96), DEFAULT_SETTINGS, 'low')).toBe('proven'); // 85.3%, likely 82–88%
    // chores stored before risk existed: an unknown risk never validates (fail closed)
    expect(verdictOf(at(557, 0), DEFAULT_SETTINGS, undefined as never)).toBe('weak');
  });

  test('the billing story: v1 is weak because of the VIP exception; the learned exclusion makes it proven', () => {
    const c = chore(`set:requestType:${SIM_IDS.requestType.Billing}`)!;
    expect(c.verdict).toBe('weak');
    const ex = findExceptions(c, issues, result.window, DEFAULT_SETTINGS);
    const v2 = applyExclusion(c, ex.suggestion!.clause, issues, result.window, DEFAULT_SETTINGS);
    expect(v2.verdict).toBe('proven');
  });
});
