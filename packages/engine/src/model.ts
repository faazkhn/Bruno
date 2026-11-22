export type ActorKind = 'human_agent' | 'customer' | 'automation' | 'app';

export interface Event {
  issueId: string;
  ts: number;
  /** global order within the issue (ties on ts keep changelog order) */
  seq: number;
  actorKind: ActorKind;
  actorHash: string;
  kind: 'created' | 'field' | 'comment';
  /** canonical field for 'field' events; 'public' | 'internal' for comments */
  field?: string;
  from?: string | null;
  to?: string | null;
}

export interface IssueRecord {
  id: string;
  key: string;
  projectKey: string;
  createdAt: number;
  /** modelled fields now: ids, sets as sorted ','-joined strings, null when empty */
  current: Record<string, string | null>;
  text: { summary: string; description: string };
  reporterHash: string;
  /** sorted by seq; events[0] is 'created' */
  events: Event[];
  /** per field: changelog inconsistencies seen while normalising delta fields (test A evidence) */
  anomalies: Record<string, number>;
  /** delta items whose id was renumbered (site migration), resolved by display name */
  remaps: number;
  /** when the description was edited (we keep only today's text, so clauses on it are unknown before an edit) */
  descriptionEdits?: number[];
}

export type Snapshot = Record<string, string | null>;

export const MODELLED_FIELDS = ['status', 'priority', 'resolution', 'issuetype', 'assignee', 'labels', 'components', 'fixVersions', 'summary', 'requestType', 'organizations'] as const;
export const SET_FIELDS = new Set(['labels', 'components', 'fixVersions', 'organizations']);

export const toSet = (v: string | null | undefined): string[] => (v ? v.split(',') : []);
export const fromSet = (xs: Iterable<string>): string | null => {
  const s = [...new Set(xs)].filter(Boolean).sort();
  return s.length ? s.join(',') : null;
};
