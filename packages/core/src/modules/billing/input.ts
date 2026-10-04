import { text } from '../../admin/context.ts';
import { HttpError } from '../../platform/http.ts';

// The email goes to Mercado Pago as the payer's, and MP refuses what it doesn't consider an
// address (an accent, a trailing or doubled dot, a comma) — after the store already exists.
// So only plain ASCII addresses pass here; apps/admin's PAYER_EMAIL_RE is the same pattern.
const EMAIL_RE =
  /^[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export function validEmail(v: unknown, field: string): string {
  const e = text(v, field, 200, 3).toLowerCase();
  if (!EMAIL_RE.test(e)) throw new HttpError(422, 'BAD_REQUEST', 'email looks wrong', { field });
  return e;
}

/** One check digit: the weighted sum of `values` mod 11 (the CPF and CNPJ rule). */
function checkDigit(values: number[], weights: number[]) {
  const r = values.reduce((s, v, i) => s + v * weights[i]!, 0) % 11;
  return r < 2 ? 0 : 11 - r;
}

const CPF_W2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const CPF_W1 = CPF_W2.slice(1);
const CNPJ_W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_W2 = [6, ...CNPJ_W1];

/**
 * A CPF or CNPJ in any formatting → its canonical form (11 digits, or 14 characters for a CNPJ),
 * or null when its check digits don't add up. A CNPJ may be alphanumeric (Receita Federal, from
 * July 2026): each character counts as its ASCII code minus 48, so digits keep their value.
 */
export function cpfCnpj(input: string): string | null {
  const s = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (/^(.)\1*$/.test(s)) return null;
  const v = [...s].map((c) => c.charCodeAt(0) - 48);
  const [w1, w2] = /^\d{11}$/.test(s)
    ? [CPF_W1, CPF_W2]
    : /^[0-9A-Z]{12}\d{2}$/.test(s)
      ? [CNPJ_W1, CNPJ_W2]
      : [null, null];
  if (!w1 || !w2) return null;
  const dv1 = checkDigit(v.slice(0, w1.length), w1);
  const dv2 = checkDigit([...v.slice(0, w1.length), dv1], w2);
  return dv1 === v[w1.length] && dv2 === v[w1.length + 1] ? s : null;
}

export function validDocument(v: unknown, field: string): string {
  const doc = cpfCnpj(text(v, field, 40, 11));
  if (!doc) throw new HttpError(422, 'BAD_REQUEST', 'cpf or cnpj looks wrong', { field });
  return doc;
}
