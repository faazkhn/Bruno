type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Minimal Jira REST client: basic auth, honours Retry-After on 429/503. */
export class Jira {
  private auth: string;
  constructor(
    readonly site: string,
    email: string,
    token: string,
    private fetchFn: Fetch = fetch,
  ) {
    this.auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
  }

  static fromEnv(): Jira {
    const { JIRA_SITE, JIRA_EMAIL, JIRA_TOKEN } = process.env;
    if (!JIRA_SITE || !JIRA_EMAIL || !JIRA_TOKEN) throw new Error('Set JIRA_SITE, JIRA_EMAIL, JIRA_TOKEN (see tools/history-bot/README.md)');
    return new Jira(JIRA_SITE, JIRA_EMAIL, JIRA_TOKEN);
  }

  get = <T = any>(path: string) => this.req<T>('GET', path); // eslint-disable-line @typescript-eslint/no-explicit-any
  post = <T = any>(path: string, body: unknown, headers?: Record<string, string>) => this.req<T>('POST', path, body, headers); // eslint-disable-line @typescript-eslint/no-explicit-any
  put = <T = any>(path: string, body: unknown) => this.req<T>('PUT', path, body); // eslint-disable-line @typescript-eslint/no-explicit-any

  private async req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, attempt = 0): Promise<T> {
    const r = await this.fetchFn(this.site + path, {
      method,
      headers: { Authorization: this.auth, Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if ((r.status === 429 || r.status === 503) && attempt < 5) {
      const wait = Number(r.headers.get('Retry-After') ?? 2 ** attempt);
      await new Promise((ok) => setTimeout(ok, wait * 1000));
      return this.req<T>(method, path, body, headers, attempt + 1);
    }
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 500)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
}
