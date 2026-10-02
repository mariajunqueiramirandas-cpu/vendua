import { controlTx } from '../modules/control.ts';
import { recordChannelState } from '../modules/system-events.ts';
import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';

// Core's eye on the wa-gateway: a dead gateway can't report itself. When stores want their
// WhatsApp on and no gateway has beaten for a while, the team hears it (channel.down
// `whatsapp_lojas`, debounced on the log); the first beat after that says it's back.

const watchLog = log.child({ mod: 'store-whatsapp-watch' });
const SILENT_AFTER = '2 minutes';

export async function checkGateway(sql: Sql): Promise<'down' | 'up' | 'idle'> {
  const r = (
    await controlTx(
      sql,
      (tx) => tx<{ needed: boolean; fresh: boolean }[]>`
        select
          exists (select 1 from store_whatsapp
                  where wanted and state in ('open', 'connecting', 'pairing', 'error')) as needed,
          exists (select 1 from wa_gateways
                  where seen_at > now() - ${SILENT_AFTER}::interval) as fresh`,
    )
  )[0]!;
  if (r.fresh) {
    await recordChannelState(sql, 'whatsapp_lojas', 'up', null);
    return 'up';
  }
  if (!r.needed) return 'idle';
  await recordChannelState(
    sql,
    'whatsapp_lojas',
    'down',
    `nenhum wa-gateway respondeu em ${SILENT_AFTER.replace('minutes', 'min')}: os avisos de pedido esperam na fila (até 6 h)`,
  );
  return 'down';
}

export function startStoreWhatsappWatch(sql: Sql, everyMs = 60_000): () => void {
  const timer = setInterval(() => {
    void checkGateway(sql).catch((err) => watchLog.warn({ err }, 'gateway check failed'));
  }, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
