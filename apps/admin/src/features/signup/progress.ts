import type { PayNext, StoreRef } from '../../lib/api.ts';

// Signup memory on this device, so a refresh (or iOS killing the tab while the merchant reads
// the WhatsApp code) never loses the answers. The answers live in localStorage; the signup
// token, which can create a store for this phone, only in sessionStorage (this tab).

export type StepId =
  | 'plano'
  | 'loja'
  | 'voce'
  | 'whatsapp'
  | 'codigo'
  | 'existente'
  | 'pagamento'
  | 'cartao'
  | 'confirmando'
  | 'pix'
  | 'pronto';

export interface Draft {
  step: StepId;
  planId: string | null;
  storeName: string;
  slug: string;
  /** the merchant edited the address by hand: stop deriving it from the name */
  slugTouched: boolean;
  ownerName: string;
  email: string;
  phone: string | null;
  codeSentAt: number | null;
  codeExpiresAt: number | null;
  method: 'pix' | 'card';
  /** signing up with an access code instead of paying (the code itself is never saved) */
  byCode: boolean;
  /** after POST /signup: the store exists and this device is signed in to it */
  created: {
    store: StoreRef;
    next: PayNext;
    /** the card hand-off already sent them to Mercado Pago once: don't bounce them again */
    handedOff?: boolean;
  } | null;
}

export const EMPTY: Draft = {
  step: 'plano',
  planId: null,
  storeName: '',
  slug: '',
  slugTouched: false,
  ownerName: '',
  email: '',
  phone: null,
  codeSentAt: null,
  codeExpiresAt: null,
  method: 'pix',
  byCode: false,
  created: null,
};

const KEY = 'vendua-signup';
const TOKEN = 'vendua-signup-token';
// abandoned signups don't come back weeks later
const MAX_AGE = 3 * 24 * 60 * 60_000;

export function loadDraft(): Draft {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as (Draft & { at?: number }) | null;
    if (raw && typeof raw.step === 'string' && Date.now() - (raw.at ?? 0) < MAX_AGE) {
      const { at: _at, ...d } = raw;
      return { ...EMPTY, ...d };
    }
  } catch {
    /* private mode or a bad value: start over */
  }
  return EMPTY;
}

export function saveDraft(d: Draft) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...d, at: Date.now() }));
  } catch {
    /* private mode: the flow lives in memory only */
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(TOKEN);
  } catch {
    /* ignore */
  }
}

export interface Verified {
  token: string;
  phone: string;
  existingStores: StoreRef[];
}

export function loadToken(phone: string | null): Verified | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(TOKEN) ?? 'null') as Verified | null;
    return v && v.phone === phone ? v : null;
  } catch {
    return null;
  }
}

export function saveToken(v: Verified | null) {
  try {
    if (v) sessionStorage.setItem(TOKEN, JSON.stringify(v));
    else sessionStorage.removeItem(TOKEN);
  } catch {
    /* ignore */
  }
}

/** The step right after the store is created: pay by card or Pix, or (access code) the welcome —
 *  the team confirms that payment. */
export function afterCreate(next: PayNext): StepId {
  return next.kind === 'card' ? 'cartao' : next.kind === 'pix' ? 'pix' : 'pronto';
}

/** The card hand-off is out at Mercado Pago: its return (`?assinatura=retorno`) belongs here. */
export function awaitingCardReturn(): boolean {
  const d = loadDraft();
  return !!d.created && d.created.next.kind === 'card' && d.step !== 'pronto';
}

/** "Doces da Maria" → "doces-da-maria" */
export function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}
