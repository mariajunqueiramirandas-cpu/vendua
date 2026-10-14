// monid.ai gateway driver — async providers return 202 + runId → poll /v1/runs/{id}.

const BASE = 'https://api.monid.ai';
const POLL_MS = 3_000;
const RUN_TIMEOUT_MS = 120_000;

export interface MonidResult<T> {
  output: T[];
  costUsd: number;
}

interface MonidRunResponse {
  output?: unknown;
  runId?: string;
  cost?: { value?: number; currency?: string } | number;
  price?: { amount?: number | { value?: number } };
}

interface MonidPollResponse {
  status?: string;
  output?: unknown;
  cost?: { value?: number; currency?: string } | number;
  error?: string;
}

function costOf(data: MonidRunResponse | MonidPollResponse, results: number): number {
  const c = data.cost;
  if (typeof c === 'number') return c;
  if (c && typeof c.value === 'number') return c.value;
  const p = (data as MonidRunResponse).price;
  const amount = typeof p?.amount === 'number' ? p.amount : p?.amount?.value;
  if (typeof amount === 'number') return amount * Math.max(1, results);
  return 0;
}

export async function monidRun(
  endpoint: { provider: string; endpoint: string },
  input: Record<string, unknown>,
  apiKey: string,
): Promise<MonidResult<Record<string, unknown>>> {
  const res = await fetch(`${BASE}/v1/run`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...endpoint, input }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(`monid run ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  let data = (await res.json()) as MonidRunResponse;

  if (res.status === 202 && data.runId) {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    for (;;) {
      if (Date.now() > deadline) throw new Error('monid run timed out');
      await new Promise((r) => setTimeout(r, POLL_MS));
      const pr = await fetch(`${BASE}/v1/runs/${data.runId}`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      const poll = (await pr.json()) as MonidPollResponse;
      if (poll.status === 'FAILED' || poll.status === 'failed') {
        throw new Error(`monid run failed: ${poll.error ?? 'provider error'}`);
      }
      if (poll.status === 'COMPLETED' || poll.status === 'completed' || poll.output) {
        data = poll as MonidRunResponse;
        break;
      }
    }
  }

  const output = Array.isArray(data.output)
    ? (data.output as Record<string, unknown>[])
    : data.output &&
        typeof data.output === 'object' &&
        Array.isArray((data.output as { results?: unknown[] }).results)
      ? ((data.output as { results: Record<string, unknown>[] }).results ?? [])
      : data.output == null
        ? []
        : [data.output as Record<string, unknown>];
  return { output, costUsd: costOf(data, output.length) };
}

// Tools reserve the estimate synchronously (parallel batches can't see a stale
// balance); a failed call keeps it — monid may still bill an accepted run.
export class MonidBudget {
  spent: number;
  /** runner journals it so a reclaimed run rebuilds the balance instead of re-spending the cap */
  onChange?: (spent: number) => void;
  constructor(
    private capUsd: number,
    startSpent = 0,
  ) {
    this.spent = startSpent;
  }
  cap(): number {
    return this.capUsd;
  }
  reserve(estimateUsd: number): void {
    if (this.spent + estimateUsd > this.capUsd) {
      throw new Error(
        `monid budget: ${this.spent.toFixed(3)} spent of ${this.capUsd.toFixed(2)} cap — chamada recusada. Use web_search/read_pages (tinyfish, sem custo monid).`,
      );
    }
    this.spent += estimateUsd;
    this.onChange?.(this.spent);
  }
  reconcile(estimateUsd: number, actualUsd: number): void {
    this.spent += actualUsd - estimateUsd;
    this.onChange?.(this.spent);
  }
}
