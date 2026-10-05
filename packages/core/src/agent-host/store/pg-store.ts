import {
  LeaseLostError,
  type ActorRow,
  type ActorStore,
  type AgentEvent,
  type Claimed,
  type ClaimQuery,
  type FencedTx,
  type Json,
  type Lane,
  type Lease,
  type MailboxMessage,
  type NewEvent,
  type ReleaseOpts,
} from '@vendua/agent-runtime';
import { controlTx } from '../../modules/control.ts';
import { withTenant, type Sql } from '../../platform/db.ts';
import { dispatchTx } from '../dispatch.ts';

interface ActorDb {
  id: string;
  tenant_id: string;
  agent_id: string;
  subject_kind: string;
  subject_id: string;
  lane: Lane;
  version_pin: string | null;
  seq: number;
  projection: { version: string; state: Json } | null;
  projection_seq: number;
  next_wake_at: Date | null;
  attempts: number;
  owner: string | null;
  lease_epoch: number;
  lease_until: Date | null;
}

const ACTOR_COLS = `id, tenant_id, agent_id, subject_kind, subject_id, lane, version_pin, seq::int as seq,
  projection, projection_seq::int as projection_seq, next_wake_at, attempts, owner,
  lease_epoch::float8 as lease_epoch, lease_until`;

const ACTOR_COLS_A = ACTOR_COLS.split(',')
  .map((c) => `a.${c.trim()}`)
  .join(', ');

function toRow(a: ActorDb): ActorRow {
  return {
    id: a.id,
    tenantId: a.tenant_id,
    agentId: a.agent_id,
    subject: { kind: a.subject_kind, id: a.subject_id },
    lane: a.lane,
    versionPin: a.version_pin,
    seq: a.seq,
    projection: a.projection,
    projectionSeq: a.projection_seq,
    nextWakeAt: a.next_wake_at,
    attempts: a.attempts,
  };
}

interface EventDb {
  actor_id: string;
  tenant_id: string;
  seq: number;
  turn_id: string | null;
  step: string | null;
  type: string;
  payload: Json;
  version: string;
  at: Date;
}

function toEvent(e: EventDb): AgentEvent {
  return {
    actorId: e.actor_id,
    tenantId: e.tenant_id,
    seq: e.seq,
    turnId: e.turn_id,
    step: e.step,
    type: e.type,
    payload: e.payload,
    version: e.version,
    at: e.at,
  };
}

interface MailboxDb {
  id: string;
  actor_id: string;
  tenant_id: string;
  kind: string;
  payload: Json;
  source: string;
  dedupe_key: string;
  deliver_at: Date;
  created_at: Date;
  consumed_by_turn: string | null;
}

function toMessage(m: MailboxDb): MailboxMessage {
  return {
    id: m.id,
    actorId: m.actor_id,
    tenantId: m.tenant_id,
    kind: m.kind,
    payload: m.payload,
    source: m.source,
    dedupeKey: m.dedupe_key,
    deliverAt: m.deliver_at,
    createdAt: m.created_at,
    consumedByTurn: m.consumed_by_turn,
  };
}

/**
 * The runtime's ports over Postgres (ADR 0030 decision 2). Claiming, renewing and the
 * next-due query run as control and touch only lease columns; everything a turn does runs in
 * `withTenant(actor.tenant_id)` behind the fence, so RLS covers every write a model can cause.
 */
export class PgActorStore implements ActorStore<Sql> {
  constructor(private readonly sql: Sql) {}

