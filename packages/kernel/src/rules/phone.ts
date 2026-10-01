// Shopper input: Brazilian phones (WhatsApp) and CEPs.

export function digitsOf(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

/** 10–11 national digits (DDD + number), or 12–13 with the country code 55. */
export function isValidPhone(s: string | null | undefined): boolean {
  const d = digitsOf(s);
  return (
    d.length === 10 || d.length === 11 || (/^55/.test(d) && (d.length === 12 || d.length === 13))
  );
}

/** National digits — the shape Core keys phones by. */
export function phoneKey(phone: string): string {
  const d = digitsOf(phone);
  return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
}

/** Progressive input mask: `(22) 98179-5040` (11 digits) or `(22) 2645-1234` (10). */
export function maskPhone(s: string | null | undefined): string {
  let d = digitsOf(s);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const head = d.length === 11 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, head)}-${rest.slice(head)}`;
}

/** Progressive input mask: `00000-000`. */
export function maskCep(s: string | null | undefined): string {
  const d = digitsOf(s).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function isValidCep(s: string | null | undefined): boolean {
  return digitsOf(s).length === 8;
}
