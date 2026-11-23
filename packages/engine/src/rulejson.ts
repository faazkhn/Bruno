/**
 * Native Jira Automation rule JSON (PRD §12): generate an importable, DISABLED rule with a
 * signature action, and parse an exported rule back for "replay an existing rule".
 *
 * FORMAT UNVERIFIED: component type keys below follow Atlassian's documented export shape and
 * must be checked against a real export from our site (spike #2, docs/HUMAN_TODO.md). They live
 * only in REGISTRY so one real export fixes them all.
 */
import type { Action } from './candidates';
import { AUTOMATION_FOR_JIRA } from './jira';
import { parseJql, UnsupportedJql, type Expr } from './jql';
import { SET_FIELDS } from './model';
import type { Names } from './sentence';
import type { Trigger } from './triggers';

export const FORMAT_VERIFIED = false;

const REGISTRY = {
  created: 'jira.issue.event.trigger:created',
  transitioned: 'jira.issue.event.trigger:transitioned',
  commented: 'jira.issue.event.trigger:commented',
  fieldChanged: 'jira.issue.field.changed',
  jql: 'jira.jql.condition',
  compare: 'jira.comparator.condition',
  edit: 'jira.issue.edit',
  transition: 'jira.issue.transition',
  property: 'jira.set.entity.property',
};
export const SIGNATURE_KEY = 'windtunnel.run';

