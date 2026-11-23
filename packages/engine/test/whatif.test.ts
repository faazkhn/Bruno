import { expect, test } from 'vitest';
import { tryExclusion } from '../src/exceptions';
import { analyse } from '../src/pipeline';
import { DEFAULT_SETTINGS } from '../src/settings';
import { BOT_CONFIG, SIM_IDS, simulateHistory } from '../src/sim';

const now = Date.parse('2026-12-06T00:00:00Z');
const issues = simulateHistory(BOT_CONFIG, { days: 90, seed: 2026, end: now });
const result = analyse(issues, DEFAULT_SETTINGS, now);
const billing = result.chores.find((c) => c.id === `set:requestType:${SIM_IDS.requestType.Billing}`)!;
const initech = { op: 'eq' as const, field: 'organizations', value: SIM_IDS.organizations.Initech! };

test('what-if exclusion is scored on the learning period only', () => {
  const r = tryExclusion(billing, initech, issues, result.window, DEFAULT_SETTINGS);
  expect(r.period).toEqual({ from: result.window.start, to: result.window.cut });
  expect(r.after.precision).toBeGreaterThan(r.before.precision);
  expect(r.before.n).toBeGreaterThan(0);
  // the holdout can't move the answer
  const noHoldout = issues.filter((i) => i.createdAt < result.window.cut);
  expect(tryExclusion(billing, initech, noHoldout, result.window, DEFAULT_SETTINGS)).toEqual(r);
});
