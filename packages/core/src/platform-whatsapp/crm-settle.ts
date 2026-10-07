import { finalizeSentTx } from '../agent/send.ts';
import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { markMessageFailed, type Channel } from '../modules/threads.ts';
import type { Sql } from '../platform/db.ts';
import { UUID_RE } from '../platform/http.ts';
import { log } from '../platform/log.ts';

// A CRM send on the gateway is an outbox row written with the message's claim (agent/send.ts);
// this finishes it when the gateway settles the row: the same finalize as an inline send for
// `sent`, the message failed for `failed`/`expired`. settled_at is claimed in the same tx as the
// finalize, so each row is finished exactly once.

const settleLog = log.child({ mod: 'crm-settle' });
const SWEEP_MS = 30_000;
const BATCH = 50;

/** Settles what is due now; returns how many rows it finished. */
export async function settleCrmOnce(sql: Sql): Promise<number> {
  const due = await controlTx(
    sql,
    (tx) => tx<{ id: string }[]>`
      select id from platform_wa_outbox
      where purpose = 'crm' and settled_at is null and status in ('sent', 'failed', 'expired')
      order by created_at limit ${BATCH}`,
  );
  let n = 0;
  for (const { id } of due) {
    // one row's error must not hold back the rest; it is retried on the next pass
    try {
      if (await settleOne(sql, id)) n++;
    } catch (err) {
      settleLog.error({ err, outboxId: id }, 'crm settle failed');
    }
  }
  return n;
}

async function settleOne(sql: Sql, id: string): Promise<boolean> {
  const threads = new Set<string>();
  const leads = new Set<string>();
  const done = await controlTx(sql, async (tx) => {
    const [row] = await tx<
      { status: string; ref: string | null; wa_id: string | null; error: string | null }[]
    >`
      select status, ref, wa_id, error from platform_wa_outbox
      where id = ${id} and purpose = 'crm' and settled_at is null
        and status in ('sent', 'failed', 'expired')
      for update skip locked`;
    if (!row) return false;
    await tx`update platform_wa_outbox set settled_at = now() where id = ${id}`;
    if (!row.ref || !UUID_RE.test(row.ref)) return true;
    if (row.status === 'sent') {
      // the stranded-send sweep fails a 'sending' row it thinks a dead worker left; the gateway
      // still sent it, so the record goes back to the truth
      await tx`
        update lead_messages set status = 'sending', error = null, updated_at = now()
        where id = ${row.ref} and status = 'failed' and error = 'dispatch-interrupted'`;
    }
    const [msg] = await tx<
      {
        id: string;
        thread_id: string;
        status: string;
        author: string;
        sending_at: string;
        lead_id: string;
        channel: Channel;
      }[]
    >`
      select m.id, m.thread_id, m.status, m.author, t.lead_id, t.channel,
             coalesce(m.dispatch_attempted_at, m.updated_at) as sending_at
      from lead_messages m join lead_threads t on t.id = m.thread_id
      where m.id = ${row.ref} for update of m`;
    if (!msg || msg.status !== 'sending') return true;
    threads.add(msg.thread_id);
    if (row.status === 'sent') {
      await finalizeSentTx(
        tx,
        {
          messageId: msg.id,
          threadId: msg.thread_id,
          sendingAt: msg.sending_at,
          channel: msg.channel,
          leadId: msg.lead_id,
          author: msg.author,
        },
        row.wa_id,
        null,
        threads,
        leads,
      );
    } else {
      await markMessageFailed(
        tx,
        msg.id,
        row.status === 'expired' ? 'whatsapp send expired' : (row.error ?? 'whatsapp send failed'),
      );
    }
    return true;
  });
  for (const t of threads) emitControlEvent('thread.message', t);
  for (const l of leads) emitControlEvent('lead.change', l);
  return done;
}

/** Woken by the outbox's settle NOTIFY, with a sweep for a missed one. Returns the stop. */
export function startCrmSettle(sql: Sql, opts: { sweepMs?: number } = {}): () => Promise<void> {
  let stopped = false;
  let running = false;
  let again = false;
  const drain = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        while (!stopped && (await settleCrmOnce(sql)) >= BATCH);
      } while (again && !stopped);
    } catch (err) {
      settleLog.error({ err }, 'crm settle pass failed');
    } finally {
      running = false;
    }
  };
  let unlisten: (() => Promise<void>) | null = null;
  void sql
    .listen(
      'vendua_platform_wa_out',
      (payload) => {
        if (payload.endsWith('|crm')) void drain();
      },
      () => void drain(),
    )
    .then((sub) => {
      unlisten = sub.unlisten;
    })
    .catch((err) => settleLog.warn({ err }, 'vendua_platform_wa_out listen failed'));
  const sweep = setInterval(() => void drain(), opts.sweepMs ?? SWEEP_MS);
  sweep.unref?.();
  return async () => {
    stopped = true;
    clearInterval(sweep);
    await unlisten?.().catch(() => undefined);
  };
}