export interface SiteContext {
  projectId: string;
  projectTypeKey: string;
  fieldIds: { requestType: string; organizations: string };
  names: Names;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface NativeComponent { component: 'TRIGGER' | 'CONDITION' | 'ACTION'; type: string; schemaVersion: number; value: any; children: NativeComponent[]; conditions: NativeComponent[] }
export interface NativeRule {
  name: string;
  state: 'DISABLED' | 'ENABLED';
  created: number;
  updated: number;
  description: string;
  canOtherRuleTrigger: boolean;
  notifyOnError: string;
  actor: { type: 'ACCOUNT_ID'; value: string };
  trigger: NativeComponent;
  components: NativeComponent[];
  projects: { projectId: string; projectTypeKey: string }[];
  labels: string[];
}
export interface NativeExport { cloud: true; rules: NativeRule[]; connections?: unknown[] }

/** schemaVersion per component type, as real rules on a Cloud site carry them (196 rules read 2026-11-23); unknown → 1 */
const SCHEMA: Record<string, number> = { [REGISTRY.jql]: -1, [REGISTRY.fieldChanged]: 2, [REGISTRY.edit]: 12, [REGISTRY.transition]: 11, [REGISTRY.property]: 3 };
const comp = (component: NativeComponent['component'], type: string, value: any): NativeComponent => ({ component, type, schemaVersion: SCHEMA[type] ?? 1, value, children: [], conditions: [] });
/** Jira field type keys that edit operations carry */
const FIELD_TYPE: Record<string, string> = { requestType: 'com.atlassian.servicedesk:vp-origin', organizations: 'com.atlassian.servicedesk:sd-customer-organizations' };
const FIELD_BY_TYPE = Object.fromEntries(Object.entries(FIELD_TYPE).map(([k, v]) => [v, k]));

/** canonical field → JQL field name; `byName` = Jira needs display names, not ids, for this field */
const JQL_FIELD: Record<string, { jql: string; byName?: boolean }> = {
  requestType: { jql: '"Request Type"', byName: true },
  organizations: { jql: 'Organizations', byName: true },
  components: { jql: 'component' },
  fixVersions: { jql: 'fixVersion' },
  issuetype: { jql: 'issuetype' },
};
const nativeField = (f: string, ctx: SiteContext) => (f === 'requestType' ? ctx.fieldIds.requestType : f === 'organizations' ? ctx.fieldIds.organizations : f);
const q = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`;

/** Our JQL-subset clauses → native JQL for the site. */
export function nativeJql(clauses: Expr[], ctx: SiteContext): string {
  const field = (f: string) => JQL_FIELD[f]?.jql ?? f;
  const val = (f: string, v: string) => {
    if (JQL_FIELD[f]?.byName) return q(ctx.names.values?.[f]?.[v] ?? v);
    return /^\d+$/.test(v) && f !== 'labels' ? v : q(v);
  };
  const r = (e: Expr, top = false): string => {
    switch (e.op) {
      case 'and': return e.args.map((a) => r(a)).join(' AND ');
      case 'or': { const s = e.args.map((a) => r(a)).join(' OR '); return top ? s : `(${s})`; }
      case 'not': {
        // JQL's NOT skips empty fields; our engine counts them as "not equal" — make Jira agree.
        const f = 'field' in e.arg && e.arg.op !== 'contains' ? e.arg.field : null;
        return f ? `(NOT (${r(e.arg, true)}) OR ${field(f)} IS EMPTY)` : `NOT (${r(e.arg, true)})`;
      }
      case 'eq': return `${field(e.field)} = ${val(e.field, e.value)}`;
      case 'neq': return `(${field(e.field)} != ${val(e.field, e.value)} OR ${field(e.field)} IS EMPTY)`;
      case 'in': return `${field(e.field)} IN (${e.values.map((v) => val(e.field, v)).join(', ')})`;
      case 'notin': return `(${field(e.field)} NOT IN (${e.values.map((v) => val(e.field, v)).join(', ')}) OR ${field(e.field)} IS EMPTY)`;
      case 'empty': return `${field(e.field)} IS EMPTY`;
      case 'notempty': return `${field(e.field)} IS NOT EMPTY`;
      case 'contains': return `${e.field} ~ ${q(e.value)}`;
    }
  };
  return clauses.map((c) => r(c, clauses.length === 1)).join(' AND ');
}

function triggerComponents(t: Trigger, ctx: SiteContext): { trigger: NativeComponent; extra: NativeComponent[] } {
  switch (t.type) {
    case 'created': return { trigger: comp('TRIGGER', REGISTRY.created, { eventKey: 'jira:issue_created', issueEvent: 'issue_created', eventFilters: [] }), extra: [] };
    case 'statusTo': return { trigger: comp('TRIGGER', REGISTRY.transitioned, { fromStatus: [], toStatus: [{ type: 'ID', value: t.value }] }), extra: [] };
    case 'fieldChanged': return { trigger: comp('TRIGGER', REGISTRY.fieldChanged, { changeType: 'ANY_CHANGE', fields: [{ type: 'ID', value: nativeField(t.field, ctx) }], actions: [] }), extra: [] };
    case 'customerCommented':
      return {
        trigger: comp('TRIGGER', REGISTRY.commented, { eventTypes: [], eventFilters: [] }),
        extra: [comp('CONDITION', REGISTRY.compare, { first: '{{comment.author.accountType}}', second: 'customer', operator: 'EQUALS' })],
      };
  }
}

function actionComponent(a: Action, ctx: SiteContext): NativeComponent {
  if (a.kind === 'transition') return comp('ACTION', REGISTRY.transition, { operations: [], advancedFields: null, sendNotifications: false, destinationStatus: { type: 'ID', value: a.value }, transitionMatch: '' });
  const ref = { type: a.field === 'labels' ? 'NAME' : 'ID', value: a.value };
  const op = { field: { type: 'ID', value: nativeField(a.field, ctx) }, fieldType: FIELD_TYPE[a.field] ?? a.field, ...(a.kind === 'add' ? { type: 'ADDREMOVE', value: { ADD: [ref] } } : { type: 'SET', value: ref }) };
  return comp('ACTION', REGISTRY.edit, { operations: [op], advancedFields: null, sendNotifications: false });
}

export function toNativeRule(rule: { id: string; version: number; trigger: Trigger; clauses: Expr[]; action: Action }, name: string, ctx: SiteContext, now = Date.now()): NativeExport {
  const { trigger, extra } = triggerComponents(rule.trigger, ctx);
  const components = [...extra];
  if (rule.clauses.length) components.push(comp('CONDITION', REGISTRY.jql, nativeJql(rule.clauses, ctx)));
  components.push(actionComponent(rule.action, ctx));
  components.push(
    comp('ACTION', REGISTRY.property, {
      entityType: 'ISSUE',
      entity: null,
      key: SIGNATURE_KEY,
      value: JSON.stringify({ choreId: rule.id, version: rule.version, ts: '{{now.jiraDateTime}}' }),
    }),
  );
  return {
    cloud: true,
    connections: [],
    rules: [
      {
        name,
        state: 'DISABLED',
        created: now,
        updated: now,
        description: `Generated by Bruno (chore ${rule.id}, version ${rule.version}). Proven on this team's history before hand-off. Sets issue property ${SIGNATURE_KEY} when it runs so live results can be tracked.`,
        canOtherRuleTrigger: false,
        notifyOnError: 'FIRSTERROR',
        actor: { type: 'ACCOUNT_ID', value: AUTOMATION_FOR_JIRA },
        trigger,
        components,
        projects: [{ projectId: ctx.projectId, projectTypeKey: ctx.projectTypeKey }],
        labels: [],
      },
    ],
  };
}

