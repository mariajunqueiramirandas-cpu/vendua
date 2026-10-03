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
