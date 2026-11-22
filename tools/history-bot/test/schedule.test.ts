import { expect, test } from 'vitest';
import { BOT_CONFIG } from '@wind-tunnel/engine/sim';
import { dueJobs, jobsForDay } from '../src/schedule';

const DAY = 86_400_000;
const midnight = new Date(2026, 10, 22).getTime();

test('a day expands into create jobs before their actions, ids are stable', () => {
  const jobs = jobsForDay(BOT_CONFIG, midnight, 0, 7);
  expect(jobs.length).toBeGreaterThan(100);
  expect(jobsForDay(BOT_CONFIG, midnight, 0, 7).map((j) => j.id)).toEqual(jobs.map((j) => j.id));
  for (const j of jobs.filter((x) => x.type === 'action')) {
    const create = jobs.find((c) => c.id === `${j.requestId}:c`)!;
    expect(j.dueAt).toBeGreaterThanOrEqual(create.dueAt);
  }
});

test('jobs the single live account cannot do are dropped', () => {
  const jobs = jobsForDay(BOT_CONFIG, midnight, 0, 7);
  expect(jobs.some((j) => j.type === 'action' && j.action.kind === 'customerComment')).toBe(false);
  expect(jobs.some((j) => j.type === 'action' && j.action.planted === 'customer-reply')).toBe(false);
});

test('dueJobs skips done jobs and jobs due before the bot started, and is ordered', () => {
  const startedAt = midnight + 12 * 3_600_000;
  const now = midnight + DAY + 3_600_000;
  const first = dueJobs(BOT_CONFIG, midnight, startedAt, now, new Set(), 7);
  expect(first.every((j) => j.dueAt >= startedAt && j.dueAt <= now)).toBe(true);
  expect(first.map((j) => j.dueAt)).toEqual([...first.map((j) => j.dueAt)].sort((a, b) => a - b));
  const done = new Set(first.slice(0, 10).map((j) => j.id));
  const second = dueJobs(BOT_CONFIG, midnight, startedAt, now, done, 7);
  expect(second).toHaveLength(first.length - 10);
});

test('an action whose request was created before the bot started is skipped too', () => {
  const startedAt = midnight + 12 * 3_600_000;
  const jobs = dueJobs(BOT_CONFIG, midnight, startedAt, midnight + 2 * DAY, new Set(), 7);
  const createdIds = new Set(jobs.filter((j) => j.type === 'create').map((j) => j.requestId));
  expect(jobs.filter((j) => j.type === 'action').every((j) => createdIds.has(j.requestId))).toBe(true);
});
