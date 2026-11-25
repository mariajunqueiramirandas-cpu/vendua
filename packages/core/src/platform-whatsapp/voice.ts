import { controlTx } from '../modules/control.ts';
import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import type { MediaProviders } from '../vendedor/media.ts';

// Duá's voice notes on Venduá's WhatsApp (ADR 0048). A reply to a merchant's voice message is
// queued with `voice = 'pending'` (enqueue_dua_whatsapp's third argument, from the copilot
// transport); senders hold such a row up to VOICE_HOLD while this pass, in Core where the TTS
// sidecar is, makes its voice note and sets media_id. No voice: the row goes as its text.

const vlog = log.child({ mod: 'dua-voice' });

/** how long a sender holds a row for its voice note before sending the text (SQL interval) */
export const VOICE_HOLD = '1 minute';

export async function duaVoicePass(sql: Sql, media: MediaProviders | null): Promise<number> {
  const due = await controlTx(
    sql,
    (tx) => tx<{ id: string; body: string; session: string }[]>`
      update platform_wa_outbox set voice = 'working', voice_at = now()
      where id = any(array(
        select id from platform_wa_outbox
        where status = 'pending' and media_id is null and purpose = 'dua'
          and (voice = 'pending'
            -- a pass that died mid-way: another may try until the senders stop holding it
            or (voice = 'working' and voice_at < now() - interval '30 seconds'))
          and created_at > now() - ${VOICE_HOLD}::interval
        order by created_at limit 5 for update skip locked))
      returning id, body, session`,
  );
  for (const r of due) {
    const s = media ? await media.speak(r.body, { format: 'ogg' }).catch(() => null) : null;
    if (!s) vlog.warn({ id: r.id }, 'no voice for Duá; the reply goes as text');
    await controlTx(sql, async (tx) => {
      const [m] = s
        ? await tx<{ id: string }[]>`
            insert into platform_wa_media (session, mime, bytes, seconds)
            values (${r.session}, ${s.mime}, ${Buffer.from(s.bytes)}, ${Math.min(600, s.seconds)})
            returning id`
        : [];
      await tx`
        update platform_wa_outbox set media_id = ${m?.id ?? null}, voice = null, voice_at = null
        where id = ${r.id} and status = 'pending'`;
      // the senders skipped it while it waited: wake them
      await tx`select pg_notify('vendua_platform_wa', ${`${r.session}|send`})`;
    });
  }
  return due.length;
}

/** Runs the pass on every new outbox row and every few seconds. */
export function startDuaVoice(sql: Sql, media: MediaProviders | null, o: { tickMs?: number } = {}) {
  let stopped = false;
  let running: Promise<unknown> | null = null;
  const run = () => {
    if (stopped || running) return;
    running = (async () => {
      while (!stopped && (await duaVoicePass(sql, media)) > 0) {
        /* the next batch */
      }
    })()
      .catch((err) => vlog.error({ err }, 'dua voice pass failed'))
      .finally(() => {
        running = null;
      });
  };
  const sub = sql.listen('vendua_platform_wa_out', run).catch(() => null);
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
