import { expect, test } from 'vitest';
import { Jira } from '../src/jira';

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers });

test('retries after a 429 using Retry-After, then returns the body', async () => {
  const calls: number[] = [];
  const replies = [res(429, {}, { 'Retry-After': '0' }), res(200, { ok: 1 })];
  const jira = new Jira('https://x.atlassian.net', 'a@b.c', 't', async () => {
    calls.push(Date.now());
    return replies.shift()!;
  });
  expect(await jira.get('/rest/api/3/myself')).toEqual({ ok: 1 });
  expect(calls).toHaveLength(2);
});

test('throws with status and body on other errors, never the token', async () => {
  const jira = new Jira('https://x.atlassian.net', 'a@b.c', 'secret-token', async () => res(400, { errors: { summary: 'bad' } }));
  await expect(jira.post('/rest/api/3/issue', {})).rejects.toThrow(/400.*summary/);
  await expect(jira.post('/rest/api/3/issue', {})).rejects.not.toThrow(/secret-token/);
});

test('204 responses resolve to null', async () => {
  const jira = new Jira('https://x.atlassian.net', 'a@b.c', 't', async () => res(204, null));
  expect(await jira.put('/rest/api/3/issue/WT-1', {})).toBeNull();
});