  async claim(q: ClaimQuery): Promise<Claimed[]> {
    if (q.limit <= 0) return [];
    const leaseSecs = q.leaseMs / 1000;
    const rows = await controlTx(this.sql, (tx) =>
      tx.unsafe<ActorDb[]>(
        `
        with held as (
          select tenant_id, count(*)::int as n from agent_actors
          where lane = $1 and lease_until > now() group by tenant_id
        ),
        ready as (
          select distinct tenant_id from agent_actors
          where lane = $1 and agent_id = any($2::text[]) and next_wake_at <= now()
            and (lease_until is null or lease_until <= now())
        ),
        -- each store's own earliest, up to what its cap leaves: one store's backlog can't crowd out the rest.
        -- Within a store, real shoppers go first, then the owner's test chat, then Cliente oculto's
        -- test shoppers, which all arrive at once and would otherwise queue ahead of a customer.
        due as (
          select d.id, d.next_wake_at, d.rn
          from ready r
          left join held h using (tenant_id)
          cross join lateral (
            select a.id, a.next_wake_at, row_number() over (order by p.rank, a.next_wake_at, a.id) as rn
            from agent_actors a
            cross join lateral (
              select case when a.subject_kind = 'shopper_thread' then coalesce(
                (select case t.test_kind when 'cliente_oculto' then 2 when 'owner' then 1 else 0 end
                 from shopper_threads t where t.id = a.subject_id::uuid), 0)
              else 0 end as rank
            ) p
            where a.tenant_id = r.tenant_id and a.lane = $1 and a.agent_id = any($2::text[])
              and a.next_wake_at <= now()
              and (a.lease_until is null or a.lease_until <= now())
            order by p.rank, a.next_wake_at, a.id
            limit greatest($3 - coalesce(h.n, 0), 0)
          ) d
        ),
        -- round robin: every store's first actor, then every store's second
        pick as (
          select id from due order by rn, next_wake_at limit $4
        ),
        locked as (
          select a.id from agent_actors a
          where a.id in (select id from pick)
            and (a.lease_until is null or a.lease_until <= now())
          for update skip locked
        )
        update agent_actors a set
          owner = $5,
          lease_epoch = a.lease_epoch + 1,
          lease_until = now() + make_interval(secs => $6),
          attempts = a.attempts + 1,
          -- if this activation dies, the actor is due again once the lease lapses, later each time
          next_wake_at = now() + make_interval(secs => $6 + least(5 * power(2, a.attempts), 600)),
          last_claimed_at = now(),
          updated_at = now()
        from locked
        where a.id = locked.id
        returning ${ACTOR_COLS_A}
        `,
        [q.lane, q.agentIds as string[], q.perTenantCap, q.limit, q.owner, leaseSecs],
      ),
    );
    return rows.map((a) => ({
      actor: toRow(a),
      lease: {
        actorId: a.id,
        tenantId: a.tenant_id,
        owner: q.owner,
        epoch: a.lease_epoch,
        until: a.lease_until!,
      },
    }));
  }

  async renew(lease: Lease, leaseMs: number): Promise<Lease | null> {
    const rows = await controlTx(
      this.sql,
      (tx) => tx<{ lease_until: Date }[]>`
      update agent_actors set lease_until = now() + make_interval(secs => ${leaseMs / 1000})
      where id = ${lease.actorId} and owner = ${lease.owner} and lease_epoch = ${lease.epoch}
        and lease_until > now()
      returning lease_until`,
    );
    return rows[0] ? { ...lease, until: rows[0].lease_until } : null;
  }

  fenced<T>(lease: Lease, fn: (tx: FencedTx<Sql>) => Promise<T>): Promise<T> {
    return withTenant(this.sql, lease.tenantId, async (tx) => {
      // FOR SHARE holds off a lease steal (the claim's UPDATE) until this commits
      const held = await tx.unsafe<ActorDb[]>(
        `select ${ACTOR_COLS} from agent_actors
         where id = $1 and owner = $2 and lease_epoch = $3 and lease_until > now()
         for share`,
        [lease.actorId, lease.owner, lease.epoch],
      );
      if (!held[0]) throw new LeaseLostError(lease.actorId);
      return fn(pgTx(tx, toRow(held[0])));
    });
  }

  read<T>(tenantId: string, fn: (host: Sql) => Promise<T>): Promise<T> {
    return withTenant(this.sql, tenantId, async (tx) => {
      await tx`set transaction read only`;
      return fn(tx);
    });
  }

