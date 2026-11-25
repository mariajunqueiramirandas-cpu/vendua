import { prepareCrmGatewayTx } from '../crm/delivery-policy.ts';
import { sendWhatsApp } from '../crm/channels/whatsapp.ts';
import { controlTx } from '../modules/control.ts';
import { getIntegration } from '../modules/integrations.ts';
import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';

// Before the cutover Venduá's number is Core's own socket, so Core sends the outbox rows itself
// (Duá's replies; every other caller still sends directly in socket mode). A row is claimed once
// and never re-sent from `sending`: the socket has no message-id dedupe, so a crash mid-send
// expires the row rather than texting twice.

const pumpLog = log.child({ mod: 'platform-wa-socket-pump' });

interface Row {
  id: string;
  to_jid: string;
  body: string;
  /** a voice note sent in place of the body (0150) */
  media_id: string | null;
}

export async function pumpSocketOnce(sql: Sql, limit = 20): Promise<number> {
  const wa = await getIntegration(sql, 'whatsapp');
  if (!wa) return 0;
  let n = 0;
  for (; n < limit; n++) {
    const row = await controlTx(sql, async (tx) => {
      await tx`
        update platform_wa_outbox set status = 'expired'
        where status in ('pending', 'sending') and (expires_at <= now()
          or (status = 'sending' and lease_until < now()))`;
      const [next] = await tx<{ id: string; purpose: string; ref: string | null }[]>`
        select id, purpose, ref from platform_wa_outbox
        where status = 'pending' and next_attempt_at <= now()
          -- a voice note being made (voice.ts): held a minute at most
          and (voice is null or created_at < now() - interval '1 minute')
        order by array_position(array['otp', 'dua', 'notice', 'crm'], purpose), created_at
        limit 1 for update skip locked`;
      if (!next) return null;
      if ((await prepareCrmGatewayTx(tx, next)) !== 'ready') return 'settled' as const;
      const [claimed] = await tx<Row[]>`
        update platform_wa_outbox set status = 'sending', attempts = attempts + 1,
          lease_until = now() + interval '2 minutes'
        where id = ${next.id} returning id, to_jid, body, media_id`;
      return claimed;
    });
    if (!row) break;
    if (row === 'settled') continue;
    let waId: string | null = null;
    let error: string | null = null;
    try {
      const [voice] = row.media_id
        ? await controlTx(
            sql,
            (tx) => tx<{ mime: string; bytes: Buffer; seconds: number | null }[]>`
              select mime, bytes, seconds from platform_wa_media where id = ${row.media_id}`,
          )
        : [];
      waId = await sendWhatsApp(
        sql,
        wa,
        row.to_jid,
        row.body,
        voice
          ? { bytes: new Uint8Array(voice.bytes), mime: voice.mime, seconds: voice.seconds ?? 0 }
          : null,
      );
    } catch (e) {
      error = String((e as Error)?.message ?? e).slice(0, 200);
      pumpLog.warn({ err: error, id: row.id }, 'platform whatsapp send failed');
    }
    await controlTx(
      sql,
      (tx) => tx`
        update platform_wa_outbox
        set status = ${error ? 'failed' : 'sent'}, error = ${error},
            wa_id = ${waId?.slice(0, 64) ?? null}, sent_at = ${error ? null : new Date()},
            lease_until = null
        where id = ${row.id} and status = 'sending'`,
    );
  }
  return n;
}

export function startSocketPump(sql: Sql, o: { tickMs?: number } = {}) {
  let stopped = false;
  let running: Promise<unknown> | null = null;
  const run = () => {
    if (stopped || running) return;
    running = pumpSocketOnce(sql)
      .catch((err) => pumpLog.error({ err }, 'socket pump failed'))
      .finally(() => void (running = null));
  };
  const sub = sql.listen('vendua_platform_wa', run).catch(() => null);
  const timer = setInterval(run, o.tickMs ?? 5_000);
  run();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await (await sub)?.unlisten().catch(() => undefined);
      await running;
    },
  };
}
