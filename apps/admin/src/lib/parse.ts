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
