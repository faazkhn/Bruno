/** Every learned rule must read as a sentence (PRD §11). */
import type { Action } from './candidates';
import type { Expr } from './jql';
import { SET_FIELDS } from './model';
import type { Trigger } from './triggers';

export interface Names {
  fields?: Record<string, string>;
  /** field → id → display name */
  values?: Record<string, Record<string, string>>;
}

const LABELS: Record<string, string> = {
  requestType: 'Request type', priority: 'Priority', status: 'Status', components: 'Component', labels: 'Labels',
  organizations: 'Organization', assignee: 'Assignee', issuetype: 'Work type', summary: 'summary', description: 'description',
  fixVersions: 'Fix version', resolution: 'Resolution',
};

export function sentence(rule: { trigger: Trigger; clauses: Expr[]; action: Action }, names: Names): string {
  const f = (field: string) => names.fields?.[field] ?? LABELS[field] ?? field;
  const v = (field: string, id: string) => names.values?.[field]?.[id] ?? id;
  const or = (xs: string[]) => xs.join(' or ');

  const clause = (e: Expr, neg = false): string => {
    switch (e.op) {
      case 'not': return clause(e.arg, !neg);
      case 'and': return e.args.map((a) => clause(a, neg)).join(neg ? ' or ' : ' and ');
      case 'or': {
        if (e.args.every((a) => a.op === 'contains' && a.field === (e.args[0] as { field: string }).field)) {
          const field = (e.args[0] as { field: string }).field;
          return `${f(field)} ${neg ? 'mentions none of' : 'mentions'} ${or(e.args.map((a) => `“${(a as { value: string }).value}”`))}`;
        }
        return e.args.map((a) => clause(a, neg)).join(neg ? ' and ' : ' or ');
      }
      case 'contains': return `${f(e.field)} ${neg ? 'does not mention' : 'mentions'} “${e.value}”`;
      case 'eq':
      case 'neq': {
        const is = (e.op === 'eq') !== neg;
        return SET_FIELDS.has(e.field) && e.field !== 'organizations'
          ? `${f(e.field)} ${is ? 'include' : 'do not include'} ${v(e.field, e.value)}`
          : `${f(e.field)} is ${is ? '' : 'not '}${v(e.field, e.value)}`;
      }
      case 'in':
      case 'notin': {
        const is = (e.op === 'in') !== neg;
        return `${f(e.field)} is ${is ? '' : 'not '}${or(e.values.map((x) => v(e.field, x)))}`;
      }
      case 'empty':
      case 'notempty': return `${f(e.field)} is ${(e.op === 'empty') !== neg ? 'empty' : 'set'}`;
    }
  };

  const t = rule.trigger;
  const when =
    t.type === 'created' ? 'When a work item is created'
      : t.type === 'customerCommented' ? 'When a customer comments'
        : t.type === 'statusTo' ? `When ${f('status')} changes to ${v('status', t.value)}`
          : `When ${f(t.field)} changes`;
  const a = rule.action;
  const then =
    a.kind === 'transition' ? `move it to ${v('status', a.value)}`
      : a.kind === 'add' ? (a.field === 'labels' ? `add label ${a.value}` : `add ${v(a.field, a.value)} to ${f(a.field)}`)
        : `set ${f(a.field)} to ${v(a.field, a.value)}`;
  const conds = rule.clauses.map((c) => clause(c));
  return conds.length ? `${when}, if ${conds.join(' and ')}, ${then}` : `${when}, ${then}`;
}
