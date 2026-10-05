import type { ModelRequest, ModelResponse, Tier, Usage } from '../types.ts';

export interface Pricing {
  /** USD per million tokens. */
  inputPerMTok: number;
  outputPerMTok: number;
  /** Defaults to 0.1× input. */
  cacheReadPerMTok?: number;
  /** Defaults to 1.25× input. */
  cacheWritePerMTok?: number;
}

/**
 * One way to reach a model. `zdr` (zero data retention) is staff's per-route choice: the gateway
 * passes it to the adapter (OpenRouter enforces it per request); on a direct provider it's the
 * account's contract.
 */
export interface ModelRoute {
  provider: string;
  model: string;
  zdr: boolean;
  pricing?: Pricing;
  timeoutMs?: number;
}

/** A request as one adapter receives it: the routed model, no Venduá metadata. */
export interface ProviderRequest extends Omit<ModelRequest, 'meta' | 'tier'> {
  model: string;
  /** The route's `zdr`; an adapter that can enforce it per request does. */
  zdr?: boolean;
}

export interface ProviderAdapter {
  readonly id: string;
  generate(req: ProviderRequest, signal: AbortSignal): Promise<ModelResponse>;
}

export interface RouteResolver {
  /** Ordered: the primary route first, then fallbacks. */
  routes(tenantId: string, agentId: string, tier: Tier): Promise<ModelRoute[]>;
}

export interface CostEstimate {
  inputTokens: number;
  maxOutputTokens: number;
  costUsd: number;
}

/** Budgets: `before` throws `BudgetExceededError` to stop a call; `after` records the actual. */
export interface Meter {
  before(estimate: CostEstimate): void | Promise<void>;
  after(usage: Usage): void | Promise<void>;
}

export interface GenerateOpts {
  meter?: Meter;
  signal?: AbortSignal;
  /** Interactive lane: send a second request when the first passes the route's p95. */
  hedge?: boolean;
}

export interface ModelGateway {
  generate(req: ModelRequest, opts?: GenerateOpts): Promise<ModelResponse>;
}
