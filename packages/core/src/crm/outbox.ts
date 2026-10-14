import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { dispatchMessage } from './send.ts';

// Delivers the lead messages the CRM agents queue (ADR 0030 decision 4): a tool writes the row
// `queued` in its step's transaction and notifies; once that commits, this loop hands it to
// dispatchMessage (claim → provider → finalize, at most once). Staff sends dispatch inline and
// land here only when that inline dispatch never ran.

export const CRM_OUTBOX_CHANNEL = 'vendua_crm_outbox';

const outLog = log.child({ mod: 'crm-outbox' });
const BATCH = 10;
const SWEEP_MS = 30_000;
/** a 'sending' row this old belongs to a worker that died mid-send */
const SENDING_LEASE_MIN = 10;

/** One pass: fail what a dead worker stranded mid-send, then deliver up to a batch. */
export async function deliverQueued(sql: Sql, opts: { graceMs?: number } = {}): Promise<number> {
  // at-most-once: the provider may already have accepted it, so it fails visibly
  const interrupted = await controlTx(
    sql,
    (tx) => tx<{ thread_id: string }[]>`
      update lead_messages set status = 'failed', error = 'dispatch-interrupted', updated_at = now()
      where status = 'sending' and updated_at < now() - make_interval(mins => ${SENDING_LEASE_MIN})
        -- on the platform gateway the send is an outbox row, settled when it goes out
        and not exists (
          select 1 from platform_wa_outbox o
          where o.purpose = 'crm' and o.ref = lead_messages.id::text and o.settled_at is null
            and o.expires_at > now())
      returning thread_id`,
  );
  for (const m of interrupted) emitControlEvent('thread.message', m.thread_id);
  // staff rows get a grace so the request's own inline dispatch wins; an agent's row is
  // committed by its step and waits for no one
  const grace = opts.graceMs ?? 20_000;
  const due = await controlTx(
    sql,
    (tx) => tx<{ id: string }[]>`
      select id from lead_messages
      where status = 'queued'
        and (author = 'agent' and approved_by is null
             or created_at < now() - ${grace} * interval '1 millisecond')
      order by created_at limit ${BATCH}`,
  );
  for (const m of due) {
    await dispatchMessage(sql, m.id).catch((err) =>
      outLog.error({ err, messageId: m.id }, 'dispatch failed'),
    );
  }
  return due.length;
}

export function startCrmOutbox(sql: Sql, opts: { sweepMs?: number } = {}): () => Promise<void> {
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
        while (!stopped && (await deliverQueued(sql)) >= BATCH);
      } while (again && !stopped);
    } catch (err) {
      outLog.error({ err }, 'crm outbox pass failed');
    } finally {
      running = false;
    }
  };
  let unlisten: (() => Promise<void>) | null = null;
  void sql
    .listen(
      CRM_OUTBOX_CHANNEL,
      () => void drain(),
      () => void drain(),
    )
    .then((sub) => {
      unlisten = sub.unlisten;
    })
    .catch((err) => outLog.warn({ err }, `${CRM_OUTBOX_CHANNEL} listen failed`));
  const sweep = setInterval(() => void drain(), opts.sweepMs ?? SWEEP_MS);
  sweep.unref?.();
  return async () => {
    stopped = true;
    clearInterval(sweep);
    await unlisten?.().catch(() => undefined);
    while (running) await new Promise((r) => setTimeout(r, 50));
  };
}
