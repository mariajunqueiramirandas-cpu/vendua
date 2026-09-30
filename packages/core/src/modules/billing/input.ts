import { text } from '../../admin/context.ts';
import { HttpError } from '../../platform/http.ts';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validEmail(v: unknown, field: string): string {
  const e = text(v, field, 200, 3).toLowerCase();
  if (!EMAIL_RE.test(e)) throw new HttpError(422, 'BAD_REQUEST', 'email looks wrong', { field });
  return e;
}
