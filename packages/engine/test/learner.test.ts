import { describe, expect, test } from 'vitest';
import type { Action } from '../src/candidates';
import { toJql } from '../src/jql';
import { buildExamples, learnRule } from '../src/learner';
import { DEFAULT_SETTINGS } from '../src/settings';
import { BOT_CONFIG, SIM_IDS, simulateHistory } from '../src/sim';
import { tokenize, vocabulary } from '../src/text';

const end = Date.parse('2026-12-01T00:00:00Z');
const issues = simulateHistory(BOT_CONFIG, { days: 60, seed: 3, end });
const range = { from: 0, to: end };
const vocab = vocabulary(issues.map((i) => new Set(tokenize(`${i.text.summary} ${i.text.description}`))));
const W = 48 * 3_600_000;
const learn = (action: Action, trigger = { type: 'created' as const }) => {
  const ex = buildExamples(issues, trigger, action, range, W);
  return { ex, rule: learnRule(ex, vocab, DEFAULT_SETTINGS) };
};

describe('learner', () => {
  test('examples come from trigger-time snapshots and skip no-ops', () => {
    const { ex } = learn({ kind: 'set', field: 'requestType', value: SIM_IDS.requestType.Billing! });
    expect(ex.length).toBeGreaterThan(1000);
    expect(ex.every((e) => e.snap.requestType !== SIM_IDS.requestType.Billing)).toBe(true);
    expect(ex.filter((e) => e.positive).length).toBeGreaterThan(200);
  });

  test('billing: learns summary mentions invoice', () => {
    const { rule } = learn({ kind: 'set', field: 'requestType', value: SIM_IDS.requestType.Billing! });
    expect(rule.clauses.map((c) => toJql(c))).toContain('summary ~ "invoice"');
    expect(rule.clauses.length).toBeLessThanOrEqual(3);
    // VIP invoices are handled differently by a senior agent: that exception is the exceptions step's job (PRD flow C)
    expect(rule.precision).toBeGreaterThan(0.6);
  });

  test('outage: widens one keyword clause to an OR (outage / down)', () => {
    const { rule } = learn({ kind: 'set', field: 'priority', value: SIM_IDS.priority.Highest! });
    const jql = rule.clauses.map((c) => toJql(c)).join(' AND ');
    expect(jql).toMatch(/outage/);
    expect(jql).toMatch(/down/);
    expect(rule.recall).toBeGreaterThan(0.7);
  });

  test('a clause that adds nothing is not added (gain < 0.02)', () => {
    const { rule } = learn({ kind: 'add', field: 'components', value: SIM_IDS.components.Network! });
    expect(rule.clauses.map((c) => toJql(c))).toEqual(['summary ~ "vpn"']);
  });

  test('no examples → empty rule with zero scores, no throw', () => {
    expect(learnRule([], vocab, DEFAULT_SETTINGS)).toEqual({ clauses: [], f1: 0, precision: 0, recall: 0 });
  });
});
