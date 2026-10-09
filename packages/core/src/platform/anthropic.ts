import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';

/**
 * Every direct Anthropic call runs this model, whatever a route or the CRM's integration names
 * (staff decision, 2026-10-08); effort is the one thing they choose.
 */
export const ANTHROPIC_MODEL = 'claude-haiku-5-5';

export type Effort = NonNullable<Anthropic.OutputConfig['effort']>;
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies Effort[];
/** Haiku 5.5's own default, sent explicitly so an API default change can't move it */
export const DEFAULT_EFFORT: Effort = 'medium';
export const isEffort = (v: unknown): v is Effort => EFFORTS.includes(v as Effort);

/**
 * Haiku 5.5 always thinks and the thinking counts toward max_tokens, while a caller's limit is
 * sized for the visible reply (the supervisor's is 120: cut off before its verdict, it would pass
 * everything). Added on top of that limit, by effort.
 */
export const THINKING_HEADROOM: Record<Effort, number> = {
  low: 2_048,
  medium: 4_096,
  high: 8_192,
  xhigh: 16_384,
  max: 32_000,
};

/** List price in US$ per 1M tokens; a prompt over 100K tokens bills at the long card. */
export const ANTHROPIC_PRICING = { inputPerMTok: 0.1, outputPerMTok: 0.5 };
export const ANTHROPIC_LONG_PRICING = { inputPerMTok: 0.5, outputPerMTok: 2.5 };
export const LONG_PROMPT_TOKENS = 100_000;

/**
 * An Anthropic SDK client on exactly the key it's given and api.anthropic.com. Passing
 * `authToken: null` and `baseURL` keeps the SDK from reading ANTHROPIC_AUTH_TOKEN /
 * ANTHROPIC_BASE_URL: a cloud dev container sets those for its own Claude Code session.
 */
export function anthropicClient(o: {
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  baseURL?: string;
  fetch?: ClientOptions['fetch'];
}): Anthropic {
  return new Anthropic({
    apiKey: o.apiKey,
    authToken: null,
    baseURL: o.baseURL ?? 'https://api.anthropic.com',
    timeout: o.timeoutMs,
    maxRetries: o.maxRetries,
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
}

/** A classifier declines with HTTP 200 and `stop_reason: "refusal"`: "refusal (cyber)", else null. */
export function refusalOf(msg: Anthropic.Message): string | null {
  if (msg.stop_reason !== 'refusal') return null;
  const category = msg.stop_details?.category;
  return category ? `refusal (${category})` : 'refusal';
}
