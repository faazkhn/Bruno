import { SET_FIELDS, toSet, type Event, type IssueRecord } from './model';
import type { Range, Settings } from './settings';

export interface Action { kind: 'set' | 'add' | 'transition'; field: string; value: string }
export interface Occ { issue: IssueRecord; event: Event }
export interface Candidate {
  id: string;
  action: Action;
  occurrences: Occ[];
  items: number;
  people: number;
  bulkCollapsed: number;
}

/** Free text and side effects of other actions are never chores (PRD §6). */
const NEVER = new Set(['summary', 'description', 'resolution']);
const BULK_WINDOW_MS = 60_000;
const BULK_MIN_ITEMS = 5;

export const actionId = (a: Action) => `${a.kind}:${a.field}:${a.value}`;

/** What a human did in this event, as catalogue actions (C1–C4). */
export function actionOf(e: Event): Action[] {
  if (e.kind !== 'field' || e.actorKind !== 'human_agent' || !e.field || NEVER.has(e.field)) return [];
  if (e.field === 'status') return e.to ? [{ kind: 'transition', field: 'status', value: e.to }] : [];
  if (SET_FIELDS.has(e.field)) {
    const before = new Set(toSet(e.from));
    return toSet(e.to).filter((v) => !before.has(v)).map((value) => ({ kind: 'add', field: e.field!, value }));
  }
  return e.to ? [{ kind: 'set', field: e.field, value: e.to }] : [];
}

/** Does this human event perform `a`? */
export const performs = (e: Event, a: Action) => actionOf(e).some((x) => x.kind === a.kind && x.field === a.field && x.value === a.value);

export function findCandidates(issues: IssueRecord[], range: Range, s: Settings): Candidate[] {
  const groups = new Map<string, { action: Action; occ: Occ[] }>();
  for (const issue of issues) {
    for (const event of issue.events) {
      if (event.ts < range.from || event.ts >= range.to) continue;
      for (const action of actionOf(event)) {
        if (s.excludedFields.includes(action.field)) continue;
        const id = actionId(action);
        const g = groups.get(id) ?? { action, occ: [] };
        g.occ.push({ issue, event });
        groups.set(id, g);
      }
    }
  }

  const out: Candidate[] = [];
  for (const [id, g] of groups) {
    const bulk = bulkOccurrences(g.occ);
    const occurrences = g.occ.filter((o) => !bulk.has(o));
    const items = new Set(occurrences.map((o) => o.issue.id)).size;
    const people = new Set(occurrences.map((o) => o.event.actorHash)).size;
    if (occurrences.length >= s.minCount && items >= s.minCount && people >= s.minPeople) {
      out.push({ id, action: g.action, occurrences, items, people, bulkCollapsed: bulk.size });
    }
  }
  return out.sort((a, b) => b.occurrences.length - a.occurrences.length || a.id.localeCompare(b.id));
}

/** Same person, same action, >= 5 different items within 60 s → bulk edit (collapsed, PRD §10). */
function bulkOccurrences(occ: Occ[]): Set<Occ> {
  const bulk = new Set<Occ>();
  const byPerson = new Map<string, Occ[]>();
  for (const o of occ) {
    const l = byPerson.get(o.event.actorHash);
    if (l) l.push(o);
    else byPerson.set(o.event.actorHash, [o]);
  }
  for (const list of byPerson.values()) {
    list.sort((a, b) => a.event.ts - b.event.ts);
    let i = 0;
    for (let j = 0; j < list.length; j++) {
      while (list[j]!.event.ts - list[i]!.event.ts > BULK_WINDOW_MS) i++;
      const win = list.slice(i, j + 1);
      if (new Set(win.map((o) => o.issue.id)).size >= BULK_MIN_ITEMS) win.forEach((o) => bulk.add(o));
    }
  }
  return bulk;
}
