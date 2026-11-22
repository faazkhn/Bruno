import type { Event, IssueRecord, Snapshot } from './model';

/** Undo field events matching `undo`, latest first, starting from current values. */
function rebuild(issue: IssueRecord, undo: (e: Event) => boolean): Snapshot {
  const snap: Snapshot = { ...issue.current };
  for (let i = issue.events.length - 1; i >= 0; i--) {
    const e = issue.events[i]!;
    if (e.kind === 'field' && e.field && undo(e)) snap[e.field] = e.from ?? null;
  }
  return snap;
}

/** Modelled fields as they were at time t (events at exactly t included); null before creation. */
export function snapshotAt(issue: IssueRecord, t: number): Snapshot | null {
  if (t < issue.createdAt) return null;
  return rebuild(issue, (e) => e.ts > t);
}

/** Fields just before event `e` happened (e and everything after it undone). */
export function snapshotBefore(issue: IssueRecord, e: Event): Snapshot {
  return rebuild(issue, (x) => x.seq >= e.seq);
}

/** When the status last changed at or before t (creation if never). */
export function statusSince(issue: IssueRecord, t: number): number {
  let since = issue.createdAt;
  for (const e of issue.events) if (e.ts <= t && e.kind === 'field' && e.field === 'status') since = e.ts;
  return since;
}

/** Fields just after event `e` (everything later undone). */
export function snapshotAfter(issue: IssueRecord, e: Event): Snapshot {
  return rebuild(issue, (x) => x.seq > e.seq);
}
