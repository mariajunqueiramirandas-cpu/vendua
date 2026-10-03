import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  LANES,
  Runtime,
  type Agent,
  type Claimed,
  type Lane,
  type ModelGateway,
  type Telemetry,
  type Transport,
} from '@vendua/agent-runtime';
import { log } from '../platform/log.ts';
import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { hostHooks } from './hooks.ts';
import { hostGateway } from './models.ts';
import { TRANSPORTS } from './agents/index.ts';
import { currentAgents, loadedVersions, ONLINE_QA } from './registry.ts';
import { pgSpend } from './spend.ts';
import { pgMemory } from './store/memory.ts';
import { PgActorStore } from './store/pg-store.ts';
import { noTransport } from './transports/whatsapp.ts';
import { deployVersions, pgVersionResolver, ringPass } from './versions.ts';

const rtLog = log.child({ mod: 'agent-runtime' });

export const WAKE_CHANNEL = 'vendua_agent_runtime';
const RECONCILE_MS = 60_000;
const MAINTENANCE_MS = 10 * 60_000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Workers per lane: a 30-step background turn never takes a shopper's slot. */
export const DEFAULT_POOLS: Record<Lane, number> = { interactive: 8, followup: 4, background: 2 };

export interface AgentRuntimeOpts {
  agents?: Agent<Sql>[];
  versions?: Agent<Sql>[];
  transports?: Transport<Sql>[];
  gateway?: ModelGateway;
  pools?: Partial<Record<Lane, number>>;
  /** Leased actors one store may hold per lane: one store's rush can't starve the others. */
  perTenantCap?: number;
  telemetry?: Telemetry;
  /** Online QA sampling (on when an agent is registered). */
  qa?: boolean;
  /** Ring promotion and rollback (off in tests that drive it by hand). */
  rings?: boolean;
}

export interface AgentRuntimeHandle {
  runtime: Runtime<Sql>;
  poke(lane?: Lane): void;
  stop(graceMs?: number): Promise<void>;
}

