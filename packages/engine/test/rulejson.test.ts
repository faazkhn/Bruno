import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { evalJql, parseJql, toJql } from '../src/jql';
import { fromNativeRule, nativeJql, toNativeRule, type SiteContext } from '../src/rulejson';

const ctx: SiteContext = {
  projectId: '10202',
  projectTypeKey: 'service_desk',
  fieldIds: { requestType: 'customfield_10010', organizations: 'customfield_10002' },
  names: { values: { requestType: { '320': 'Get IT help', '339': 'Billing' }, organizations: { '4': 'Initech' }, components: { '10132': 'Network' } } },
};
const billing = {
  id: 'set:requestType:339',
  version: 2,
  trigger: { type: 'created' as const },
  clauses: [parseJql('summary ~ invoice'), parseJql('NOT organizations = 4')],
  action: { kind: 'set' as const, field: 'requestType', value: '339' },
};

test('native JQL uses names where Jira needs them and guards negations against EMPTY', () => {
  expect(nativeJql(billing.clauses, ctx)).toBe('summary ~ "invoice" AND (NOT (Organizations = "Initech") OR Organizations IS EMPTY)');
  expect(nativeJql([parseJql('requestType = 320'), parseJql('components = 10132'), parseJql('priority in (1, 2)')], ctx))
    .toBe('"Request Type" = "Get IT help" AND component = 10132 AND priority IN (1, 2)');
});

test('generated rule matches the golden file: disabled, JQL condition, edit action, signature', () => {
  const rule = toNativeRule(billing, 'Automate: set Request type to Billing', ctx);
  expect(rule).toEqual(JSON.parse(readFileSync(new URL('./golden/billing.rule.json', import.meta.url), 'utf8')));
  expect(rule.rules[0]!.state).toBe('DISABLED');
});

test('round trip (test D offline): export → parse gives the same rule semantics', () => {
  const back = fromNativeRule(toNativeRule(billing, 'x', ctx), ctx);
  expect(back.unsupported).toEqual([]);
  expect(back.trigger).toEqual(billing.trigger);
  expect(back.action).toEqual(billing.action);
  expect(back.clauses.map((c) => toJql(c))).toEqual(billing.clauses.map((c) => toJql(c)));
});

test('all triggers and actions round-trip', () => {
  const cases = [
    { trigger: { type: 'customerCommented' as const }, action: { kind: 'transition' as const, field: 'status', value: '3' } },
    { trigger: { type: 'statusTo' as const, value: '10004' }, action: { kind: 'add' as const, field: 'components', value: '10132' } },
    { trigger: { type: 'fieldChanged' as const, field: 'priority' }, action: { kind: 'add' as const, field: 'labels', value: 'urgent' } },
  ];
  for (const c of cases) {
    const back = fromNativeRule(toNativeRule({ id: 'x', version: 1, clauses: [], ...c }, 'x', ctx), ctx);
    expect([back.trigger, back.action, back.unsupported]).toEqual([c.trigger, c.action, []]);
  }
});

test('unsupported components are listed, not guessed', () => {
  const rule = toNativeRule(billing, 'x', ctx);
  rule.rules[0]!.components.push({ component: 'ACTION', type: 'jira.issue.create', schemaVersion: 1, value: {}, children: [], conditions: [] });
  rule.rules[0]!.components.push({ component: 'CONDITION', type: 'jira.jql.condition', schemaVersion: 1, value: 'created >= -7d', children: [], conditions: [] });
  expect(fromNativeRule(rule, ctx).unsupported).toEqual(['action jira.issue.create', 'JQL: created >= -7d']);
});

test('negation guard keeps engine and Jira semantics equal on empty fields', () => {
  const snap = { organizations: null, summary: 'invoice' };
  const back = fromNativeRule(toNativeRule(billing, 'x', ctx), ctx);
  expect(back.clauses.map((c) => evalJql(c, snap, { description: '' }))).toEqual([true, true]);
});

test('JSON that is not a rule export is listed as unsupported, never a crash', () => {
  for (const bad of [{ hello: 1 }, { rules: [] }, { rules: 'x' }, null]) {
    expect(fromNativeRule(bad as never, ctx)).toMatchObject({ trigger: null, action: null, unsupported: ['no rule in export'] });
  }
});
