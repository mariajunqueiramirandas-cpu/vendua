import { controlTx } from '../modules/control.ts';
import type { Sql } from '../platform/db.ts';
import { VENDUA_SESSION } from './transport.ts';

/**
 * "Is this number on WhatsApp?" asked of the gateway's socket: a probe row it answers. null when
 * nobody answers in time, as the socket's own probe does when it's down.
 */
export async function probeWhatsApp(
  sql: Sql,
  phone: string,
  timeoutMs = 8000,
): Promise<boolean | null> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return false;
  const [row] = await controlTx(
    sql,
    (tx) => tx<{ id: string }[]>`
      insert into platform_wa_probes (session, phone) values (${VENDUA_SESSION}, ${digits})
      returning id`,
  );
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 250));
    const [p] = await controlTx(
      sql,
      (tx) => tx<{ result: boolean | null; answered_at: Date | null }[]>`
        select result, answered_at from platform_wa_probes where id = ${row!.id}`,
    );
    if (p?.answered_at) return p.result;
  }
  return null;
}
