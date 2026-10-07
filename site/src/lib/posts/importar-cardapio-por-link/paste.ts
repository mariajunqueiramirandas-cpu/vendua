// "Colar lista": the same rules as Core's parser (packages/core/src/admin/routes-catalog.ts,
// `parseMenuPaste` and `parseMoney`), so the widget shows what the admin's preview would. Money
// stays in integer cents; Core rounds `Number(s) * 100`, which gives the same cents for at most two
// decimals, so here the digits are joined instead of multiplied.

const MAX_PRICE = 10_000_000; // R$ 100.000,00
export const MAX_ITEMS = 100; // per paste
export const MAX_TEXT = 20_000; // characters

export function parseMoney(input: string): number | null {
  const s = input.replace(/r\$|\s/gi, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let reais: string;
  let cents = '00';
  if (lastSep >= 0 && s.length - lastSep - 1 <= 2) {
    reais = s.slice(0, lastSep).replace(/[.,]/g, '') || '0';
    cents = s.slice(lastSep + 1).padEnd(2, '0');
  } else {
    reais = s.replace(/[.,]/g, '');
  }
  if (reais.replace(/^0+/, '').length > 6) return null;
  const n = Number(reais) * 100 + Number(cents);
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX_PRICE ? n : null;
}

export type Line =
  { ok: true; raw: string; name: string; priceCents: number } | { ok: false; raw: string };

/** every non-empty line, kept or skipped, so the widget can show why */
export function parseLines(raw: string): Line[] {
  const out: Line[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const clean = line.replace(/^[\s•*·\-–—\d.)]+(?=\D)/, '').trim();
    if (!clean) continue;
    const m =
      /^(.*?)[\s\-–—:.|]*(?:R\$\s*)?(\d{1,3}(?:[.\s]\d{3})*(?:[,.]\d{1,2})?|\d+(?:[,.]\d{1,2})?)\s*(?:reais)?$/i.exec(
        clean,
      );
    const name = m ? m[1]!.replace(/[\s\-–—:.|]+$/, '').trim() : '';
    const price = m ? parseMoney(m[2]!.replace(/\s/g, '')) : null;
    if (m && name.length >= 2 && name.length <= 120 && price !== null && price > 0)
      out.push({ ok: true, raw: line.trim(), name, priceCents: price });
    else out.push({ ok: false, raw: line.trim() });
  }
  return out;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** cents → "R$ 12,50" (the formatter's non-breaking space kept) */
export const money = (cents: number) => brl.format(cents / 100);
