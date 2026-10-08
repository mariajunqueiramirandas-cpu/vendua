import type { DesignSpec } from './spec.ts';

// Who builds a site task. The Claude Code routine is fired over HTTP (`/fire`) and has no
// idempotency key, so a fire is never retried automatically: an unclear answer escalates.

/** What the routine's skill reads, exactly (≤ 60 KB). */
export interface FireTask {
  taskId: string;
  kind: 'generate' | 'revision';
  slug: string;
  storeName: string;
  segment: string | null;
  spec: DesignSpec;
  note: string | null;
  assets: { logo: string | null; photos: string[] };
  branch: string;
  base: 'main';
  label: string;
  marker: string;
  maxFixPushes: number;
  dueAt: string;
}

export interface SiteRunner {
  start(task: FireTask): Promise<{ sessionId: string | null; sessionUrl: string | null }>;
}

/** refused = the routine answered 4xx (nothing ran); uncertain = it may have started */
export class FireError extends Error {
  constructor(
    public outcome: 'refused' | 'uncertain',
    message: string,
  ) {
    super(message);
  }
}

const FIRE_TIMEOUT_MS = 20_000;
export const ENVELOPE_MAX_BYTES = 60 * 1024;

export function claudeRoutineRunner(o: {
  url: string;
  token: string;
  fetch?: typeof fetch;
}): SiteRunner {
  const f = o.fetch ?? fetch;
  return {
    async start(task) {
      const text = JSON.stringify(task);
      if (Buffer.byteLength(text, 'utf8') > ENVELOPE_MAX_BYTES)
        throw new FireError('refused', 'envelope maior que 60 KB');
      let res: Response;
      try {
        res = await f(o.url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${o.token}`,
            'anthropic-beta': 'experimental-cc-routine-2026-04-01',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
        });
      } catch (err) {
        throw new FireError('uncertain', `rede: ${(err as Error).message ?? 'erro'}`.slice(0, 200));
      }
      if (res.status >= 400 && res.status < 500) {
        await res.body?.cancel().catch(() => undefined);
        throw new FireError('refused', String(res.status));
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new FireError('uncertain', String(res.status));
      }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const str = (v: unknown, max: number) =>
        typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
      const url = str(body.claude_code_session_url, 500);
      return {
        sessionId: str(body.claude_code_session_id, 200),
        sessionUrl: url && /^https:\/\//.test(url) ? url : null,
      };
    },
  };
}

/** Staff push the branch themselves: nothing to start. */
export const humanRunner: SiteRunner = {
  async start() {
    return { sessionId: null, sessionUrl: null };
  },
};
