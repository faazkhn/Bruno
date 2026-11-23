import { describe, expect, test } from 'vitest';
import { analyse, BOT_CONFIG, DEFAULT_SETTINGS, SIM_IDS, simulateHistory } from '@wind-tunnel/engine';
import { shadowOf } from '../backend/logic';

const DAY = 86_400_000;
const end = Date.parse('2026-12-06T00:00:00Z');
const issues = simulateHistory(BOT_CONFIG, { days: 100, seed: 7, end });
// the team analysed 10 days ago; everything after that is new to the rule
const result = analyse(issues, DEFAULT_SETTINGS, end - 10 * DAY);
const priority = result.chores.find((c) => c.id === `set:priority:${SIM_IDS.priority.High}`)!;

describe('shadow mode: a validated rule scored on work items that arrived after its test period', () => {
  test('counts start where the proof ended and only cover new items', () => {
    expect(priority.verdict).toBe('proven');
    const s = shadowOf(priority, issues, end, DEFAULT_SETTINGS.windowHours);
    expect(s.from).toBe(priority.proof.range.to);
    expect(s.to).toBe(end);
    expect(s.wouldAct).toBeGreaterThan(0);
    expect(s.agreed).toBeLessThanOrEqual(s.wouldAct);
    expect(s.ruleOnly).toBe(s.wouldAct - s.agreed);
    expect(s.items).toBe(issues.filter((i) => i.createdAt >= s.from && i.createdAt < s.to).length);
  });

  test('no new items yet → all zeros, never a made-up number', () => {
    const s = shadowOf(priority, issues.filter((i) => i.createdAt < priority.proof.range.to), end, DEFAULT_SETTINGS.windowHours);
    expect([s.items, s.wouldAct, s.agreed, s.peopleOnly]).toEqual([0, 0, 0, 0]);
  });
});