/** Sleep-until-due for one lane: a pass claims what fits the pool and returns when to look again. */
class LaneLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = Infinity;
  private running = false;
  private again = false;
  stopped = false;

  constructor(private readonly pass: () => Promise<Date | null>) {}

  at(when: number): void {
    if (this.stopped || !Number.isFinite(when)) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (when >= this.timerAt) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = when;
    this.timer = setTimeout(
      () => void this.fire(),
      Math.min(Math.max(0, when - Date.now()), MAX_TIMEOUT_MS),
    );
    this.timer.unref?.();
  }

  poke(): void {
    this.at(Date.now());
  }

  private async fire(): Promise<void> {
    this.timer = null;
    this.timerAt = Infinity;
    this.running = true;
    let next: number;
    try {
      next = (await this.pass())?.getTime() ?? Infinity;
    } catch (err) {
      rtLog.error({ err }, 'agent runtime pass failed');
      next = Date.now() + 5_000;
    }
    this.running = false;
    if (this.again) {
      this.again = false;
      next = Date.now();
    }
    this.at(next);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

/**
 * Core's scheduler for Agent Runtime v3 (§4.2): a pool per lane, woken by the mailbox trigger's
 * NOTIFY and by due times, never by a tick. A reconcile pass is the safety net for a lost
 * notification.
 */
export function startAgentRuntime(sql: Sql, o: AgentRuntimeOpts = {}): AgentRuntimeHandle {
  const agents = o.agents ?? currentAgents();
  const versions = o.versions ?? loadedVersions();
  const transports = o.transports ?? [noTransport, ...TRANSPORTS];
  const owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const store = new PgActorStore(sql);
  const runtime = new Runtime<Sql>({
    agents,
    versions,
    store,
    gateway: o.gateway ?? hostGateway(sql),
    transports,
    owner,
    resolver: pgVersionResolver(sql),
    memory: pgMemory,
    spend: pgSpend(sql),
    hooks: hostHooks(o.qa === false || !ONLINE_QA ? {} : { qa: ONLINE_QA.turnEnded }),
    ...(o.telemetry ? { telemetry: o.telemetry } : {}),
    log: (level, msg, data) => rtLog[level](data ?? {}, msg),
  });
  const pools = { ...DEFAULT_POOLS, ...o.pools };
  const inFlight = new Set<Promise<void>>();
  const busy: Record<Lane, number> = { interactive: 0, followup: 0, background: 0 };
  const lanes = LANES.filter((l) => runtime.agentIdsIn(l).length > 0);
  const loops = new Map<Lane, LaneLoop>();
  let stopped = false;

  for (const lane of lanes) {
    const loop = new LaneLoop(async () => {
      const free = pools[lane] - busy[lane];
      // a full pool waits for a finishing activation's poke
      if (free <= 0) return null;
      const claimed = await runtime.claim(lane, { limit: free, perTenantCap: o.perTenantCap ?? 2 });
      for (const c of claimed) start(lane, c);
      if (claimed.length === free) return new Date();
      // what's due but unclaimed is held by a tenant's cap: its own activations poke when done
      const next = await runtime.nextDue([lane]);
      return next && new Date(Math.max(next.getTime(), Date.now() + 1_000));
    });
    loops.set(lane, loop);
  }

  function start(lane: Lane, c: Claimed): void {
    busy[lane] += 1;
    const p = runtime
      .activate(c)
      .catch((err) => rtLog.error({ err, actorId: c.actor.id }, 'activation crashed'))
      .finally(() => {
        busy[lane] -= 1;
        inFlight.delete(p);
        loops.get(lane)?.poke();
      });
    inFlight.add(p);
  }

  const poke = (lane?: Lane) => {
    if (lane) loops.get(lane)?.poke();
    else for (const l of loops.values()) l.poke();
  };

  let unlisten: (() => Promise<void>) | null = null;
  const listen = async () => {
    for (let attempt = 0; !stopped; attempt++) {
      try {
        const sub = await sql.listen(
          WAKE_CHANNEL,
          (payload) => poke(LANES.includes(payload as Lane) ? (payload as Lane) : undefined),
          () => poke(), // first subscribe and every reconnect: assume something was missed
        );
        unlisten = sub.unlisten;
        return;
      } catch (err) {
        rtLog.warn({ err }, 'agent runtime listen failed');
        await new Promise((r) => setTimeout(r, Math.min(1_000 * 2 ** attempt, 60_000)));
      }
    }
  };

  const reconcile = setInterval(() => poke(), RECONCILE_MS);
  reconcile.unref?.();

  // each step on its own: a failing one never stops the others (rollbacks above all)
  const maintenance = async () => {
    const steps: [string, () => Promise<unknown>][] = [
      ['partitions', () => ensurePartitions(sql)],
      ['mailbox prune', () => pruneMailbox(sql)],
    ];
    if (o.rings !== false && agents.length) steps.push(['rings', () => ringPass(sql)]);
    for (const [name, run] of steps)
      await run().catch((err) =>
        rtLog.warn({ err, step: name }, 'agent runtime maintenance failed'),
      );
  };
  const maintain = setInterval(() => void maintenance(), MAINTENANCE_MS);
  maintain.unref?.();

  void (async () => {
    await ensurePartitions(sql).catch((err) => rtLog.warn({ err }, 'agent_events partitions'));
    if (versions.length)
      await deployVersions(sql, versions).catch((err) =>
        rtLog.error({ err }, 'version deploy failed'),
      );
    if (lanes.length) await listen();
    poke();
  })();

  return {
    runtime,
    poke,
    async stop(graceMs = 25_000) {
      stopped = true;
      for (const l of loops.values()) l.stop();
      clearInterval(reconcile);
      clearInterval(maintain);
      await unlisten?.().catch(() => undefined);
      await Promise.race([
        Promise.allSettled([...inFlight]),
        new Promise((r) => setTimeout(r, graceMs).unref?.()),
      ]);
    },
  };
}

/** This month's and next month's log partitions exist before anything is written to them. */
export async function ensurePartitions(sql: Sql, now = new Date()): Promise<void> {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  await sql`select agent_events_partition(${now.toISOString().slice(0, 10)}::date)`;
  await sql`select agent_events_partition(${next.toISOString().slice(0, 10)}::date)`;
}

/** Consumed mailbox rows only matter for dedupe; a month covers any re-delivery. */
export async function pruneMailbox(sql: Sql): Promise<number> {
  const rows = await controlTx(
    sql,
    (tx) => tx`
    delete from agent_mailbox
    where consumed_by_turn is not null and created_at < now() - interval '30 days'
    returning 1`,
  );
  return rows.length;
}
