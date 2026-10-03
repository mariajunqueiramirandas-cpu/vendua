import type { MemoryKeyPolicy } from '../define/agent.ts';
import type { MemoryProposal } from '../define/tool.ts';

export type MemoryDecision =
  | { accept: true; sensitive: boolean }
  | { accept: false; reason: 'not_allowlisted' | 'low_confidence' | 'no_consent' | 'too_large' };

const KEY = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){0,3}$/;

function matches(pattern: string, key: string): boolean {
  return pattern.endsWith('.*') ? key.startsWith(pattern.slice(0, -1)) : pattern === key;
}

/** Writes are proposals: only allowlisted keys, confident enough, sensitive ones with consent. */
export function decide(keys: readonly MemoryKeyPolicy[], p: MemoryProposal): MemoryDecision {
  const policy = KEY.test(p.key) ? keys.find((k) => matches(k.key, p.key)) : undefined;
  if (!policy) return { accept: false, reason: 'not_allowlisted' };
  if (JSON.stringify(p.value).length > 500) return { accept: false, reason: 'too_large' };
  if (p.confidence < (policy.minConfidence ?? 0.7))
    return { accept: false, reason: 'low_confidence' };
  if (policy.sensitive && p.consent !== true) return { accept: false, reason: 'no_consent' };
  return { accept: true, sensitive: policy.sensitive === true };
}
