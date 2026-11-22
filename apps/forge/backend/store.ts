/** Forge SQL (event log as one engine record per issue, chores, hand-offs, live runs, nudges) + KVS (settings, progress, names). */
import { kvs } from '@forge/kvs';
import { migrationRunner, sql } from '@forge/sql';
import { DEFAULT_SETTINGS, type IssueRecord, type Settings } from '@wind-tunnel/engine';
import type { ChoreStatus, StoredChore } from './logic';

let migrated = false;
export async function migrate() {
  if (migrated) return;
  await migrationRunner
    .enqueue('v001_issues', 'CREATE TABLE IF NOT EXISTS issues (project_key VARCHAR(32) NOT NULL, issue_id VARCHAR(32) NOT NULL, issue_key VARCHAR(64) NOT NULL, updated_ms BIGINT NOT NULL, record LONGTEXT NOT NULL, PRIMARY KEY (project_key, issue_id))')
    .enqueue('v002_chores', 'CREATE TABLE IF NOT EXISTS chores (project_key VARCHAR(32) NOT NULL, chore_id VARCHAR(191) NOT NULL, version INT NOT NULL, status VARCHAR(16) NOT NULL, data LONGTEXT NOT NULL, updated_ms BIGINT NOT NULL, PRIMARY KEY (project_key, chore_id))')
    .enqueue('v003_handoffs', 'CREATE TABLE IF NOT EXISTS handoffs (project_key VARCHAR(32) NOT NULL, chore_id VARCHAR(191) NOT NULL, version INT NOT NULL, handoff_key VARCHAR(64) NOT NULL, status VARCHAR(16) NOT NULL, created_ms BIGINT NOT NULL, PRIMARY KEY (project_key, chore_id, version))')
    .enqueue('v004_live_runs', 'CREATE TABLE IF NOT EXISTS live_runs (project_key VARCHAR(32) NOT NULL, chore_id VARCHAR(191) NOT NULL, issue_id VARCHAR(32) NOT NULL, run_ms BIGINT NOT NULL, reversed TINYINT NOT NULL DEFAULT 0, PRIMARY KEY (project_key, chore_id, issue_id, run_ms))')
    .enqueue('v005_nudges', 'CREATE TABLE IF NOT EXISTS nudges (project_key VARCHAR(32) NOT NULL, issue_id VARCHAR(32) NOT NULL, user_hash VARCHAR(64) NOT NULL, chore_id VARCHAR(191) NOT NULL, created_ms BIGINT NOT NULL, state VARCHAR(16) NOT NULL, PRIMARY KEY (issue_id, user_hash, chore_id))')
    .run();
  migrated = true;
}

const lastTs = (r: IssueRecord) => [r.events.at(-1)?.ts, r.createdAt, Date.now()].find((x) => Number.isFinite(x)) as number;

export async function putIssues(projectKey: string, recs: IssueRecord[]) {
  await migrate();
  for (const r of recs) {
    await sql
      .prepare('INSERT INTO issues (project_key, issue_id, issue_key, updated_ms, record) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE issue_key = VALUES(issue_key), updated_ms = VALUES(updated_ms), record = VALUES(record)')
      .bindParams(projectKey, r.id, r.key, lastTs(r), JSON.stringify(r))
      .execute();
  }
}

export async function getIssues(projectKey: string): Promise<IssueRecord[]> {
  await migrate();
  const out: IssueRecord[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await sql.prepare<{ record: string }>('SELECT record FROM issues WHERE project_key = ? ORDER BY issue_id LIMIT 500 OFFSET ?').bindParams(projectKey, offset).execute();
    out.push(...r.rows.map((x) => JSON.parse(x.record) as IssueRecord));
    if (r.rows.length < 500) return out;
  }
}

export async function getIssue(projectKey: string, issueId: string): Promise<IssueRecord | null> {
  await migrate();
  const r = await sql.prepare<{ record: string }>('SELECT record FROM issues WHERE project_key = ? AND issue_id = ?').bindParams(projectKey, issueId).execute();
  return r.rows[0] ? JSON.parse(r.rows[0].record) : null;
}

