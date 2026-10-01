import type { Platform } from '../doc.ts';
import { cardapioweb } from './cardapioweb.ts';
import { deliverydireto } from './deliverydireto.ts';
import { instadelivery } from './instadelivery.ts';
import { olaclick } from './olaclick.ts';
import { takeat } from './takeat.ts';
import type { Adapter } from './types.ts';

export type { Adapter } from './types.ts';

export const ADAPTERS: readonly Adapter[] = [
  instadelivery,
  cardapioweb,
  olaclick,
  takeat,
  deliverydireto,
];

// platforms we recognise but can't read: blocked ones answer a challenge to any server
// (docs/menu-import.md §3), the rest have no adapter yet
const BLOCKED: [Platform, RegExp][] = [
  ['anotaai', /(^|\.)anota\.ai$/],
  ['ifood', /(^|\.)ifood\.com\.br$/],
];
const NOT_YET: [Platform, RegExp][] = [
  ['saipos', /(^|\.)saipos\.com$/],
  ['goomer', /(^|\.)goomer\.app$/],
];

export type Recognised =
  | { kind: 'ok'; adapter: Adapter; ref: string; url: URL }
  | { kind: 'blocked'; platform: Platform }
  | { kind: 'unsupported'; platform: Platform | null }
  | { kind: 'invalid' };

/** Pasted text → the adapter and store ref, or why we can't read it. Pure. */
export function recognise(input: string): Recognised {
  let s = input.trim();
  if (!s || s.length > 500) return { kind: 'invalid' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return { kind: 'invalid' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'invalid' };
  if (url.username || url.password) return { kind: 'invalid' };
  if (url.protocol === 'http:') url.protocol = 'https:';
  const host = url.hostname.toLowerCase();
  for (const adapter of ADAPTERS) {
    const m = adapter.match(url);
    if (m) return { kind: 'ok', adapter, ref: m.ref, url };
  }
  for (const [platform, re] of BLOCKED) if (re.test(host)) return { kind: 'blocked', platform };
  for (const [platform, re] of NOT_YET) if (re.test(host)) return { kind: 'unsupported', platform };
  return { kind: 'unsupported', platform: null };
}

export function adapterFor(platform: string): Adapter | null {
  return ADAPTERS.find((a) => a.platform === platform) ?? null;
}
