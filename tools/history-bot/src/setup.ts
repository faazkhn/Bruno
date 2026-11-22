/**
 * One-time, idempotent site setup for the demo project (PRD §17).
 * Creates: Billing request type, Network component, organisations, portal customers.
 * Writes ids to data/site.json for the bot.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BOT_CONFIG, customersOf } from '@wind-tunnel/engine/sim';
import { Jira } from './jira';

const EXP = { 'X-ExperimentalApi': 'opt-in' };
/** BOT_DATA_DIR lets the launchd copy keep its state outside ~/Documents (macOS privacy prompts). */
export const DATA_DIR = process.env.BOT_DATA_DIR ?? new URL('../data', import.meta.url).pathname;
export const SITE_FILE = `${DATA_DIR}/site.json`;

export interface SiteIds {
  projectKey: string;
  serviceDeskId: string;
  requestTypes: Record<string, string>; // name → id
  defaultRequestType: string;
  components: Record<string, string>;
  customers: { email: string; org: string; accountId: string }[];
  orgs: Record<string, string>;
}

async function main() {
  const jira = Jira.fromEnv();
  const projectKey = process.env.WT_PROJECT ?? 'WT';
  const sd = await jira.get(`/rest/servicedeskapi/servicedesk/projectKey:${projectKey}`);
  const serviceDeskId: string = sd.id;

  const rts = (await jira.get(`/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype?limit=100`)).values as { id: string; name: string; issueTypeId: string }[];
  const getHelp = rts.find((r) => r.name === 'Get IT help');
  if (!getHelp) throw new Error('Request type "Get IT help" missing — use the IT service management template');
  if (!rts.some((r) => r.name === 'Billing')) {
    rts.push(await jira.post(`/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype`, { name: 'Billing', description: 'Invoices, charges and refunds', helpText: '', issueTypeId: getHelp.issueTypeId }, EXP));
  }

  const comps = (await jira.get(`/rest/api/3/project/${projectKey}/components`)) as { id: string; name: string }[];
  if (!comps.some((c) => c.name === 'Network')) comps.push(await jira.post('/rest/api/3/component', { name: 'Network', project: projectKey, description: 'Network queue' }));

  const existingOrgs = ((await jira.get('/rest/servicedeskapi/organization?limit=100')).values ?? []) as { id: string; name: string }[];
  const orgs: Record<string, string> = {};
  for (const o of BOT_CONFIG.orgs) {
    const found = existingOrgs.find((e) => e.name === o.name) ?? (await jira.post<{ id: string; name: string }>("/rest/servicedeskapi/organization", { name: o.name }, EXP));
    orgs[o.name] = found.id;
    await jira.post(`/rest/servicedeskapi/servicedesk/${serviceDeskId}/organization`, { organizationId: Number(found.id) }, EXP).catch(() => null);
  }

  const customers: SiteIds['customers'] = [];
  for (const c of customersOf()) {
    let accountId: string | undefined;
    try {
      accountId = (await jira.post('/rest/servicedeskapi/customer', { email: c.email, displayName: c.name }, EXP)).accountId;
    } catch {
      // already exists → look up by email
      const found = (await jira.get(`/rest/api/3/user/search?query=${encodeURIComponent(c.email)}`)) as { accountId: string }[];
      accountId = found[0]?.accountId;
    }
    if (!accountId) throw new Error(`could not create or find ${c.email}`);
    customers.push({ email: c.email, org: c.org, accountId });
  }
  await jira.post(`/rest/servicedeskapi/servicedesk/${serviceDeskId}/customer`, { accountIds: customers.map((c) => c.accountId) }, EXP);
  for (const o of BOT_CONFIG.orgs) {
    await jira.post(`/rest/servicedeskapi/organization/${orgs[o.name]}/user`, { accountIds: customers.filter((c) => c.org === o.name).map((c) => c.accountId) }, EXP);
  }

  const ids: SiteIds = {
    projectKey,
    serviceDeskId,
    requestTypes: Object.fromEntries(rts.map((r) => [r.name, r.id])),
    defaultRequestType: getHelp.id,
    components: Object.fromEntries(comps.map((c) => [c.name, c.id])),
    customers,
    orgs,
  };
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SITE_FILE, JSON.stringify(ids, null, 2));
  console.log(`setup ok: ${customers.length} customers, ${Object.keys(orgs).length} orgs, Billing=${ids.requestTypes.Billing}, Network=${ids.components.Network}`);
}

export const loadSite = (): SiteIds => JSON.parse(readFileSync(SITE_FILE, 'utf8'));

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(String(e)); process.exit(1); });
