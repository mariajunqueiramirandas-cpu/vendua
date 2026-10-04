// Forgiving input (design spec §2.2.4): money, phones and times as people type them.

/** "12", "12,5", "12.50", "R$ 1.234,56" → cents; null = not money */
export function parseMoney(input: string): number | null {
  let s = input.replace(/r\$|\s/gi, '');
  if (!s) return null;
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (lastSep >= 0 && s.length - lastSep - 1 <= 2) {
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, '');
    s = `${intPart || '0'}.${s.slice(lastSep + 1).padEnd(2, '0')}`;
  } else {
    s = s.replace(/[.,]/g, '');
  }
  const n = Math.round(Number(s) * 100);
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? n : null;
}

/** cents → "12,50" for an input's value */
export const moneyInput = (cents: number | null | undefined) =>
  cents == null ? '' : (cents / 100).toFixed(2).replace('.', ',');

/** any formatting → DDD + number digits, or null */
export function parsePhone(input: string): string | null {
  const d = input
    .replace(/\D/g, '')
    .replace(/^0+/, '')
    .replace(/^55(?=\d{10,11}$)/, '');
  return d.length === 10 || d.length === 11 ? d : null;
}

/** progressive mask while typing: (22) 99999-0000 */
export function maskPhone(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const checkDigit = (values: number[], weights: number[]) => {
  const r = values.reduce((s, v, i) => s + v * weights[i]!, 0) % 11;
  return r < 2 ? 0 : 11 - r;
};
const CPF_W2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_W2 = [6, ...CNPJ_W1];

/** A CPF or CNPJ in any formatting → 11 digits or 14 characters, or null when the check digits
 *  don't add up. Core's cpfCnpj (billing/input.ts); a CNPJ may carry letters since July 2026. */
export function parseDocument(input: string): string | null {
  const s = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (/^(.)\1*$/.test(s)) return null;
  const [w1, w2] = /^\d{11}$/.test(s)
    ? [CPF_W2.slice(1), CPF_W2]
    : /^[0-9A-Z]{12}\d{2}$/.test(s)
      ? [CNPJ_W1, CNPJ_W2]
      : [null, null];
  if (!w1 || !w2) return null;
  const v = [...s].map((c) => c.charCodeAt(0) - 48);
  const dv1 = checkDigit(v.slice(0, w1.length), w1);
  const dv2 = checkDigit([...v.slice(0, w1.length), dv1], w2);
  return dv1 === v[w1.length] && dv2 === v[w1.length + 1] ? s : null;
}

/** progressive mask while typing: 000.000.000-00, then 00.000.000/0000-00 past 11 characters
 *  (or as soon as a letter shows it's a CNPJ) */
export function maskDocument(input: string): string {
  const s = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 14);
  const at = (cuts: [number, string][]) =>
    cuts.reduce(
      (out, [i, sep], k) =>
        s.length > i ? out + sep + s.slice(i, cuts[k + 1]?.[0] ?? undefined) : out,
      s.slice(0, cuts[0]![0]),
    );
  return s.length <= 11 && /^\d*$/.test(s)
    ? at([
        [3, '.'],
        [6, '.'],
        [9, '-'],
      ])
    : at([
        [2, '.'],
        [5, '.'],
        [8, '/'],
        [12, '-'],
      ]);
}

/** "9", "9h", "09:00", "9h30", "930" → "09:00"/"09:30"; null = not a time */
export function parseTime(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/\s/g, '');
  let m = /^(\d{1,2})(?:[:h.]?(\d{2}))?h?$/.exec(s);
  if (!m && /^\d{3,4}$/.test(s)) m = /^(\d{1,2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return `${String(h === 24 ? 0 : h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