  async release(lease: Lease, opts: ReleaseOpts): Promise<void> {
    await withTenant(this.sql, lease.tenantId, async (tx) => {
      // lock first: a dispatch committing now is either seen below or sets next_wake_at after
      const rows = await tx`
        select 1 from agent_actors
        where id = ${lease.actorId} and owner = ${lease.owner} and lease_epoch = ${lease.epoch}
        for update`;
      if (!rows[0]) return;
      await tx`
        update agent_actors set
          next_wake_at = coalesce(
            ${opts.retryAt ?? null}::timestamptz,
            (select min(deliver_at) from agent_mailbox
             where actor_id = ${lease.actorId} and consumed_by_turn is null),
            case when ${opts.clean} then null else now() end
          ),
          attempts = case when ${opts.clean} then 0 else attempts end,
          owner = null,
          lease_until = null,
          updated_at = now()
        where id = ${lease.actorId}`;
    });
  }

  async nextDue(lanes: readonly Lane[], agentIds: readonly string[]): Promise<Date | null> {
    const rows = await controlTx(
      this.sql,
      (tx) => tx<{ at: Date | null }[]>`
      select min(case when lease_until > now() then lease_until else next_wake_at end) as at
      from agent_actors
      where lane = any(${lanes as string[]}) and agent_id = any(${agentIds as string[]})
        and (next_wake_at is not null or lease_until > now())`,
    );
    return rows[0]?.at ?? null;
  }
}

function pgTx(tx: Sql, actor: ActorRow): FencedTx<Sql> {
  return {
    host: tx,
    actor,
    async events(afterSeq) {
      const rows = await tx<EventDb[]>`
        select actor_id, tenant_id, seq::int as seq, turn_id, step, type, payload, version, at
        from agent_events where actor_id = ${actor.id} and seq > ${afterSeq}
        order by seq`;
      return rows.map(toEvent);
    },
    async append(turnId, events: NewEvent[], version) {
      if (events.length === 0) return [];
      const [bumped] = await tx<{ seq: number }[]>`
        update agent_actors set seq = seq + ${events.length}, updated_at = now()
        where id = ${actor.id} returning seq::int as seq`;
      const seq = bumped!.seq;
      const first = seq - events.length + 1;
      const seqs = events.map((_, i) => first + i);
      const inserted = await tx<EventDb[]>`
        insert into agent_events (tenant_id, actor_id, seq, turn_id, step, type, payload, version)
        select ${actor.tenantId}, ${actor.id}, t.seq, ${turnId}, t.step, t.type, t.payload::jsonb, ${version}
        from unnest(
          ${seqs}::int[],
          ${events.map((e) => e.step ?? null)}::text[],
          ${events.map((e) => e.type)}::text[],
          ${events.map((e) => JSON.stringify(e.payload ?? null))}::text[]
        ) as t(seq, step, type, payload)
        returning actor_id, tenant_id, seq::int as seq, turn_id, step, type, payload, version, at`;
      actor.seq = seq;
      return inserted.sort((a, b) => a.seq - b.seq).map(toEvent);
    },
    async dueMailbox(now) {
      const rows = await tx<MailboxDb[]>`
        select id, actor_id, tenant_id, kind, payload, source, dedupe_key, deliver_at, created_at, consumed_by_turn
        from agent_mailbox
        where actor_id = ${actor.id} and consumed_by_turn is null and deliver_at <= ${now}
        order by created_at, id
        limit 50`;
      return rows.map(toMessage);
    },
    async consume(ids, turnId) {
      if (ids.length === 0) return;
      await tx`update agent_mailbox set consumed_by_turn = ${turnId}
               where actor_id = ${actor.id} and id = any(${ids as string[]}) and consumed_by_turn is null`;
    },
    async unconsume(turnId) {
      await tx`update agent_mailbox set consumed_by_turn = null
               where actor_id = ${actor.id} and consumed_by_turn = ${turnId}`;
    },
    dispatch: (input) => dispatchTx(tx, input),
    async saveProjection(projection, seq) {
      await tx`update agent_actors set projection = ${tx.json(projection as never)}, projection_seq = ${seq}, updated_at = now()
               where id = ${actor.id}`;
    },
    savepoint: <T>(fn: (host: Sql) => Promise<T>) =>
      (tx as unknown as { savepoint: (f: (sp: Sql) => Promise<T>) => Promise<T> }).savepoint((sp) =>
        fn(sp),
      ),
  };
}
