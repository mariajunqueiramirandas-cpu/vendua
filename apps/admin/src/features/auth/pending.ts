// The code arrives in WhatsApp, so the merchant leaves the app to read it, and the phone may
// kill the app meanwhile (iOS does, often). The pending step is kept until the code expires,
// so coming back lands on "Digite o código". Never the code itself.
const PENDING = 'vendua-admin-signin';
export type Pending = { phone: string; sentAt: number; expiresAt: number };

export function loadPending(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING) ?? 'null') as Pending | null;
    if (p && typeof p.phone === 'string' && p.expiresAt > Date.now()) return p;
  } catch {
    /* private mode or a bad value: start over */
  }
  return null;
}

export function savePending(p: Pending | null) {
  try {
    if (p) localStorage.setItem(PENDING, JSON.stringify(p));
    else localStorage.removeItem(PENDING);
  } catch {
    /* private mode: the step lives in memory only */
  }
}

export const expiry = (iso: string) => Date.parse(iso) || Date.now() + 10 * 60_000;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** a CPF/CNPJ whose check digits fail (lib/parse.ts parseDocument) */
export const DOCUMENT_ERR = 'Confira os números do CPF ou do CNPJ.';
/** an email that goes to Mercado Pago as the payer's: Core's validEmail pattern (billing/input.ts) */
export const PAYER_EMAIL_RE =
  /^[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
