import { describe, expect, test } from 'vitest';
import { parseJql, type Chore } from '@wind-tunnel/engine';
import { choreRef, parseChoreRef, trimChore, nudgeMatches, isReversal, summarise } from '../backend/logic';

const chore = {
  id: 'set:requestType:339', version: 1, action: { kind: 'set', field: 'requestType', value: '339' }, count: 40, items: 40, people: 2, bulkCollapsed: 0,
  trigger: { type: 'created' }, triggerStats: { coverage: 1, precision: 0.3, medianDelayMs: 1 }, clauses: [parseJql('summary ~ invoice')],
  learn: { f1: 0.8, precision: 0.8, recall: 0.8, examples: 100 }, verdict: 'proven', perMonth: 12,
  proof: { range: { from: 0, to: 1 }, tp: 30, fp: 3, fn: 70, tn: 5, inconclusive: 0, precision: 0.9, recall: 0.3, coverage: 1,
    cases: Array.from({ length: 103 }, (_, i) => ({ issueId: String(i), key: `WT-${i}`, outcome: i < 30 ? 'TP' : i < 33 ? 'FP' : 'FN', triggerTs: 1, actionTs: 2, clauses: [], snapshot: {} })) },
} as unknown as Chore;

describe('logic', () => {
  test('chore refs carry the project and round-trip', () => {
    expect(choreRef('WT', chore.id)).toBe('WT/set:requestType:339');
    expect(parseChoreRef('WT/set:requestType:339')).toEqual({ projectKey: 'WT', choreId: 'set:requestType:339' });
    expect(parseChoreRef('nonsense')).toBeNull();
  });

  test('stored cases are capped per outcome; counts stay complete', () => {
    const t = trimChore(chore, 50);
    expect(t.proof.cases.filter((c) => c.outcome === 'FN')).toHaveLength(50);
    expect(t.proof.cases.filter((c) => c.outcome === 'TP')).toHaveLength(30);
    expect(t.proof.fn).toBe(70);
    expect(t.casesTruncated).toBe(true);
  });

  test('summary is what list views and Rovo show: real numbers only', () => {
    expect(summarise('WT', chore, 'Some sentence', 'new')).toEqual({
      ref: 'WT/set:requestType:339', id: chore.id, version: 1, sentence: 'Some sentence', count: 40, people: 2,
      matches: 30, fires: 33, differences: 73, precision: 0.9, recall: 0.3, coverage: 1, verdict: 'proven', status: 'new', perMonth: 12,
    });
  });

  test('nudge: the viewer just did the chore by hand and the conditions held', () => {
    const snap = { requestType: '320', summary: 'my invoice' };
    expect(nudgeMatches(chore, { kind: 'set', field: 'requestType', value: '339' }, snap, '')).toBe(true);
    expect(nudgeMatches(chore, { kind: 'set', field: 'requestType', value: '320' }, snap, '')).toBe(false);
    expect(nudgeMatches(chore, { kind: 'set', field: 'requestType', value: '339' }, { ...snap, summary: 'printer' }, '')).toBe(false);
  });

  test('reversal: a human sets the field back within 24 h of a live run', () => {
    const H = 3_600_000;
    const ev = (ts: number, from: string, to: string) => ({ issueId: '1', seq: 1, ts, kind: 'field' as const, field: 'requestType', from, to, actorKind: 'human_agent' as const, actorHash: 'a' });
    expect(isReversal(chore.action, 10 * H, ev(12 * H, '339', '320'))).toBe(true);
    expect(isReversal(chore.action, 10 * H, ev(40 * H, '339', '320'))).toBe(false);
    expect(isReversal(chore.action, 10 * H, { ...ev(12 * H, '339', '320'), actorKind: 'automation' })).toBe(false);
  });
});
