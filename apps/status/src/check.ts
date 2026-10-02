import type { CheckSpec, ComponentSpec } from './config.ts';

/** ok · slow (answered, but past SLOW_MS) · down · unknown (we couldn't tell: a bot challenge) */
export type State = 'ok' | 'slow' | 'down' | 'unknown';

export interface CheckResult {
  state: State;
  ms: number | null;
  /** why it failed, for the workflow log (never rendered) */
  detail?: string;
}

export const SLOW_MS = 5_000;
const TIMEOUT_MS = 15_000;
const ATTEMPTS = 3;
const UA = 'VenduaStatus/1 (+https://status.vendua.com.br)';

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

async function attempt(spec: CheckSpec, fetchFn: Fetch): Promise<CheckResult> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetchFn(spec.url, {
      headers: { 'user-agent': UA, 'cache-control': 'no-cache' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { state: 'down', ms: null, detail: `${spec.url}: ${(e as Error).message}` };
  }
  const body = await res.text().catch(() => '');
  const ms = Math.round(performance.now() - t0);
  // Cloudflare challenging the runner says nothing about Venduá
  if (res.headers.get('cf-mitigated') === 'challenge')
    return { state: 'unknown', ms, detail: `${spec.url}: cloudflare challenge` };
  if (res.status !== 200) return { state: 'down', ms, detail: `${spec.url}: HTTP ${res.status}` };
  if (res.headers.get('x-vendua-edge-stale') === '1')
    return { state: 'down', ms, detail: `${spec.url}: edge served a stale answer` };
  if (spec.text && !body.includes(spec.text))
    return { state: 'down', ms, detail: `${spec.url}: missing ${spec.text}` };
  if (spec.json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { state: 'down', ms, detail: `${spec.url}: not JSON` };
    }
    if (!spec.json(parsed)) return { state: 'down', ms, detail: `${spec.url}: unexpected JSON` };
  }
  return { state: ms > SLOW_MS ? 'slow' : 'ok', ms };
}

/** Retries a failure before believing it: one lost packet from a GitHub runner isn't an outage. */
export async function runCheck(
  spec: CheckSpec,
  fetchFn: Fetch = fetch,
  pauseMs = 3_000,
): Promise<CheckResult> {
  let last: CheckResult = { state: 'down', ms: null };
  for (let i = 0; i < ATTEMPTS; i++) {
    if (i) await Bun.sleep(pauseMs);
    last = await attempt(spec, fetchFn);
    if (last.state === 'ok' || last.state === 'slow') return last;
  }
  return last;
}

const RANK: Record<State, number> = { unknown: 0, ok: 1, slow: 2, down: 3 };

/** A component is as bad as its worst check; `unknown` only when nothing could be told. */
export function worst(results: CheckResult[]): CheckResult {
  const known = results.filter((r) => r.state !== 'unknown');
  if (!known.length) return results[0] ?? { state: 'unknown', ms: null };
  return known.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a));
}

/** Probes on different stores: one answering is enough (a store can be deleted or mid-change). */
export function best(results: CheckResult[]): CheckResult {
  const up = results.filter((r) => r.state === 'ok' || r.state === 'slow');
  if (up.length) return up.reduce((a, b) => (RANK[b.state] < RANK[a.state] ? b : a));
  return worst(results);
}

export async function checkComponent(
  c: ComponentSpec,
  fetchFn: Fetch = fetch,
  pauseMs = 3_000,
): Promise<CheckResult> {
  const results = await Promise.all(c.checks.map((s) => runCheck(s, fetchFn, pauseMs)));
  // no store to probe is not an outage of the stores: say we couldn't tell
  if (!results.length) return { state: 'unknown', ms: null, detail: `${c.id}: no store to probe` };
  return c.anyOf ? best(results) : worst(results);
}
