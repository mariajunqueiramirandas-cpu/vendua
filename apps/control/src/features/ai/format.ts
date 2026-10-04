import type { ModelProviderId, ModelTier } from '@/lib/api.ts';
import { fmtUsd } from '@/lib/format.ts';

/** Core's USD floats, the app-wide format */
export const fmtUsdAi = fmtUsd;

export const fmtInt = (n: number) => n.toLocaleString('pt-BR');

/** 1.2 mi / 34 mil — token counts get big fast. */
export const fmtCompact = (n: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export const PROVIDER_LABEL: Record<ModelProviderId, string> = {
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  gemini: 'Gemini',
};
export const providerLabel = (id: string) => PROVIDER_LABEL[id as ModelProviderId] ?? id;

export const TIER_LABEL: Record<ModelTier, string> = { fast: 'rápido', strong: 'forte' };
export const TIER_HINT: Record<ModelTier, string> = {
  fast: 'o padrão: atende toda resposta',
  strong: 'entra quando uma trava bloqueia a resposta e o Duá refaz',
};
