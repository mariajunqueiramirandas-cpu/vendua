import {
  costUsd,
  openAiCompatibleAdapter,
  ProviderError,
  type FetchLike,
  type ModelRoute,
  type ProviderAdapter,
  type ProviderRequest,
} from '@vendua/agent-runtime';

export const MISTRAL_LARGE_4 = 'mistral-large-4';
const LARGE_4_PRICING = { inputPerMTok: 0.7, cacheReadPerMTok: 0.07, outputPerMTok: 2.1 };

export const MISTRAL_PRIMARY_ROUTE = {
  provider: 'mistral',
  model: MISTRAL_LARGE_4,
  zdr: false,
  pricing: LARGE_4_PRICING,
} satisfies ModelRoute;

export const isMistralLarge4 = (model: string) =>
  model === MISTRAL_LARGE_4 || model === 'mistral-large-4-0';

// Large 4 counts reasoning against max_tokens. Reserve more room for longer sales,
// discovery and vision calls while keeping lower effort for classifiers and guards.
const REASONING_HEADROOM = { low: 8_192, medium: 16_384, high: 32_768 } as const;

function effortOf(req: ProviderRequest): keyof typeof REASONING_HEADROOM {
  if (req.maxTokens <= 600) return 'low';
  if (req.maxTokens <= 2_000) return 'medium';
  return 'high';
}

const outputTokens = (req: ProviderRequest) =>
  req.maxTokens + (isMistralLarge4(req.model) ? REASONING_HEADROOM[effortOf(req)] : 0);

export function mistralAdapter(apiKey: string, fetch?: FetchLike): ProviderAdapter {
  const adapter = openAiCompatibleAdapter({
    id: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKey,
    messageFormat: 'mistral',
    ...(fetch ? { fetch } : {}),
    outputTokens,
    extraBody: (req) => (isMistralLarge4(req.model) ? { reasoning_effort: effortOf(req) } : {}),
  });
  return {
    ...adapter,
    async generate(req, signal) {
      const result = await adapter.generate(req, signal);
      if (isMistralLarge4(req.model) && result.finish === 'length' && !result.text.trim()) {
        throw new ProviderError('mistral: reasoning exhausted the output allowance', {
          retryable: false,
          usage: {
            ...result.usage,
            costUsd: result.usage.costUsd || costUsd(result.usage, LARGE_4_PRICING),
          },
        });
      }
      return result;
    },
  };
}
