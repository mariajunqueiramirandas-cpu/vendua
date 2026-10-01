import type { Platform } from '../doc.ts';
import { cardapioweb } from './cardapioweb.ts';
import { deliverydireto } from './deliverydireto.ts';
import { goomer } from './goomer.ts';
import { instadelivery } from './instadelivery.ts';
import { olaclick } from './olaclick.ts';
import { saipos } from './saipos.ts';
import { takeat } from './takeat.ts';
import type { Adapter } from './types.ts';

export type { Adapter } from './types.ts';

export const ADAPTERS: readonly Adapter[] = [
  instadelivery,
  cardapioweb,
  olaclick,
  takeat,
  deliverydireto,
  saipos,
  goomer,
];

// platforms we recognise but can't read: blocked ones answer a challenge to any server
// (docs/menu-import.md §3), the rest have no adapter yet
const BLOCKED: [Platform, RegExp][] = [
  ['anotaai', /(^|\.)anota\.ai$/],
  ['ifood', /(^|\.)ifood\.com\.br$/],
];
const NOT_YET: [Platform, RegExp][] = [];

// a page on a platform's own domain that no adapter matched is the platform's, not a store
const PLATFORM_DOMAIN =
  /(^|\.)(instadelivery\.com\.br|cardapioweb\.com|cardapioweb\.com\.br|ola\.click|olaclick\.app|deliverydireto\.com\.br|takeat\.app|saipos\.com|goomer\.app|anota\.ai|ifood\.com\.br)$/;
// names that never reach the public internet (RFC 2606, 6761, 8375 and the usual LAN ones)
const LOCAL_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'lan',
  'home.arpa',
  'test',
  'invalid',
  'example',
];

/** A name on the public DNS: labels of letters, digits and inner hyphens under an alphabetic
 *  TLD, which also rules out IPv4 and IPv6 literals. */
export function isPublicHostname(host: string): boolean {
  if (host.length > 253 || !host.includes('.')) return false;
  const labels = host.split('.');
  if (!labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return false;
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1]!)) return false;
  return !LOCAL_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

export type Recognised =
  | { kind: 'ok'; adapter: Adapter; ref: string; url: URL }
  /** the merchant's own domain: the read job asks which platform serves it (custom-domain.ts) */
  | { kind: 'custom'; host: string; url: URL }
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
  if (url.username || url.password || url.port) return { kind: 'invalid' };
  if (url.protocol === 'http:') url.protocol = 'https:';
  const host = url.hostname.toLowerCase();
  for (const adapter of ADAPTERS) {
    const m = adapter.match(url);
    if (m) return { kind: 'ok', adapter, ref: m.ref, url };
  }
  for (const [platform, re] of BLOCKED) if (re.test(host)) return { kind: 'blocked', platform };
  for (const [platform, re] of NOT_YET) if (re.test(host)) return { kind: 'unsupported', platform };
  if (!PLATFORM_DOMAIN.test(host) && isPublicHostname(host)) return { kind: 'custom', host, url };
  return { kind: 'unsupported', platform: null };
}

export function adapterFor(platform: string): Adapter | null {
  return ADAPTERS.find((a) => a.platform === platform) ?? null;
}
