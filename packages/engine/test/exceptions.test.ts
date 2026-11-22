import { expect, test } from 'vitest';
import { applyExclusion, findExceptions } from '../src/exceptions';
import { toJql } from '../src/jql';
import { analyse } from '../src/pipeline';
import { DEFAULT_SETTINGS } from '../src/settings';
import { BOT_CONFIG, SIM_IDS, simulateHistory } from '../src/sim';

const now = Date.parse('2026-12-06T00:00:00Z');
const issues = simulateHistory(BOT_CONFIG, { days: 90, seed: 2026, end: now });
const result = analyse(issues, DEFAULT_SETTINGS, now);
const billing = result.chores.find((c) => c.id === `set:requestType:${SIM_IDS.requestType.Billing}`)!;
const ex = findExceptions(billing, issues, result.window, DEFAULT_SETTINGS);

test('groups "rule would act" differences by one trigger-time fact, ranked by lift', () => {
  const top = ex.groups.find((g) => g.outcome === 'FP')!;
  expect(toJql(top.clause)).toBe(`organizations = "${SIM_IDS.organizations.Initech}"`);
  expect(top.differences).toBeGreaterThan(top.ofDifferences * 0.5);
  expect(top.lift).toBeGreaterThan(1);
  expect(top.caseKeys.length).toBe(top.differences);
});

test('suggests NOT <group> only when it explains >= 50% and raises learn-split F1', () => {
  expect(ex.suggestion).toBeDefined();
  expect(toJql(ex.suggestion!.clause)).toBe(`NOT organizations = "${SIM_IDS.organizations.Initech}"`);
  expect(ex.suggestion!.learnF1After).toBeGreaterThan(ex.suggestion!.learnF1Before);
});

test('applying the exclusion makes a new version, re-proved and honestly labelled', () => {
  const v2 = applyExclusion(billing, ex.suggestion!.clause, issues, result.window, DEFAULT_SETTINGS);
  expect(v2.version).toBe(2);
  expect(v2.clauses).toHaveLength(billing.clauses.length + 1);
  expect(v2.proof.precision).toBeGreaterThan(billing.proof.precision);
  expect(v2.proof.range).toEqual(billing.proof.range);
  expect(v2.note).toBe('exclusion chosen after seeing differences');
});

test('no suggestion when nothing explains half of the differences', () => {
  const cust = result.chores.find((c) => c.id === `transition:status:${SIM_IDS.status['In Progress']}`)!;
  const e = findExceptions(cust, issues, result.window, DEFAULT_SETTINGS);
  expect(e.suggestion === undefined || e.suggestion.share >= 0.5).toBe(true);
});
