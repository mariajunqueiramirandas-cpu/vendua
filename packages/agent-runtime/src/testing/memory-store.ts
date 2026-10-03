import { randomUUID } from 'node:crypto';
import { LeaseLostError } from '../engine/errors.ts';
import type {
  ActorStore,
  Claimed,
  ClaimQuery,
  Clock,
  FencedTx,
  MemoryFact,
  MemoryPort,
  ReleaseOpts,
  Transport,
} from '../ports.ts';
import type {
  ActorKey,
  ActorRow,
  AgentEvent,
  DispatchInput,
  DispatchResult,
  Json,
  Lane,
  Lease,
  MailboxMessage,
  NewEvent,
  OutboundMessage,
} from '../types.ts';

/** The in-memory host's "database": tools read and write it like Core's tables. */
export interface MemoryHost {
  kv: Map<string, Json>;
}

interface ActorRec extends ActorRow {
  owner: string | null;
  epoch: number;
  leaseUntil: Date | null;
}

interface Data {
  actors: Map<string, ActorRec>;
  mailbox: MailboxMessage[];
  events: Map<string, AgentEvent[]>;
  outbox: (OutboundMessage & { id: string; transport: string })[];
  memory: Map<string, MemoryFact>;
  kv: Map<string, Json>;
}

function clone(d: Data): Data {
  return structuredClone(d);
}

/**
 * The ports over plain maps, with Postgres's semantics where they matter: one transaction at
 * a time, rollback on throw, the lease fence, dedupe on `(tenant, dedupe_key)`.
 */