/** Collapse our own "(NOT X OR f IS EMPTY)" guard back into NOT X (same semantics in the engine). */
function unguard(e: Expr): Expr {
  if (e.op === 'and') return { op: 'and', args: e.args.map(unguard) };
  if (e.op === 'or' && e.args.length === 2) {
    const [a, b] = e.args;
    if (b?.op === 'empty' && a && 'field' in (a.op === 'not' ? a.arg : a)) {
      if (a.op === 'not') return { op: 'not', arg: a.arg };
      if (a.op === 'neq' || a.op === 'notin') return a;
    }
  }
  if (e.op === 'or') return { op: 'or', args: e.args.map(unguard) };
  return e;
}

const NAMED_FIELD: Record<string, string> = { 'request type': 'requestType', organizations: 'organizations', components: 'components', component: 'components', labels: 'labels', priority: 'priority', assignee: 'assignee' };

/** Parse an exported rule (first rule) back into a replayable rule; anything we can't model is listed. */
export function fromNativeRule(exp: NativeExport, ctx: SiteContext): { trigger: Trigger | null; clauses: Expr[]; action: Action | null; unsupported: string[] } {
  const rule = Array.isArray(exp?.rules) ? exp.rules[0] : undefined;
  const unsupported: string[] = [];
  if (!rule) return { trigger: null, clauses: [], action: null, unsupported: ['no rule in export'] };
  const fieldOf = (id: string) => (id === ctx.fieldIds.requestType ? 'requestType' : id === ctx.fieldIds.organizations ? 'organizations' : id);
  const reverse = (f: string, v: string) => {
    const byName = Object.entries(ctx.names.values?.[f] ?? {}).find(([, n]) => n.toLowerCase() === v.toLowerCase());
    return byName ? byName[0] : v;
  };

  let trigger: Trigger | null = null;
  const t = rule.trigger;
  if (t.type === REGISTRY.created) trigger = { type: 'created' };
  else if (t.type === REGISTRY.transitioned && t.value?.toStatus?.length === 1) trigger = { type: 'statusTo', value: String(t.value.toStatus[0].value) };
  else if (t.type === REGISTRY.fieldChanged && t.value?.fields?.length === 1) trigger = { type: 'fieldChanged', field: fieldOf(String(t.value.fields[0].value)) };
  else if (t.type === REGISTRY.commented) trigger = { type: 'customerCommented' };
  else unsupported.push(`trigger ${t.type}`);

  const clauses: Expr[] = [];
  let action: Action | null = null;
  for (const c of rule.components) {
    if (c.component === 'CONDITION' && c.type === REGISTRY.jql) {
      try {
        const e = unguard(
          parseJql(String(c.value), {
            aliases: { 'request type': 'requestType', organizations: 'organizations', component: 'components', fixversion: 'fixVersions' },
            resolve: (f, v) => reverse(f, v),
          }),
        );
        clauses.push(...(e.op === 'and' ? e.args : [e]));
      } catch (err) {
        if (!(err instanceof UnsupportedJql)) throw err;
        unsupported.push(`JQL: ${c.value}`);
      }
    } else if (c.component === 'CONDITION' && c.type === REGISTRY.compare && c.value?.first === '{{comment.author.accountType}}' && trigger?.type === 'customerCommented') {
      // part of our customer-commented trigger
    } else if (c.component === 'ACTION' && c.type === REGISTRY.property && c.value?.key === SIGNATURE_KEY) {
      // our signature
    } else if (c.component === 'ACTION' && c.type === REGISTRY.transition && !action) {
      const d = c.value?.destinationStatus;
      action = { kind: 'transition', field: 'status', value: d?.type === 'NAME' ? reverse('status', String(d.value)) : String(d?.value) };
    } else if (c.component === 'ACTION' && c.type === REGISTRY.edit && !action && c.value?.operations?.length === 1) {
      const op = c.value.operations[0];
      const field = FIELD_BY_TYPE[op.fieldType] ?? (op.field?.type === 'NAME' ? NAMED_FIELD[String(op.field.value).toLowerCase()] ?? String(op.field.value) : fieldOf(String(op.field.value)));
      const adds = op.type === 'ADDREMOVE' && !op.value?.REMOVE?.length && op.value?.ADD?.length === 1 ? op.value.ADD[0] : null;
      const raw = adds ?? op.value;
      const value = typeof raw === 'string' ? raw : raw?.type === 'NAME' && field !== 'labels' ? reverse(field, String(raw.value)) : String(raw?.value);
      if ((op.type === 'ADD' || adds) && SET_FIELDS.has(field)) action = { kind: 'add', field, value };
      else if (op.type === 'SET' && !SET_FIELDS.has(field)) action = { kind: 'set', field, value };
      else unsupported.push(`edit ${op.type} ${field}`);
    } else {
      unsupported.push(`${c.component.toLowerCase()} ${c.type}`);
    }
  }
  return { trigger, clauses, action, unsupported };
}
