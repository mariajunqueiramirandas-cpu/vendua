// The commission calculator's math, in integer cents like Core. Rates in basis points.

/** iFood's published commissions (blog-parceiros.ifood.com.br/taxas-ifood, 15/09/2026) */
export const APP_OWN_DELIVERY_BPS = 1200;
export const APP_DELIVERY_BPS = 2300;

export const MAX_DIGITS = 8;

/** "R$ 169" or "R$ 69,90" (content.ts display strings) → cents */
export function cents(price: string): number {
  const m = /R\$\s*([\d.]+)(?:,(\d{2}))?/.exec(price);
  if (!m) throw new Error(`not a price: ${price}`);
  return Number(m[1]!.replace(/\./g, '')) * 100 + Number(m[2] ?? 0);
}

export const commission = (salesCents: number, bps: number) =>
  Math.round((salesCents * bps) / 10000);

/** 8000 → "8.000" */
export const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** cents → "R$ 1.840" or "R$ 148,08", with a no-break space so it never splits */
export function brl(c: number): string {
  const abs = Math.abs(c);
  const rest = abs % 100;
  return `${c < 0 ? '−' : ''}R$ ${group(Math.floor(abs / 100))}${rest ? ',' + String(rest).padStart(2, '0') : ''}`;
}