export interface ChoreRow { chore: StoredChore; status: ChoreStatus; updated: number }

export async function getChores(projectKey: string): Promise<ChoreRow[]> {
  await migrate();
  const r = await sql.prepare<{ data: string; status: ChoreStatus; updated_ms: number }>('SELECT data, status, updated_ms FROM chores WHERE project_key = ?').bindParams(projectKey).execute();
  return r.rows.map((x) => ({ chore: JSON.parse(x.data), status: x.status, updated: Number(x.updated_ms) }));
}

export async function putChore(projectKey: string, chore: StoredChore, status: ChoreStatus) {
  await migrate();
  await sql
    .prepare('INSERT INTO chores (project_key, chore_id, version, status, data, updated_ms) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE version = VALUES(version), status = VALUES(status), data = VALUES(data), updated_ms = VALUES(updated_ms)')
    .bindParams(projectKey, chore.id, chore.version, status, JSON.stringify(chore), Date.now())
    .execute();
}

export async function setChoreStatus(projectKey: string, choreId: string, status: ChoreStatus) {
  await migrate();
  await sql.prepare('UPDATE chores SET status = ?, updated_ms = ? WHERE project_key = ? AND chore_id = ?').bindParams(status, Date.now(), projectKey, choreId).execute();
}

export async function deleteChoresExcept(projectKey: string, keep: string[]) {
  const rows = await getChores(projectKey);
  for (const r of rows) {
    if (!keep.includes(r.chore.id) && r.status === 'new') await sql.prepare('DELETE FROM chores WHERE project_key = ? AND chore_id = ?').bindParams(projectKey, r.chore.id).execute();
  }
}

export async function addHandoff(projectKey: string, choreId: string, version: number, key: string) {
  await migrate();
  await sql.prepare('INSERT INTO handoffs (project_key, chore_id, version, handoff_key, status, created_ms) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE handoff_key = VALUES(handoff_key)').bindParams(projectKey, choreId, version, key, 'open', Date.now()).execute();
}

export async function getHandoffs(projectKey: string) {
  await migrate();
  return (await sql.prepare<{ chore_id: string; version: number; handoff_key: string; status: string; created_ms: number }>('SELECT * FROM handoffs WHERE project_key = ?').bindParams(projectKey).execute()).rows;
}

export async function addLiveRun(projectKey: string, choreId: string, issueId: string, runMs: number) {
  await migrate();
  await sql.prepare('INSERT IGNORE INTO live_runs (project_key, chore_id, issue_id, run_ms, reversed) VALUES (?, ?, ?, ?, 0)').bindParams(projectKey, choreId, issueId, runMs).execute();
}

export async function getLiveRuns(projectKey: string, sinceMs: number) {
  await migrate();
  return (await sql.prepare<{ chore_id: string; issue_id: string; run_ms: number; reversed: number }>('SELECT chore_id, issue_id, run_ms, reversed FROM live_runs WHERE project_key = ? AND run_ms >= ?').bindParams(projectKey, sinceMs).execute()).rows;
}

export async function markReversed(projectKey: string, choreId: string, issueId: string, runMs: number) {
  await sql.prepare('UPDATE live_runs SET reversed = 1 WHERE project_key = ? AND chore_id = ? AND issue_id = ? AND run_ms = ?').bindParams(projectKey, choreId, issueId, runMs).execute();
}

export async function addNudge(projectKey: string, issueId: string, userHash: string, choreId: string) {
  await migrate();
  // max one nudge per user per chore per day (PRD §13): keep an existing recent one
  const r = await sql.prepare<{ created_ms: number }>('SELECT created_ms FROM nudges WHERE issue_id = ? AND user_hash = ? AND chore_id = ?').bindParams(issueId, userHash, choreId).execute();
  if (r.rows[0]) return;
  const day = await sql.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM nudges WHERE user_hash = ? AND chore_id = ? AND created_ms > ?').bindParams(userHash, choreId, Date.now() - 86_400_000).execute();
  if (Number(day.rows[0]?.n ?? 0) > 0) return;
  await sql.prepare('INSERT INTO nudges (project_key, issue_id, user_hash, chore_id, created_ms, state) VALUES (?, ?, ?, ?, ?, ?)').bindParams(projectKey, issueId, userHash, choreId, Date.now(), 'pending').execute();
}

