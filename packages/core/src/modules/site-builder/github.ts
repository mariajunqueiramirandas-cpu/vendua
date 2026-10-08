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
