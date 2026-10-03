import type { ConversationState } from './engine/state.ts';
import type {
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
  SubjectRef,
} from './types.ts';

// The runtime's only view of the world. Core implements these over Postgres
// (`src/agent-host/store/`); `testing/` implements them in memory. `H` is the host's
// transaction handle, opaque here and handed to tools so their business writes share the
// step's transaction.

export interface Clock {
  now(): Date;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const t = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(signal.reason);
        },
        { once: true },
      );
    }),
};

export interface ClaimQuery {
  lane: Lane;
  owner: string;
  leaseMs: number;
  limit: number;
  agentIds: readonly string[];
  /** Leased actors one tenant may hold in this lane at once. */
  perTenantCap: number;
  /** Delay before a claimed actor is due again if this activation dies (grows with attempts). */
  backoffMs: (attempts: number) => number;
}

export interface Claimed {
  actor: ActorRow;
  lease: Lease;
}

export interface ReleaseOpts {
  /** A clean finish resets `attempts`; a retry keeps them and is due at `retryAt`. */
  clean: boolean;
  retryAt?: Date;
}

export interface ActorStore<H = unknown> {
  /** Control scope: claims due, unleased actors, rotating across tenants. Bumps the epoch. */
  claim(q: ClaimQuery): Promise<Claimed[]>;
  /** Extends a lease still held; null when it was lost. */
  renew(lease: Lease, leaseMs: number): Promise<Lease | null>;
  /**
   * One tenant-scoped transaction that first checks `owner`, `epoch` and `lease_until > now`
   * under FOR SHARE. Throws `LeaseLostError` if the lease isn't held.
   */
  fenced<T>(lease: Lease, fn: (tx: FencedTx<H>) => Promise<T>): Promise<T>;
  /** A tenant-scoped read transaction (no fence, no appends) for `read` tools run in parallel. */
  read<T>(tenantId: string, fn: (host: H) => Promise<T>): Promise<T>;
  /**
   * Locks the actor row FOR UPDATE, sets `next_wake_at` from unconsumed mailbox rows (or
   * `retryAt`) and clears the lease, if the epoch still matches.
   */
  release(lease: Lease, opts: ReleaseOpts): Promise<void>;
  /** Earliest time any actor in these lanes becomes claimable (due, or its lease lapses). */
  nextDue(lanes: readonly Lane[], agentIds: readonly string[]): Promise<Date | null>;
}

export interface FencedTx<H = unknown> {
  readonly host: H;
  readonly actor: ActorRow;
  /** Events with seq > `afterSeq`, in order. */
  events(afterSeq: number): Promise<AgentEvent[]>;
  /** Appends in order, allocating seq from the actor row. */
  append(turnId: string | null, events: NewEvent[], version: string): Promise<AgentEvent[]>;
  /** Unconsumed rows with deliver_at <= now, oldest first. */
  dueMailbox(now: Date): Promise<MailboxMessage[]>;
  consume(ids: readonly string[], turnId: string): Promise<void>;
  /** Clears consumed_by_turn on a superseded turn's batch so the next turn answers it. */
  unconsume(turnId: string): Promise<void>;
  /** The producer, for rows an agent writes about itself (timers). */
  dispatch(input: DispatchInput): Promise<DispatchResult>;
  saveProjection(projection: { version: string; state: Json }, seq: number): Promise<void>;
  /** Runs `fn` in a savepoint: a thrown error rolls back its writes and nothing else. */
  savepoint<T>(fn: (host: H) => Promise<T>): Promise<T>;
}

/** Writes outbound messages to a transport's outbox, inside the step's transaction. */
export interface Transport<H = unknown> {
  readonly id: string;
  send(tx: FencedTx<H>, msg: OutboundMessage): Promise<{ outboxId: string }>;
}

export interface MemoryFact {
  scope: string;
  key: string;
  value: Json;
  confidence: number;
  /** Event that proposed it: `${actorId}:${seq}`. */
  provenance: string;
  sensitive: boolean;
}

export interface MemoryPort<H = unknown> {
  load(tx: FencedTx<H>, scope: string): Promise<MemoryFact[]>;
  accept(tx: FencedTx<H>, fact: MemoryFact): Promise<void>;
  forget(tx: FencedTx<H>, scope: string, key: string): Promise<void>;
}

export interface VersionResolver {
  /** The version hash this tenant should run, or null for the agent's current definition. */
  resolve(tenantId: string, agentId: string): Promise<string | null>;
}

export interface SpendPort {
  /** Model cost (USD) a tenant spent on an agent since `since`, for daily budgets. */
  tenantSpend(tenantId: string, agentId: string, since: Date): Promise<number>;
  /** The tenant's daily budget for a key the definition names; null means no cap. */
  tenantDailyLimit(tenantId: string, agentId: string, key: string): Promise<number | null>;
}

export interface TurnFailure {
  actorId: string;
  tenantId: string;
  agentId: string;
  subject: SubjectRef;
  turnId: string;
  version: string;
  error: string;
  attempts: number;
}

export interface TurnEnd {
  actorId: string;
  tenantId: string;
  agentId: string;
  subject: SubjectRef;
  turnId: string;
  version: string;
  state: Readonly<ConversationState>;
}

/** The host's hooks, all called inside the transaction that commits what they report. */
export interface HostHooks<H = unknown> {
  /** Projections and samplers (online QA) that follow a finished turn. */
  turnEnded?(tx: FencedTx<H>, end: TurnEnd): Promise<void>;
  /** A turn exhausted its retries: a staff event, never shopper data (ADR 0023). */
  turnFailed?(tx: FencedTx<H>, failure: TurnFailure): Promise<void>;
}

// ── telemetry ────────────────────────────────────────────────────────────────

export type SpanAttributes = Record<string, string | number | boolean | undefined>;

export interface Span {
  setAttributes(attrs: SpanAttributes): void;
  end(error?: unknown): void;
}

/** OpenTelemetry GenAI spans: metadata only; content stays in the log under RLS. */
export interface Telemetry {
  span(name: string, attrs: SpanAttributes, parent?: Span): Span;
}
