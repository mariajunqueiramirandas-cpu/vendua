import type { ModelGateway } from '@vendua/agent-runtime';
import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { ingestPass, presenceOne } from './ingest.ts';
import type { MediaProviders } from './media.ts';
import { clienteOcultoPass } from './cliente-oculto.ts';
import { sweepAll, voicePass } from './sweeper.ts';
import { triagePass, triageSweep } from './triage.ts';

const workerLog = log.child({ mod: 'vendedor-worker' });
const POLL_MS = 3_000;
const SWEEP_MS = 60_000;
const TRIAGE_POLL_MS = 5_000;

export interface VendedorWorkerOpts {
  gateway: ModelGateway | null;
  media: MediaProviders | null;
}

/**
 * Core's side of the Vendedor outside turns: the ingest (woken by the gateway's NOTIFY, with a
 * poll as the safety net), presence, voice replies, the triage of new numbers (ADR 0033), the
 * proactive sweeper and Cliente oculto.
 */
export function startVendedorWorker(sql: Sql, o: VendedorWorkerOpts): () => Promise<void> {
  let stopped = false;
  let running = false;
  let again = false;
  const deps = { sql, media: o.media, gateway: o.gateway };

  const drain = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        // voice replies go out between batches: a steady inbound stream mustn't hold them back
        let n: number;
        do {
          n = await ingestPass(deps);
          await voicePass(sql, o.media).catch((err) =>
            workerLog.error({ err }, 'voice pass failed'),
          );
        } while (!stopped && n > 0);
      } while (again && !stopped);
    } catch (err) {
      workerLog.error({ err }, 'ingest pass failed');
    } finally {
      running = false;
    }
  };

  let unlisten: (() => Promise<void>) | null = null;
  void sql
    .listen(
      'vendua_shopper',
      (payload) => {
        const [tenant, a, b] = payload.split('|');
        if (a === 'presence' && tenant && b)
          void presenceOne(sql, tenant, b).catch(() => undefined);
        else void drain();
      },
      () => void drain(),
    )
    .then((sub) => {
      unlisten = sub.unlisten;
    })
    .catch((err) => workerLog.warn({ err }, 'vendua_shopper listen failed'));

  let triaging = false;
  let triageAgain = false;
  const triage = async () => {
    if (triaging) {
      triageAgain = true;
      return;
    }
    triaging = true;
    try {
      do {
        triageAgain = false;
        while (!stopped && (await triagePass(deps)) > 0);
      } while (triageAgain && !stopped);
    } catch (err) {
      workerLog.error({ err }, 'triage pass failed');
    } finally {
      triaging = false;
    }
  };
  let unlistenHistory: (() => Promise<void>) | null = null;
  void sql
    .listen(
      'vendua_history',
      () => void triage(),
      () => void triage(),
    )
    .then((sub) => {
      unlistenHistory = sub.unlisten;
    })
    .catch((err) => workerLog.warn({ err }, 'vendua_history listen failed'));
  const triagePoll = setInterval(() => {
    void triageSweep(sql)
      .catch((err) => workerLog.warn({ err }, 'triage sweep failed'))
      .then(() => triage());
  }, TRIAGE_POLL_MS);
  triagePoll.unref?.();

  const poll = setInterval(() => void drain(), POLL_MS);
  poll.unref?.();
  // a pass that outlasts the interval is left to finish, not joined by a second one
  let sweeping = false;
  let playing = false;
  const sweep = setInterval(() => {
    if (!sweeping) {
      sweeping = true;
      void sweepAll(sql, new Date(), !!o.gateway)
        .catch((err) => workerLog.warn({ err }, 'vendedor sweep failed'))
        .finally(() => (sweeping = false));
    }
    if (!playing) {
      playing = true;
      void clienteOcultoPass(sql, o.gateway)
        .catch((err) => workerLog.warn({ err }, 'cliente oculto pass failed'))
        .finally(() => (playing = false));
    }
  }, SWEEP_MS);
  sweep.unref?.();

  return async () => {
    stopped = true;
    clearInterval(poll);
    clearInterval(sweep);
    clearInterval(triagePoll);
    await unlisten?.().catch(() => undefined);
    await unlistenHistory?.().catch(() => undefined);
  };
}
