import { createHmac, timingSafeEqual } from 'node:crypto';

// The repository the storefronts live in: merge an approved PR, read a merged storefront's
// templates. Every call is bounded by a timeout; tests inject `fetch`.

const API = 'https://api.github.com';
const TIMEOUT_MS = 20_000;
const FILE_MAX_BYTES = 256 * 1024;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface GitHubClient {
  repo: string;
  /** squash-merges the PR at exactly `sha`; GitHubError 405/409 when GitHub refuses it */
  merge(pr: number, sha: string): Promise<{ sha: string | null }>;
  /** names of the files in a directory at `ref`; null when the directory doesn't exist */
  listDir(path: string, ref: string): Promise<string[] | null>;
  /** a file's text at `ref`; null when it doesn't exist */
  readFile(path: string, ref: string): Promise<string | null>;
  /** the check runs reported on a commit (first 100) */
  checkRuns(sha: string): Promise<CheckRun[]>;
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

const RED = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure']);
/** the jobs of ci.yml a storefront PR must pass; a labeled re-run skips them */
export const REQUIRED_CHECKS = ['check', 'conformance'] as const;

/** Whether a head may be merged: the latest run of each check finished, none red, and the
 *  required ones green. Null = mergeable; otherwise why not, and whether it is still running. */
export function checksVerdict(runs: CheckRun[]): { reason: string; pending: boolean } | null {
  const latest = new Map<string, CheckRun>();
  for (const r of runs) {
    const cur = latest.get(r.name);
    if (!cur || r.id > cur.id) latest.set(r.name, r);
  }
  const running = [...latest.values()].filter((r) => r.status !== 'completed');
  if (running.length)
    return {
      reason: `checks em andamento: ${running.map((r) => r.name).join(', ')}`,
      pending: true,
    };
  const red = [...latest.values()].filter((r) => r.conclusion && RED.has(r.conclusion));
  if (red.length)
    return { reason: `checks vermelhos: ${red.map((r) => r.name).join(', ')}`, pending: false };
  const missing = REQUIRED_CHECKS.filter((n) => latest.get(n)?.conclusion !== 'success');
  if (missing.length)
    return { reason: `checks sem sucesso: ${missing.join(', ')}`, pending: false };
  return null;
}

export function githubClient(o: {
  repo: string;
  token: string;
  fetch?: typeof fetch;
}): GitHubClient | null {
  if (!REPO_RE.test(o.repo)) return null;
  const f = o.fetch ?? fetch;
  const call = (path: string, init: RequestInit & { accept?: string } = {}) =>
    f(`${API}/repos/${o.repo}${path}`, {
      ...init,
      headers: {
        accept: init.accept ?? 'application/vnd.github+json',
        authorization: `Bearer ${o.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'vendua-core',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  const fail = async (res: Response, what: string): Promise<never> => {
    const text = await res.text().catch(() => '');
    let msg = text.slice(0, 200);
    try {
      msg = String((JSON.parse(text) as { message?: unknown }).message ?? msg).slice(0, 200);
    } catch {
      // not JSON: keep the text
    }
    throw new GitHubError(res.status, `${what}: ${res.status} ${msg}`.trim());
  };
  const contentsPath = (path: string, ref: string) =>
    `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`;

  return {
    repo: o.repo,
    async merge(pr, sha) {
      const res = await call(`/pulls/${pr}/merge`, {
        method: 'PUT',
        body: JSON.stringify({ merge_method: 'squash', sha }),
      });
      if (!res.ok) return fail(res, 'merge');
      const body = (await res.json().catch(() => ({}))) as { sha?: unknown };
      return { sha: typeof body.sha === 'string' ? body.sha.slice(0, 64) : null };
    },
    async listDir(path, ref) {
      const res = await call(contentsPath(path, ref));
      if (res.status === 404) return null;
      if (!res.ok) return fail(res, 'contents');
      const body = (await res.json()) as unknown;
      if (!Array.isArray(body)) return null;
      return body
        .filter((e) => e && typeof e === 'object' && (e as { type?: unknown }).type === 'file')
        .map((e) => String((e as { name?: unknown }).name ?? ''))
        .filter(Boolean);
    },
    async checkRuns(sha) {
      const res = await call(`/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`);
      if (!res.ok) return fail(res, 'check-runs');
      const body = (await res.json()) as { check_runs?: unknown };
      if (!Array.isArray(body.check_runs)) return [];
      return body.check_runs.flatMap((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return typeof o.id === 'number' && typeof o.name === 'string'
          ? [
              {
                id: o.id,
                name: o.name,
                status: String(o.status ?? ''),
                conclusion: typeof o.conclusion === 'string' ? o.conclusion : null,
              },
            ]
          : [];
      });
    },
    async readFile(path, ref) {
      const res = await call(contentsPath(path, ref), {
        accept: 'application/vnd.github.raw+json',
      });
      if (res.status === 404) return null;
      if (!res.ok) return fail(res, 'contents');
      const text = await res.text();
      if (Buffer.byteLength(text, 'utf8') > FILE_MAX_BYTES)
        throw new GitHubError(413, `${path} maior que ${FILE_MAX_BYTES} bytes`);
      return text;
    },
  };
}

/** `X-Hub-Signature-256: sha256=<hex>` over the raw body. */
export function validSignature(raw: string, header: string | undefined, secret: string): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const want = createHmac('sha256', secret).update(raw, 'utf8').digest();
  const got = Buffer.from(header.slice(7), 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}
