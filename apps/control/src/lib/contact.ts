const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** International digits for wa.me / tel: — a bare BR number (DDD + 8–9 digits) gets 55. */
export function intlDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (!raw.trim().startsWith('+') && (d.length === 10 || d.length === 11)) return `55${d}`;
  return d.length >= 10 && d.length <= 15 && d[0] !== '0' ? d : null;
}

export const waHref = (raw: string | null | undefined) => {
  const d = intlDigits(raw);
  return d ? `https://wa.me/${d}` : null;
};

export const telHref = (raw: string | null | undefined) => {
  const d = intlDigits(raw);
  return d ? `tel:+${d}` : null;
};

export const mailHref = (raw: string | null | undefined) => {
  const e = raw?.trim();
  return e && EMAIL_RE.test(e) ? `mailto:${e}` : null;
};

/** National digits (a store user's phone) → "(21) 99999-0000". */
export function fmtBrPhone(digits: string): string {
  const m = /^(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : digits;
}
