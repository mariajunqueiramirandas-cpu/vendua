import { validateTokens, type StorefrontTokens, type TemplateSet } from '@vendua/templates';
import type { SurfacesEnvelope } from './api.ts';

// Kernel 1.10: the edge inlines Core's `/storefront/v1/surfaces?design=1` as
// window.__VENDUA_STATE__. Its templates and tokens are the store's live design, so the first
// paint is the merchant's current look with no rebuild and no fetch.

function injected(): SurfacesEnvelope | undefined {
  const v = (globalThis as Record<string, unknown>).__VENDUA_STATE__;
  return v && typeof v === 'object' ? (v as SurfacesEnvelope) : undefined;
}

export function injectedTokens(): StorefrontTokens | null {
  const t = injected()?.tokens;
  if (!t) return null;
  const v = validateTokens(t);
  return v.ok ? v.tokens : null;
}

export function injectedTemplates(): TemplateSet {
  const t = injected()?.templates;
  return t && typeof t === 'object' && !Array.isArray(t) ? t : {};
}