export class MemoryStore implements ActorStore<MemoryHost> {
  private d: Data = {
    actors: new Map(),
    mailbox: [],
    events: new Map(),
    outbox: [],
    memory: new Map(),
    kv: new Map(),
  };
  private lock: Promise<void> = Promise.resolve();
  /** Fault injection: thrown inside the next fenced transaction whose events include this type. */
  failOnAppend: string | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly laneOf: (agentId: string) => Lane = () => 'interactive',
  ) {}

  // ── inspection ──────────────────────────────────────────────────────────────

  get outbox() {
    return this.d.outbox;
  }
  get kv() {
    return this.d.kv;
  }
  get mailbox(): readonly MailboxMessage[] {
    return this.d.mailbox;
  }
  actor(id: string): ActorRow | undefined {
    return this.d.actors.get(id);
  }
  actorFor(key: ActorKey): ActorRow | undefined {
    return [...this.d.actors.values()].find(
      (a) =>
        a.tenantId === key.tenantId &&
        a.agentId === key.agentId &&
        a.subject.kind === key.subject.kind &&
        a.subject.id === key.subject.id,
    );
  }
  log(actorId: string): AgentEvent[] {
    return this.d.events.get(actorId) ?? [];
  }
  allActors(): ActorRow[] {
    return [...this.d.actors.values()];
  }
  /** A deep copy, for counterfactual replay on a fork. */
  fork(clock: Clock = this.clock): MemoryStore {
    const f = new MemoryStore(clock, this.laneOf);
    f.d = clone(this.d);
    return f;
  }

  // ── the producer ────────────────────────────────────────────────────────────

  dispatch(input: DispatchInput): Promise<DispatchResult> {
    return this.serial(async () => this.dispatchIn(input));
  }

  private dispatchIn(input: DispatchInput): DispatchResult {
    const now = this.clock.now();
    let actor = [...this.d.actors.values()].find(
      (a) =>
        a.tenantId === input.actor.tenantId &&
        a.agentId === input.actor.agentId &&
        a.subject.kind === input.actor.subject.kind &&
        a.subject.id === input.actor.subject.id,
    );
    if (!actor) {
      actor = {
        id: randomUUID(),
        tenantId: input.actor.tenantId,
        agentId: input.actor.agentId,
        subject: { ...input.actor.subject },
        lane: this.laneOf(input.actor.agentId),
        versionPin: null,
        seq: 0,
        projection: null,
        projectionSeq: 0,
        nextWakeAt: null,
        attempts: 0,
        owner: null,
        epoch: 0,
        leaseUntil: null,
      };
      this.d.actors.set(actor.id, actor);
    }
    if (
      this.d.mailbox.some((m) => m.tenantId === actor.tenantId && m.dedupeKey === input.dedupeKey)
    )
      return { actorId: actor.id, mailboxId: null, inserted: false };
    const deliverAt = input.deliverAt ?? now;
    const msg: MailboxMessage = {
      id: randomUUID(),
      actorId: actor.id,
      tenantId: actor.tenantId,
      kind: input.kind,
      payload: input.payload ?? null,
      source: input.source,
      dedupeKey: input.dedupeKey,
      deliverAt,
      createdAt: now,
      consumedByTurn: null,
    };
    this.d.mailbox.push(msg);
    if (!actor.nextWakeAt || deliverAt < actor.nextWakeAt) actor.nextWakeAt = deliverAt;
    return { actorId: actor.id, mailboxId: msg.id, inserted: true };
  }

  // ── ActorStore ──────────────────────────────────────────────────────────────

  claim(q: ClaimQuery): Promise<Claimed[]> {
    return this.serial(async () => {
      const now = this.clock.now();
      const free = (a: ActorRec) => !a.leaseUntil || a.leaseUntil <= now;
      const leasedBy = new Map<string, number>();
      for (const a of this.d.actors.values())
        if (a.lane === q.lane && !free(a))
          leasedBy.set(a.tenantId, (leasedBy.get(a.tenantId) ?? 0) + 1);
      const due = [...this.d.actors.values()]
        .filter(
          (a) =>
            a.lane === q.lane &&
            q.agentIds.includes(a.agentId) &&
            free(a) &&
            a.nextWakeAt &&
            a.nextWakeAt <= now,
        )
        .sort((a, b) => a.nextWakeAt!.getTime() - b.nextWakeAt!.getTime());
      // round robin across tenants: each tenant's oldest first, then their second…
      const rank = new Map<string, number>();
      const ranked = due.map((a) => {
        const r = rank.get(a.tenantId) ?? 0;
        rank.set(a.tenantId, r + 1);
        return { a, r };
      });
      ranked.sort((x, y) => x.r - y.r);
      const out: Claimed[] = [];
      for (const { a } of ranked) {
        if (out.length >= q.limit) break;
        const held = leasedBy.get(a.tenantId) ?? 0;
        if (held >= q.perTenantCap) continue;
        leasedBy.set(a.tenantId, held + 1);
        a.epoch += 1;
        a.owner = q.owner;
        a.leaseUntil = new Date(now.getTime() + q.leaseMs);
        a.attempts += 1;
        a.nextWakeAt = new Date(now.getTime() + q.leaseMs + q.backoffMs(a.attempts));
        out.push({
          actor: this.row(a),
          lease: {
            actorId: a.id,
            tenantId: a.tenantId,
            owner: q.owner,
            epoch: a.epoch,
            until: a.leaseUntil,
          },
        });
      }
      return out;
    });
  }

  renew(lease: Lease, leaseMs: number): Promise<Lease | null> {
    return this.serial(async () => {
      const a = this.held(lease);
      if (!a) return null;
      a.leaseUntil = new Date(this.clock.now().getTime() + leaseMs);
      return { ...lease, until: a.leaseUntil };
    });
  }

  fenced<T>(lease: Lease, fn: (tx: FencedTx<MemoryHost>) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      const a = this.held(lease);
      if (!a) throw new LeaseLostError(lease.actorId);
      const before = clone(this.d);
      try {
        return await fn(this.tx(a.id));
      } catch (e) {
        this.d = before;
        throw e;
      }
    });
  }

  read<T>(_tenantId: string, fn: (host: MemoryHost) => Promise<T>): Promise<T> {
    // reads see committed data; writes through this handle are a bug the copy makes harmless
    return fn({ kv: new Map(this.d.kv) });
  }

  release(lease: Lease, opts: ReleaseOpts): Promise<void> {
    return this.serial(async () => {
      const a = this.d.actors.get(lease.actorId);
      if (!a || a.owner !== lease.owner || a.epoch !== lease.epoch) return;
      const pending = this.d.mailbox.filter((m) => m.actorId === a.id && m.consumedByTurn === null);
      const next =
        opts.retryAt ??
        (pending.length
          ? new Date(Math.min(...pending.map((m) => m.deliverAt.getTime())))
          : opts.clean
            ? null
            : this.clock.now());
      a.nextWakeAt = next;
      if (opts.clean) a.attempts = 0;
      a.owner = null;
      a.leaseUntil = null;
    });
  }

  async nextDue(lanes: readonly Lane[], agentIds: readonly string[]): Promise<Date | null> {
    let best: number | null = null;
    for (const a of this.d.actors.values()) {
      if (!lanes.includes(a.lane) || !agentIds.includes(a.agentId)) continue;
      const leased = a.leaseUntil && a.leaseUntil > this.clock.now();
      const t = leased ? a.leaseUntil!.getTime() : a.nextWakeAt?.getTime();
      if (t !== undefined && (best === null || t < best)) best = t;
    }
    return best === null ? null : new Date(best);
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private held(lease: Lease): ActorRec | undefined {
    const a = this.d.actors.get(lease.actorId);
    if (!a || a.owner !== lease.owner || a.epoch !== lease.epoch) return undefined;
    if (!a.leaseUntil || a.leaseUntil <= this.clock.now()) return undefined;
    return a;
  }

  private row(a: ActorRec): ActorRow {
    const { owner: _o, epoch: _e, leaseUntil: _l, ...row } = a;
    return structuredClone(row);
  }

  private tx(actorId: string): FencedTx<MemoryHost> {
    const self = this;
    const actor = () => this.d.actors.get(actorId)!;
    const host: MemoryHost = {
      get kv() {
        return self.d.kv;
      },
    };
    return {
      host,
      get actor() {
        return self.row(actor());
      },
      events: async (afterSeq) =>
        (this.d.events.get(actorId) ?? []).filter((e) => e.seq > afterSeq),
      append: async (turnId, events: NewEvent[], version) => {
        if (this.failOnAppend && events.some((e) => e.type === this.failOnAppend)) {
          this.failOnAppend = null;
          throw new Error('injected failure');
        }
        const a = actor();
        const log = this.d.events.get(actorId) ?? [];
        const out = events.map((e) => {
          a.seq += 1;
          return {
            actorId,
            tenantId: a.tenantId,
            seq: a.seq,
            turnId,
            step: e.step ?? null,
            type: e.type,
            payload: structuredClone(e.payload),
            version,
            at: this.clock.now(),
          } satisfies AgentEvent;
        });
        log.push(...out);
        this.d.events.set(actorId, log);
        return structuredClone(out);
      },
      dueMailbox: async (now) =>
        this.d.mailbox
          .filter((m) => m.actorId === actorId && m.consumedByTurn === null && m.deliverAt <= now)
          .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
          .map((m) => structuredClone(m)),
      consume: async (ids, turnId) => {
        for (const m of this.d.mailbox)
          if (ids.includes(m.id) && m.actorId === actorId) m.consumedByTurn = turnId;
      },
      unconsume: async (turnId) => {
        for (const m of this.d.mailbox)
          if (m.actorId === actorId && m.consumedByTurn === turnId) m.consumedByTurn = null;
      },
      dispatch: async (input) => this.dispatchIn(input),
      saveProjection: async (projection, seq) => {
        const a = actor();
        a.projection = structuredClone(projection);
        a.projectionSeq = seq;
      },
      savepoint: async (fn) => {
        const before = clone(this.d);
        try {
          return await fn(host);
        } catch (e) {
          this.d = before;
          throw e;
        }
      },
    };
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** The in-memory outbox, as a transport. */
  transport(id = 'memory'): Transport<MemoryHost> {
    return {
      id,
      send: async (_tx, msg) => {
        const row = { ...structuredClone(msg), id: randomUUID(), transport: id };
        this.d.outbox.push(row);
        return { outboxId: row.id };
      },
    };
  }

  memoryPort(): MemoryPort<MemoryHost> {
    return {
      load: async (_tx, scope) => [...this.d.memory.values()].filter((f) => f.scope === scope),
      accept: async (_tx, fact) => {
        this.d.memory.set(`${fact.scope}|${fact.key}`, structuredClone(fact));
      },
      forget: async (_tx, scope, key) => {
        this.d.memory.delete(`${scope}|${key}`);
      },
    };
  }
}
