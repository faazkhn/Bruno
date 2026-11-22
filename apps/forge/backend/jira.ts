/** Jira REST through Forge (asApp for background work, asUser where a person is acting). */
import { asApp, asUser, route } from '@forge/api';
import type { RawComment, RawHistory, RawIssue } from '@wind-tunnel/engine';

type Requester = ReturnType<typeof asApp>;
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function call<T = any>(who: Requester, path: ReturnType<typeof route>, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}, attempt = 0): Promise<T> {
  const r = await who.requestJira(path, {
    method: init.method ?? 'GET',
    headers: { Accept: 'application/json', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  });
  if (r.status === 429 && attempt < 5) {
    const wait = Number(r.headers.get('Retry-After') ?? 2 ** attempt);
    await new Promise((ok) => setTimeout(ok, Math.min(wait, 30) * 1000));
    return call<T>(who, path, init, attempt + 1);
  }
  const text = await r.text();
  if (!r.ok) throw new Error(`Jira ${r.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export interface FieldIds { requestType?: string; organizations?: string }

export async function fieldIds(): Promise<FieldIds> {
  const fields = await call<{ id: string; schema?: { custom?: string } }[]>(asApp(), route`/rest/api/3/field`);
  return {
    requestType: fields.find((f) => f.schema?.custom === 'com.atlassian.servicedesk:vp-origin')?.id,
    organizations: fields.find((f) => f.schema?.custom === 'com.atlassian.servicedesk:sd-customer-organizations')?.id,
  };
}

const BASE_FIELDS = ['project', 'created', 'updated', 'summary', 'description', 'status', 'priority', 'issuetype', 'resolution', 'assignee', 'reporter', 'creator', 'labels', 'components', 'fixVersions', 'comment'];

export async function searchPage(jql: string, ids: FieldIds, nextPageToken?: string): Promise<{ issues: RawIssue[]; nextPageToken?: string }> {
  const fields = [...BASE_FIELDS, ...(ids.requestType ? [ids.requestType] : []), ...(ids.organizations ? [ids.organizations] : [])];
  return call(asApp(), route`/rest/api/3/search/jql`, { method: 'POST', body: { jql, fields, maxResults: 50, ...(nextPageToken ? { nextPageToken } : {}) } });
}

/** Bulk changelog (spike #6): POST /rest/api/3/changelog/bulkfetch, paged. */
export async function changelogs(issueIds: string[]): Promise<Map<string, RawHistory[]>> {
  const out = new Map<string, RawHistory[]>();
  let nextPageToken: string | undefined;
  do {
    const r: any = await call(asApp(), route`/rest/api/3/changelog/bulkfetch`, { method: 'POST', body: { issueIdsOrKeys: issueIds, maxResults: 1000, ...(nextPageToken ? { nextPageToken } : {}) } });
    for (const l of r.issueChangeLogs ?? []) out.set(String(l.issueId), [...(out.get(String(l.issueId)) ?? []), ...l.changeHistories]);
    nextPageToken = r.nextPageToken;
  } while (nextPageToken);
  return out;
}

export const commentsOf = (issue: RawIssue): RawComment[] => (issue.fields.comment?.comments ?? []) as RawComment[];

/** Display names for ids, used only to write sentences and native JQL. */
export async function names(projectKey: string): Promise<Record<string, Record<string, string>>> {
  const app = asApp();
  const safe = async <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const [statuses, priorities, components, requestTypes, orgs, types] = await Promise.all([
    safe(call<any[]>(app, route`/rest/api/3/status`), []),
    safe(call<any[]>(app, route`/rest/api/3/priority`), []),
    safe(call<any[]>(app, route`/rest/api/3/project/${projectKey}/components`), []),
    safe(call<any>(app, route`/rest/servicedeskapi/requesttype?limit=100`), { values: [] }),
    safe(call<any>(app, route`/rest/servicedeskapi/organization?limit=100`), { values: [] }),
    safe(call<any[]>(app, route`/rest/api/3/issuetype`), []),
  ]);
  const map = (xs: any[]) => Object.fromEntries((xs ?? []).map((x) => [String(x.id), String(x.name)]));
  return {
    status: map(statuses), priority: map(priorities), components: map(components), requestType: map(requestTypes.values),
    organizations: map(orgs.values), issuetype: map(types),
  };
}

/** Status ids in the "done" category: moving work there needs human judgment. */
export async function doneStatuses(): Promise<string[]> {
  const xs = await call<any[]>(asApp(), route`/rest/api/3/status`).catch(() => []);
  return xs.filter((x) => x.statusCategory?.key === 'done').map((x) => String(x.id));
}

export async function canBrowse(projectKey: string): Promise<boolean> {
  const r = await call<any>(asUser(), route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=BROWSE_PROJECTS`).catch(() => null);
  return !!r?.permissions?.BROWSE_PROJECTS?.havePermission;
}
