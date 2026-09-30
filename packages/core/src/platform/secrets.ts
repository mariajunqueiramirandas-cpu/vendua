import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { log } from './log.ts';

// Tokens at rest (Mercado Pago OAuth): AES-256-GCM under VENDUA_SECRETS_KEY, falling back to a key
// derived from the session secret so dev and tests work. Boxes sealed under that derived key before
// VENDUA_SECRETS_KEY was set still open (tried second) and are resealed on their next refresh.
// Rotating VENDUA_SECRETS_KEY itself disconnects stores — the payments job asks owners to reconnect.

export interface Sealed {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

const derive = (base: string) => createHash('sha256').update(`vendua.secrets|${base}`).digest();

/** Sealing key first, then the legacy session-derived one (only when they differ). */
function keysFor(fallbackSecret: string): Buffer[] {
  const legacy = derive(`session:${fallbackSecret}`);
  const own = process.env.VENDUA_SECRETS_KEY;
  return own ? [derive(own), legacy] : [legacy];
}

// once, at import (boot): production should seal under its own key, not SESSION_SECRET's
if (process.env.NODE_ENV === 'production' && !process.env.VENDUA_SECRETS_KEY)
  log.warn(
    "VENDUA_SECRETS_KEY unset — stores' payment tokens are sealed with a key derived from SESSION_SECRET. Set VENDUA_SECRETS_KEY (openssl rand -hex 32); tokens sealed before keep opening.",
  );

export function seal(plain: string, fallbackSecret: string): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keysFor(fallbackSecret)[0]!, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return {
    v: 1,
    iv: iv.toString('base64url'),
    tag: c.getAuthTag().toString('base64url'),
    ct: ct.toString('base64url'),
  };
}

/** null when the box doesn't open (wrong key, tampered) — callers treat it as disconnected. */
export function unseal(box: unknown, fallbackSecret: string): string | null {
  const b = box as Partial<Sealed> | null;
  if (!b || b.v !== 1 || !b.iv || !b.tag || !b.ct) return null;
  for (const key of keysFor(fallbackSecret)) {
    try {
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(b.iv, 'base64url'));
      d.setAuthTag(Buffer.from(b.tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(b.ct, 'base64url')), d.final()]).toString('utf8');
    } catch {
      // wrong key or tampered — try the next one
    }
  }
  return null;
}
