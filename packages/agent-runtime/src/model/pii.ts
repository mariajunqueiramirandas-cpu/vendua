import type { ChatMessage, Json, ModelResponse, Part } from '../types.ts';

// Shopper phones and emails never reach a provider: each becomes a token for the length of one
// call and is put back in what the model returns. Numbering follows order of appearance, so an
// unchanged transcript redacts to the same bytes and the provider's prompt cache still hits.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE = new RegExp(
  [
    // +55 (11) 91234-5678, 11 91234 5678, 5511912345678, (11) 3456-7890
    String.raw`(?<![\w+])(?:\+?55[\s.-]?)?(?:\(\s?\d{2}\s?\)\s?|\d{2}[\s.-]?)9?\d{4}[\s.-]?\d{4}(?!\w)`,
    // bare runs of 10–13 digits (with or without +)
    String.raw`(?<![\w+.-])\+?\d{10,13}(?!\w)`,
    // 91234-5678 without area code
    String.raw`(?<![\w-])9\d{4}-\d{4}(?!\w)`,
  ].join('|'),
  'g',
);
const TOKEN = /⟦(tel|email)(\d+)⟧/g;

export interface PiiVault {
  /** token → original */
  readonly tokens: Map<string, string>;
  readonly byValue: Map<string, string>;
  readonly counts: { tel: number; email: number };
}

export function createPiiVault(): PiiVault {
  return { tokens: new Map(), byValue: new Map(), counts: { tel: 0, email: 0 } };
}

function tokenFor(vault: PiiVault, kind: 'tel' | 'email', value: string): string {
  const known = vault.byValue.get(value);
  if (known) return known;
  const token = `⟦${kind}${++vault.counts[kind]}⟧`;
  vault.byValue.set(value, token);
  vault.tokens.set(token, value);
  return token;
}

export function redactText(text: string, vault: PiiVault): string {
  return text
    .replace(EMAIL, (m) => tokenFor(vault, 'email', m))
    .replace(PHONE, (m) => tokenFor(vault, 'tel', m));
}

export function restoreText(text: string, vault: PiiVault): string {
  return text.replace(TOKEN, (m) => vault.tokens.get(m) ?? m);
}

function mapStrings(value: Json, fn: (s: string) => string): Json {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn);
    return out;
  }
  return value;
}

function redactPart(p: Part, vault: PiiVault): Part {
  if (p.type === 'text') return { ...p, text: redactText(p.text, vault) };
  if (p.type === 'image' && p.description !== undefined) {
    return { ...p, description: redactText(p.description, vault) };
  }
  if (p.type === 'audio' && p.transcript !== undefined) {
    return { ...p, transcript: redactText(p.transcript, vault) };
  }
  return p;
}

/** Redacts message text (all roles, so a number the model repeated keeps its token) and volatile. */
export function redactRequest<T extends { messages: ChatMessage[]; volatile: string | null }>(
  req: T,
  vault: PiiVault,
): T {
  const r = (s: string) => redactText(s, vault);
  const messages = req.messages.map((m): ChatMessage => {
    if (m.role === 'user') return { role: 'user', parts: m.parts.map((p) => redactPart(p, vault)) };
    if (m.role === 'tool') return { ...m, content: r(m.content) };
    return {
      ...m,
      text: r(m.text),
      toolCalls: m.toolCalls.map((c) => ({ ...c, args: mapStrings(c.args, r) })),
    };
  });
  return { ...req, messages, volatile: req.volatile === null ? null : r(req.volatile) };
}

export function restoreResponse(res: ModelResponse, vault: PiiVault): ModelResponse {
  if (vault.tokens.size === 0) return res;
  const r = (s: string) => restoreText(s, vault);
  return {
    ...res,
    text: r(res.text),
    toolCalls: res.toolCalls.map((c) => ({ ...c, args: mapStrings(c.args, r) })),
  };
}
