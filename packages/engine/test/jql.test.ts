import { describe, expect, test } from 'vitest';
import { evalJql, parseJql, toJql, UnsupportedJql } from '../src/jql';
import { tokenize, vocabulary } from '../src/text';

describe('tokenize / vocabulary', () => {
  test('lower-cases, drops stop words and 1-char tokens, unique', () => {
    expect(tokenize('Question about my INVOICE #4411 — the invoice!')).toEqual(['question', 'invoice', '4411']);
  });
  test('vocabulary keeps tokens present in at least minShare of items', () => {
    const items = [['vpn', 'slow'], ['vpn'], ['printer'], ['vpn', 'error']].map((t) => new Set(t));
    expect([...vocabulary(items, 0.5)]).toEqual(['vpn']);
  });
});

const snap = { status: '3', priority: '1', requestType: '320', labels: 'cleanup,vip', components: null, summary: 'Question about my invoice', assignee: null };
const ctx = { description: 'finance flagged it' };
const ev = (q: string) => evalJql(parseJql(q), snap, ctx);

describe('JQL subset', () => {
  test('equality, inequality, in, not in', () => {
    expect(ev('status = 3')).toBe(true);
    expect(ev('priority != 1')).toBe(false);
    expect(ev('requestType in (320, 339)')).toBe(true);
    expect(ev('requestType not in ("339")')).toBe(true);
  });
  test('set fields use membership', () => {
    expect(ev('labels = vip')).toBe(true);
    expect(ev('labels in (x, cleanup)')).toBe(true);
    expect(ev('labels != vip')).toBe(false);
    expect(ev('components is EMPTY')).toBe(true);
    expect(ev('labels is not empty')).toBe(true);
  });
  test('text contains is word based', () => {
    expect(ev('summary ~ invoice')).toBe(true);
    expect(ev('summary ~ "invoice question"')).toBe(true);
    expect(ev('description ~ finance')).toBe(true);
    expect(ev('text ~ flagged')).toBe(true);
    expect(ev('summary ~ invoi')).toBe(false);
  });
  test('AND / OR / NOT with precedence and parentheses', () => {
    expect(ev('status = 3 AND summary ~ invoice OR priority = 5')).toBe(true);
    expect(ev('status = 9 AND (summary ~ invoice OR priority = 1)')).toBe(false);
    expect(ev('NOT labels = vip')).toBe(false);
    expect(ev('status = 3 and not (labels = vip)')).toBe(false);
  });
  test('unmodelled field is unknown, and unknown propagates honestly', () => {
    expect(ev('sprint = 4')).toBe('unknown');
    expect(ev('sprint = 4 AND status = 9')).toBe(false);
    expect(ev('sprint = 4 OR status = 3')).toBe(true);
    expect(ev('sprint = 4 AND status = 3')).toBe('unknown');
  });
  test('unsupported syntax throws UnsupportedJql', () => {
    expect(() => parseJql('created >= -30d')).toThrow(UnsupportedJql);
    expect(() => parseJql('status = 3 ORDER BY created')).toThrow(UnsupportedJql);
    expect(() => parseJql('assignee = currentUser()')).toThrow(UnsupportedJql);
  });
  test('aliases and value resolution map site JQL onto canonical ids', () => {
    const e = parseJql('"Request Type" = Billing AND component = Network', {
      aliases: { 'request type': 'requestType', component: 'components' },
      resolve: (f, v) => ({ requestType: { billing: '339' }, components: { network: '10132' } } as Record<string, Record<string, string>>)[f]?.[v.toLowerCase()] ?? v,
    });
    expect(toJql(e)).toBe('requestType = "339" AND components = "10132"');
  });
  test('toJql round-trips', () => {
    for (const q of ['status = "3" AND (labels = "vip" OR NOT summary ~ "invoice")', 'requestType IN ("1", "2")', 'assignee IS EMPTY']) {
      expect(parseJql(toJql(parseJql(q)))).toEqual(parseJql(q));
    }
  });
});
