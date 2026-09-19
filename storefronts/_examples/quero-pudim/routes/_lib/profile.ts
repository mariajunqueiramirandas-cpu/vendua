/**
 * Customer profile remembered across visits (localStorage) — the reference
 * storefront did this via `lib/profile.ts`; the Kernel has no customer-
 * persistence primitive yet (OBSERVATIONS.md).
 */
const KEY = 'qp.profile';

export interface Profile {
  name: string;
  phone: string;
  street: string;
  number: string;
  neighborhood: string;
  complement: string;
  cep: string;
}

const EMPTY: Profile = {
  name: '',
  phone: '',
  street: '',
  number: '',
  neighborhood: '',
  complement: '',
  cep: '',
};

export function loadProfile(): Profile {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return { ...EMPTY, ...parsed };
  } catch {
    return EMPTY;
  }
}

export function saveProfile(p: Partial<Profile>) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...loadProfile(), ...p }));
  } catch {
    /* private mode — profile simply isn't remembered */
  }
}

/** Digits-only phone, normalizing a pasted/formatted value. */
export function phoneDigits(v: string): string {
  return v.replace(/\D/g, '');
}

/** (XX) XXXXX-XXXX mask, same as the reference storefront. */
export function maskPhone(v: string): string {
  const d = phoneDigits(v).slice(0, 11);
  if (d.length > 6) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length > 2) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return d;
}

/** XXXXX-XXX mask. */
export function maskCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  if (d.length > 5) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return d;
}
