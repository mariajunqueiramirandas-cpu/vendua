import { normalizePhone } from '../modules/customer.ts';
import type { Sql } from '../platform/db.ts';

/** Does this number sign in to some store's admin? Through the one cross-tenant read (ADR 0020). */
export async function isMerchantPhone(
  sql: Sql,
  ...candidates: (string | undefined | null)[]
): Promise<boolean> {
  for (const c of candidates) {
    if (!c || c.length > 40) continue;
    const p = normalizePhone(c);
    if (!/^\d{10,11}$/.test(p)) continue;
    const rows = await sql`select 1 from merchant_memberships_for_phone(${p}) limit 1`;
    if (rows.length) return true;
  }
  return false;
}
