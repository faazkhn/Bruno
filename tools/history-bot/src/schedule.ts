import { planDay, type PlannedAction, type PlannedRequest, type SimConfig } from '@wind-tunnel/engine/sim';

const DAY = 86_400_000;

export type Job =
  | { type: 'create'; id: string; requestId: string; dueAt: number; request: PlannedRequest }
  | { type: 'action'; id: string; requestId: string; dueAt: number; action: PlannedAction };

/** All jobs of plan day `day`, in due order. Drops what the single live account cannot do. */
export function jobsForDay(config: SimConfig, startMidnight: number, day: number, seed: number): Job[] {
  // shortcut: fixed 24 h days ignore DST shifts (±1 h twice a year), fine for demo history
  const base = startMidnight + day * DAY;
  const notLive = new Set(config.chores.filter((c) => !c.live).map((c) => c.id));
  const jobs: Job[] = [];
  planDay(config, day, seed).forEach((request, i) => {
    const requestId = `${day}:${i}`;
    const at = base + request.at;
    jobs.push({ type: 'create', id: `${requestId}:c`, requestId, dueAt: at, request });
    request.actions.forEach((action, k) => {
      if (action.kind === 'customerComment' || (action.planted && notLive.has(action.planted))) return;
      jobs.push({ type: 'action', id: `${requestId}:${k}`, requestId, dueAt: at + action.afterMs, action });
    });
  });
  return jobs.sort((a, b) => a.dueAt - b.dueAt);
}

/** Jobs due by `now`, not done, belonging to requests created after the bot started (restart-safe). */
export function dueJobs(config: SimConfig, startMidnight: number, startedAt: number, now: number, done: Set<string>, seed: number): Job[] {
  const today = Math.floor((now - startMidnight) / DAY);
  const out: Job[] = [];
  for (let d = Math.max(0, today - 2); d <= today; d++) {
    const jobs = jobsForDay(config, startMidnight, d, seed);
    const created = new Set(jobs.filter((j) => j.type === 'create' && j.dueAt >= startedAt).map((j) => j.requestId));
    for (const j of jobs) if (created.has(j.requestId) && j.dueAt <= now && !done.has(j.id)) out.push(j);
  }
  return out.sort((a, b) => a.dueAt - b.dueAt);
}
