import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Tokens at rest (Mercado Pago OAuth): AES-256-GCM under VENDUA_SECRETS_KEY, falling back to a key
// derived from the session secret so dev and tests work. Rotating the key disconnects stores
// (their tokens stop opening) — the payments job then asks the owner to reconnect.

export interface Sealed {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

function keyFor(fallbackSecret: string) {
  const base = process.env.VENDUA_SECRETS_KEY || `session:${fallbackSecret}`;
  return createHash('sha256').update(`vendua.secrets|${base}`).digest();
}

export function seal(plain: string, fallbackSecret: string): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFor(fallbackSecret), iv);
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
  try {
    const d = createDecipheriv(
      'aes-256-gcm',
      keyFor(fallbackSecret),
      Buffer.from(b.iv, 'base64url'),
    );
    d.setAuthTag(Buffer.from(b.tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(b.ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
