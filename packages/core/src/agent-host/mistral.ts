import {
  costUsd,
  openAiCompatibleAdapter,
  ProviderError,
  type FetchLike,
  type ModelRoute,
  type ProviderAdapter,
  type ProviderRequest,
} from '@vendua/agent-runtime';

// The Mistral primary is DeepSeek V4.1 Flash, hosted by Mistral (public preview). The id is the one
// Mistral's model page gives; a live key checks it against /v1/models in the CRM's picker.
export const MISTRAL_DEEPSEEK_V4_1 = 'deepseek-v4-1-flash-1017';
export const MISTRAL_LARGE_4 = 'mistral-large-4';
const DEEPSEEK_V4_1_PRICING = { inputPerMTok: 0.3, cacheReadPerMTok: 0.007, outputPerMTok: 1.2 };
const LARGE_4_PRICING = { inputPerMTok: 0.7, cacheReadPerMTok: 0.07, outputPerMTok: 2.1 };

export const MISTRAL_PRIMARY_ROUTE = {
  provider: 'mistral',
  model: MISTRAL_DEEPSEEK_V4_1,
  zdr: false,
  pricing: DEEPSEEK_V4_1_PRICING,
} satisfies ModelRoute;

export const isMistralPrimary = (model: string) => model === MISTRAL_DEEPSEEK_V4_1;

const isLarge4 = (model: string) => model === MISTRAL_LARGE_4 || model === 'mistral-large-4-0';

// Both reason before answering, and the reasoning counts against max_tokens (seen on Large 4; the
// DeepSeek model is tagged as a reasoning model, so it gets the same room until a live call says
// otherwise). Only Large 4 takes reasoning_effort: Mistral documents it there and nowhere else.
const isReasoner = (model: string) => isLarge4(model) || isMistralPrimary(model);
const REASONING_HEADROOM = { low: 8_192, medium: 16_384, high: 32_768 } as const;

function effortOf(req: ProviderRequest): keyof typeof REASONING_HEADROOM {
  if (req.maxTokens <= 600) return 'low';
  if (req.maxTokens <= 2_000) return 'medium';
  return 'high';
}

const outputTokens = (req: ProviderRequest) =>
  req.maxTokens + (isReasoner(req.model) ? REASONING_HEADROOM[effortOf(req)] : 0);

export function mistralAdapter(apiKey: string, fetch?: FetchLike): ProviderAdapter {
  const adapter = openAiCompatibleAdapter({
    id: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKey,
    messageFormat: 'mistral',
    ...(fetch ? { fetch } : {}),
    outputTokens,
    extraBody: (req) => (isLarge4(req.model) ? { reasoning_effort: effortOf(req) } : {}),
  });
  const pricing = (model: string) => (isLarge4(model) ? LARGE_4_PRICING : DEEPSEEK_V4_1_PRICING);
  return {
    ...adapter,
    async generate(req, signal) {
      const result = await adapter.generate(req, signal);
      if (isReasoner(req.model) && result.finish === 'length' && !result.text.trim()) {
        throw new ProviderError('mistral: reasoning exhausted the output allowance', {
          retryable: false,
          usage: {
            ...result.usage,
            costUsd: result.usage.costUsd || costUsd(result.usage, pricing(req.model)),
          },
        });
      }
      return result;
    },
  };
}
