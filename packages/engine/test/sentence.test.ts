import { expect, test } from 'vitest';
import { parseJql } from '../src/jql';
import { sentence, type Names } from '../src/sentence';

const names: Names = {
  values: {
    requestType: { '320': 'Get IT help', '339': 'Billing' },
    organizations: { '4': 'Initech' },
    status: { '3': 'In Progress', '10004': 'Waiting for support' },
    priority: { '1': 'Highest', '3': 'Medium' },
    components: { '10132': 'Network' },
  },
};
const j = (q: string) => parseJql(q);

test('the PRD example reads as one sentence', () => {
  expect(sentence({ trigger: { type: 'created' }, clauses: [j('requestType = 320'), j('summary ~ invoice')], action: { kind: 'set', field: 'requestType', value: '339' } }, names))
    .toBe("When a work item is created, if Request type is Get IT help and summary mentions “invoice”, set Request type to Billing");
});

test('OR keywords, exclusions, sets and transitions', () => {
  expect(sentence({ trigger: { type: 'created' }, clauses: [j('summary ~ outage OR summary ~ down'), j('NOT organizations = 4')], action: { kind: 'set', field: 'priority', value: '1' } }, names))
    .toBe('When a work item is created, if summary mentions “outage” or “down” and Organization is not Initech, set Priority to Highest');
  expect(sentence({ trigger: { type: 'customerCommented' }, clauses: [], action: { kind: 'transition', field: 'status', value: '3' } }, names))
    .toBe('When a customer comments, move it to In Progress');
  expect(sentence({ trigger: { type: 'statusTo', value: '10004' }, clauses: [j('priority in (1, 3)'), j('labels = vip')], action: { kind: 'add', field: 'components', value: '10132' } }, names))
    .toBe('When Status changes to Waiting for support, if Priority is Highest or Medium and Labels include vip, add Network to Component');
  expect(sentence({ trigger: { type: 'fieldChanged', field: 'priority' }, clauses: [j('assignee is EMPTY')], action: { kind: 'add', field: 'labels', value: 'urgent' } }, names))
    .toBe('When Priority changes, if Assignee is empty, add label urgent');
});

test('unknown ids fall back to the id, never crash', () => {
  expect(sentence({ trigger: { type: 'created' }, clauses: [j('priority = 9')], action: { kind: 'set', field: 'priority', value: '9' } }, {}))
    .toBe('When a work item is created, if Priority is 9, set Priority to 9');
});
