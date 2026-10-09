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
  fast: 'responde as mensagens',
  strong: 'entra quando uma trava de segurança bloqueia uma resposta e o Duá refaz',
};

/** a per-1M-token price: 0,08 · 1,10 · 15 (cheap models need the 3rd and 4th decimals) */
export const fmtPrice = (n: number) =>
  n.toLocaleString('pt-BR', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 4,
  });

/** "US$ 1,10 / 1M entrada · 5,50 saída" */
export const fmtPricePair = (input: number | string, output: number | string) => {
  const f = (v: number | string) => {
    const n = typeof v === 'number' ? v : Number(v.trim().replace(',', '.'));
    return v === '' || !Number.isFinite(n) ? '?' : fmtPrice(n);
  };
  return `US$ ${f(input)} / 1M entrada · ${f(output)} saída`;
};

/** context window: "262 mil", "1 mi" (the decimal is noise here) */
export const fmtContextShort = (n: number) =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 0 }).format(n);
export const fmtContext = (n: number) => `${fmtContextShort(n)} tokens`;
