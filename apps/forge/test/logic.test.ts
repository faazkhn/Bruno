import { describe, expect, test } from 'vitest';
import { parseJql, wilson, type Chore } from '@wind-tunnel/engine';
import { choreRef, parseChoreRef, trimChore, nudgeMatches, isReversal, summarise, parseSignature, caseIdsOf, redactCases, retentionCutoff } from '../backend/logic';

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
      ref: 'WT/set:requestType:339', id: chore.id, version: 1, sentence: 'Some sentence', risk: undefined, count: 40, people: 2,
      matches: 30, fires: 33, differences: 73, precision: 0.9, recall: 0.3, coverage: 1, verdict: 'proven', status: 'new', perMonth: 12,
      precisionLikely: wilson(30, 33), recallLikely: wilson(30, 100),
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

  test('signature: the property our rule sets, as object or JSON string; garbage is ignored', () => {
    const v = { choreId: 'set:requestType:339', version: 2, ts: '2026-11-23T10:00:00.000+0000' };
    const want = { choreId: 'set:requestType:339', version: 2, runMs: Date.parse('2026-11-23T10:00:00.000+0000') };
    expect(parseSignature(v, 5)).toEqual(want);
    expect(parseSignature(JSON.stringify(v), 5)).toEqual(want);
    expect(parseSignature({ choreId: 'x', ts: '{{now.jiraDateTime}}' }, 5)).toEqual({ choreId: 'x', version: null, runMs: 5 });
    for (const bad of [null, undefined, 'garbage', {}, { choreId: '' }, 42]) expect(parseSignature(bad, 5)).toBeNull();
  });

  describe('per-item permissions: examples the viewer cannot browse are hidden, counts stay', () => {
    const withGroups = { ...chore, exceptions: { groups: [
      { caseKeys: ['WT-1', 'WT-2', 'WT-50'], caseIds: ['1', '2', '50'] },
      { caseKeys: ['WT-3'] }, // stored before caseIds existed
    ] } };

    test('ids to check: proof cases and exception items, once each', () => {
      expect(caseIdsOf(withGroups).sort((a, b) => Number(a) - Number(b))).toEqual([...Array.from({ length: 103 }, (_, i) => String(i)), '50'].filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => Number(a) - Number(b)));
    });

    test("'all' (simulated history) keeps everything", () => {
      const r = redactCases(withGroups, 'all');
      expect(r.proof.cases).toHaveLength(103);
      expect(r.exceptions.groups[1]!.caseKeys).toEqual(['WT-3']);
      expect(r.hiddenCases).toBe(0);
    });

    test('only allowed items stay; tp/fp/fn untouched; old groups without ids show no keys', () => {
      const r = redactCases(withGroups, new Set(['1', '3']));
      expect(r.proof.cases.map((c) => c.issueId)).toEqual(['1', '3']);
      expect([r.proof.tp, r.proof.fp, r.proof.fn]).toEqual([30, 3, 70]);
      expect(r.exceptions.groups[0]!.caseKeys).toEqual(['WT-1']);
      expect(r.exceptions.groups[1]!.caseKeys).toEqual([]);
      expect(r.hiddenCases).toBe(102); // 101 proof items (ids 2 and 50 included) + WT-3, a group key with no id
    });

    test('permission check failed (empty set): every example hidden, page still has its numbers', () => {
      const r = redactCases(withGroups, new Set());
      expect(r.proof.cases).toEqual([]);
      expect(r.proof.precision).toBe(0.9);
      expect(r.hiddenCases).toBe(104);
    });
  });

  test('retention: keep the analysis window plus 7 days (PRD §18)', () => {
    const now = Date.parse('2026-11-23T00:00:00Z');
    expect(new Date(retentionCutoff({ windowDays: 90, anchor: 'now' }, now)!).toISOString()).toBe('2026-08-18T00:00:00.000Z');
    // window anchored at the project's last activity: its items are old by design, never purge them
    expect(retentionCutoff({ windowDays: 90, anchor: 'lastActivity' }, now)).toBeNull();
  });
});
