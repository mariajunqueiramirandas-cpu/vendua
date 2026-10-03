import type { ModelGateway } from '@vendua/agent-runtime';
import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { ingestPass, presenceOne } from './ingest.ts';
import type { MediaProviders } from './media.ts';
import { clienteOcultoPass } from './cliente-oculto.ts';
import { sweepAll, voicePass } from './sweeper.ts';

const workerLog = log.child({ mod: 'vendedor-worker' });
const POLL_MS = 3_000;
const SWEEP_MS = 60_000;

export interface VendedorWorkerOpts {
  gateway: ModelGateway | null;
  media: MediaProviders | null;
}

/**
 * Core's side of the Vendedor outside turns: the ingest (woken by the gateway's NOTIFY, with a
 * poll as the safety net), presence, voice replies, the proactive sweeper and Cliente oculto.
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
        while (!stopped && (await ingestPass(deps)) > 0);
        await voicePass(sql, o.media);
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

  const poll = setInterval(() => void drain(), POLL_MS);
  poll.unref?.();
  const sweep = setInterval(() => {
    void sweepAll(sql).catch((err) => workerLog.warn({ err }, 'vendedor sweep failed'));
    void clienteOcultoPass(sql, o.gateway).catch((err) =>
      workerLog.warn({ err }, 'cliente oculto pass failed'),
    );
  }, SWEEP_MS);
  sweep.unref?.();

  return async () => {
    stopped = true;
    clearInterval(poll);
    clearInterval(sweep);
    await unlisten?.().catch(() => undefined);
  };
}
