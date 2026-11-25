/**
 * Test A — reconstruction accuracy (PRD §16) on a slice of the Public Jira Dataset's Apache source.
 * The 5.8 GB Zenodo dump is a MongoDB archive, so we fetch the same kind of records (issue + full
 * changelog) straight from the public Apache Jira the dataset was scraped from (decision 2026-11-22).
 * Cached in data/public-jira-slice/ (gitignored). Writes docs/accuracy.md section A.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fromJira, reconstructionCheck, type RawHistory, type RawIssue } from '@wind-tunnel/engine';

const ROOT = new URL('../../../', import.meta.url).pathname;
const CACHE = `${ROOT}data/public-jira-slice`;
const BASE = 'https://issues.apache.org/jira';
const PROJECTS = ['ZOOKEEPER', 'KAFKA', 'HADOOP', 'SPARK', 'CASSANDRA'];
const PER_PROJECT = 100;
const START_AT = 500; // fixed offset so the slice is reproducible and not only the newest items
const FIELDS = 'project,created,summary,status,priority,resolution,issuetype,assignee,reporter,creator,labels,components,fixVersions';

async function getJson(url: string) {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'bruno-benchmark' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function slice(project: string): Promise<{ issue: RawIssue; histories: RawHistory[] }[]> {
  const file = `${CACHE}/${project}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const jql = encodeURIComponent(`project = ${project} ORDER BY key ASC`);
  const d = await getJson(`${BASE}/rest/api/2/search?jql=${jql}&startAt=${START_AT}&maxResults=${PER_PROJECT}&expand=changelog&fields=${FIELDS}`);
  const out = [];
  for (const it of d.issues) {
    let histories = it.changelog.histories;
    if (it.changelog.total > histories.length) histories = (await getJson(`${BASE}/rest/api/2/issue/${it.key}?expand=changelog&fields=${FIELDS}`)).changelog.histories;
    delete it.changelog;
    out.push({ issue: it, histories });
  }
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(out));
  return out;
}

const hash = (id: string) => createHash('sha256').update(`bench:${id}`).digest('hex').slice(0, 12);

const byField: Record<string, { checks: number; agree: number }> = {};
const misses: { key: string; field: string; expected: string | null; rebuilt: string | null }[] = [];
let issues = 0;
let remaps = 0;
let checks = 0;
let agree = 0;
for (const p of PROJECTS) {
  for (const { issue, histories } of await slice(p)) {
    const rec = fromJira(issue, histories, [], { hash });
    remaps += rec.remaps;
    const r = reconstructionCheck(rec);
    issues++;
    checks += r.checks;
    agree += r.agree;
    for (const [f, v] of Object.entries(r.byField)) {
      const b = (byField[f] ??= { checks: 0, agree: 0 });
      b.checks += v.checks;
      b.agree += v.agree;
    }
    misses.push(...r.misses);
  }
}

const pct = (a: number, c: number) => (c ? ((100 * a) / c).toFixed(2) + '%' : '—');
const date = new Date().toISOString().slice(0, 10);
const rows = Object.entries(byField).sort().map(([f, v]) => `| ${f} | ${v.checks} | ${v.agree} | ${pct(v.agree, v.checks)} |`).join('\n');
const missRows = misses.slice(0, 25).map((m) => `| ${m.key} | ${m.field} | \`${m.expected}\` | \`${m.rebuilt}\` |`).join('\n');
const section = `## Test A — reconstruction (run ${date})

Source: ${issues} issues (${PROJECTS.join(', ')}; ${PER_PROJECT} each from offset ${START_AT}, ordered by key) from the public Apache Jira, the Public Jira Dataset's largest source. Check: for every changelog change on a modelled field, the value rebuilt just after it (undoing all later changes from today's values) must equal the change's own "to" value. Delta fields (components, fix versions) are scored by inconsistencies found while normalising them.

**Result: ${agree} / ${checks} checks agree = ${pct(agree, checks)}** (pass bar ≥ 99%) — ${agree / checks >= 0.99 ? 'PASS' : 'FAIL'}

Also: ${remaps} component/fix-version changes referenced ids that were renumbered when the site was migrated (mostly SPARK, 2013–14); they were resolved by display name and are not counted as checks. Without that fallback the first run scored 97.67% (3,056 / 3,129).

| Field | Checks | Agree | Agreement |
|---|---|---|---|
${rows}

Misses (${misses.length}${misses.length > 25 ? ', first 25' : ''}):

| Item | Field | Change's "to" | Rebuilt |
|---|---|---|---|
${missRows || '| — | — | — | — |'}

Reproduce: \`pnpm --filter benchmark test-a\` (downloads the slice on first run, then uses the cache).
`;

const ACC = `${ROOT}docs/accuracy.md`;
const prev = existsSync(ACC) ? readFileSync(ACC, 'utf8') : '# Accuracy (PRD §16)\n\nAll numbers below come from real runs; misses are listed.\n\n';
const next = prev.includes('## Test A') ? prev.replace(/## Test A[\s\S]*?(?=\n## |$)/, section) : prev + section;
writeFileSync(ACC, next);
console.log(`test A: ${issues} issues, ${agree}/${checks} = ${pct(agree, checks)}, misses ${misses.length}`);