export async function getNudges(issueId: string, userHash: string) {
  await migrate();
  return (await sql.prepare<{ project_key: string; chore_id: string; created_ms: number; state: string }>("SELECT project_key, chore_id, created_ms, state FROM nudges WHERE issue_id = ? AND user_hash = ? AND state = 'pending'").bindParams(issueId, userHash).execute()).rows;
}

export async function setNudgeState(issueId: string, userHash: string, choreId: string, state: 'seen' | 'dismissed') {
  await sql.prepare('UPDATE nudges SET state = ? WHERE issue_id = ? AND user_hash = ? AND chore_id = ?').bindParams(state, issueId, userHash, choreId).execute();
}

// ---- KVS ----
export type AppSettings = Settings & { adminProjectKey?: string };
export const getSettings = async (p: string): Promise<AppSettings> => ({ ...DEFAULT_SETTINGS, ...((await kvs.get<Partial<Settings>>(`settings:${p}`)) ?? {}) });
export const putSettings = (p: string, s: Partial<AppSettings>) => kvs.set(`settings:${p}`, s);

export interface Progress { phase: 'idle' | 'listing' | 'fetching' | 'mining' | 'proving' | 'done' | 'error'; done: number; startedAt: number; finishedAt?: number; error?: string }
export const getProgress = async (p: string): Promise<Progress> => (await kvs.get<Progress>(`progress:${p}`)) ?? { phase: 'idle', done: 0, startedAt: 0 };
export const putProgress = (p: string, v: Progress) => kvs.set(`progress:${p}`, v);

export const getNames = async (p: string) => (await kvs.get<Record<string, Record<string, string>>>(`names:${p}`)) ?? {};
export const putNames = (p: string, v: Record<string, Record<string, string>>) => kvs.set(`names:${p}`, v);
export const getFieldIds = async (p: string) => (await kvs.get<{ requestType?: string; organizations?: string }>(`fields:${p}`)) ?? {};
export const putFieldIds = (p: string, v: object) => kvs.set(`fields:${p}`, v);

export interface AnalysisMeta { window: { start: number; cut: number; end: number }; runAt: number; issues: number; unexplained: { id: string; count: number; reason: string }[] }
export const getAnalysisMeta = (p: string) => kvs.get<AnalysisMeta>(`analysis:${p}`);
export const putAnalysisMeta = (p: string, v: AnalysisMeta) => kvs.set(`analysis:${p}`, v);

export const putWeekly = (p: string, v: object) => kvs.set(`weekly:${p}`, v);
export const getWeekly = (p: string) => kvs.get<object>(`weekly:${p}`);

export async function projects(): Promise<string[]> { return (await kvs.get<string[]>('projects')) ?? []; }
export async function addProject(p: string) { const ps = await projects(); if (!ps.includes(p)) await kvs.set('projects', [...ps, p]); }

export async function notAChore(userHash: string): Promise<string[]> { return (await kvs.get<string[]>(`notchore:${userHash}`)) ?? []; }
export async function addNotAChore(userHash: string, choreId: string) { const xs = await notAChore(userHash); if (!xs.includes(choreId)) await kvs.set(`notchore:${userHash}`, [...xs, choreId]); }

/** Salted actor hash (PRD §9 privacy). Salt is generated once per installation and never leaves storage. */
let salt: string | undefined;
export async function hasher(): Promise<(id: string) => string> {
  if (!salt) {
    salt = await kvs.getSecret<string>('salt');
    if (!salt) {
      salt = crypto.randomUUID();
      await kvs.setSecret('salt', salt);
    }
  }
  const { createHash } = await import('node:crypto');
  const s = salt;
  return (id: string) => createHash('sha256').update(`${s}:${id}`).digest('hex').slice(0, 32);
}
