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

/** How much the model reasons before it answers; an adapter that can't set it ignores it. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * One way to reach a model. `zdr` (zero data retention) is staff's per-route choice: the gateway
 * passes it to the adapter (OpenRouter enforces it per request); on a direct provider it's the
 * account's contract.
 */
export interface ModelRoute {
  provider: string;
  model: string;
  zdr: boolean;
  /** OpenRouter only: pin the call to this endpoint (its `tag`, e.g. `deepinfra/turbo`). */
  endpoint?: string;
  /** Anthropic only (`output_config.effort`). */
  effort?: Effort;
  pricing?: Pricing;
  timeoutMs?: number;
}

/** A request as one adapter receives it: the routed model, no Venduá metadata. */
export interface ProviderRequest extends Omit<ModelRequest, 'meta' | 'tier'> {
  model: string;
  /** The route's `zdr`; an adapter that can enforce it per request does. */
  zdr?: boolean;
  /** The route's `endpoint`; an adapter that can pin one does. */
  endpoint?: string;
  /** The route's `effort`; an adapter that can set it does. */
  effort?: Effort;
}

export interface ProviderAdapter {
  readonly id: string;
  generate(req: ProviderRequest, signal: AbortSignal): Promise<ModelResponse>;
  /**
   * The most output tokens a call for `req` may bill, when it isn't `req.maxTokens` (a provider
   * that thinks on top of the reply). The pre-call estimate uses it.
   */
  outputTokens?(req: ProviderRequest): number;
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
