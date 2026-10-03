import type { Figure, ConversationState } from './state.ts';
import {
  ToolError,
  type MemoryProposal,
  type TimerInput,
  type ToolContext,
} from '../define/tool.ts';
import type { FencedTx } from '../ports.ts';
import type { Card, DispatchResult, Json, NewEvent, SubjectRef } from '../types.ts';

/** Aliases for one turn, shared by tools running in parallel so two never mint the same one. */
export class AliasBook {
  private byId = new Map<string, string>();
  private counters: Record<string, number>;
  private known: Record<string, { kind: string; id: string }>;

  constructor(state: Readonly<ConversationState>) {
    this.counters = { ...state.aliasCounters };
    this.known = { ...state.aliases };
    for (const [alias, v] of Object.entries(state.aliases))
      this.byId.set(`${v.kind}:${v.id}`, alias);
  }

  get(kind: string, id: string): { alias: string; fresh: boolean } {
    const k = `${kind}:${id}`;
    const existing = this.byId.get(k);
    if (existing) return { alias: existing, fresh: false };
    const prefix = (kind.match(/[a-z]/i)?.[0] ?? 'x').toLowerCase();
    const n = (this.counters[prefix] ?? 0) + 1;
    this.counters[prefix] = n;
    const alias = `${prefix}${n}`;
    this.byId.set(k, alias);
    this.known[alias] = { kind, id };
    return { alias, fresh: true };
  }

  resolve(alias: string): { kind: string; id: string } | undefined {
    return this.known[alias.trim().toLowerCase()];
  }
}

export interface ToolCtxInit<H> {
  host: H;
  fenced: FencedTx<H> | null;
  tenantId: string;
  actorId: string;
  agentId: string;
  turnId: string;
  subject: SubjectRef;
  state: Readonly<ConversationState>;
  now: Date;
  aliases: AliasBook;
}

/** Collects what a tool did as events, appended with its result in the step's transaction. */
export class ToolCtx<H> implements ToolContext<H> {
  readonly events: NewEvent[] = [];
  readonly tx: H;
  readonly tenantId: string;
  readonly actorId: string;
  readonly agentId: string;
  readonly turnId: string;
  readonly subject: SubjectRef;
  readonly state: Readonly<ConversationState>;
  readonly now: Date;
  private externals = new Map<string, Json>();

  constructor(private init: ToolCtxInit<H>) {
    this.tx = init.host;
    this.tenantId = init.tenantId;
    this.actorId = init.actorId;
    this.agentId = init.agentId;
    this.turnId = init.turnId;
    this.subject = init.subject;
    this.state = init.state;
    this.now = init.now;
  }

  alias(kind: string, id: string): string {
    const { alias, fresh } = this.init.aliases.get(kind, id);
    if (fresh) this.events.push({ type: 'alias.assigned', payload: { alias, kind, id } });
    return alias;
  }

  resolve(alias: string, kind: string): string {
    const hit = this.init.aliases.resolve(alias);
    if (!hit || hit.kind !== kind) throw new ToolError(`id desconhecido: ${alias}`);
    return hit.id;
  }

  figure(id: string, f: { value: Json; text: string; kind: Figure['kind'] }): void {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,80}$/.test(id)) throw new Error(`bad figure id ${id}`);
    this.events.push({ type: 'ledger.recorded', payload: { figures: [{ id, ...f }] } });
  }

  setSlot(name: string, value: Json): void {
    this.events.push({ type: 'slot.set', payload: { name, value } });
  }

  card(card: Card): void {
    this.events.push({ type: 'card.attached', payload: { card: card as unknown as Json } });
  }

  handoff(reason: string): void {
    this.events.push({ type: 'handoff.started', payload: { reason: reason.slice(0, 200) } });
  }

  handback(): void {
    this.events.push({ type: 'handoff.ended', payload: {} });
  }

  proposeMemory(p: MemoryProposal): void {
    this.events.push({
      type: 'memory.proposed',
      payload: {
        key: p.key,
        value: p.value,
        confidence: p.confidence,
        consent: p.consent ?? false,
      },
    });
  }

  forgetMemory(key: string): void {
    this.events.push({ type: 'memory.forgotten', payload: { key } });
  }

  async timer(t: TimerInput): Promise<DispatchResult> {
    const tx = this.init.fenced;
    if (!tx) throw new Error('timers need a write tool');
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(t.name)) throw new Error(`bad timer name ${t.name}`);
    const res = await tx.dispatch({
      actor: { tenantId: this.tenantId, agentId: this.agentId, subject: this.subject },
      kind: `timer.${t.name}`,
      source: `agent:${this.turnId}`,
      dedupeKey: `timer:${this.actorId}:${t.key}`.slice(0, 200),
      deliverAt: t.deliverAt,
      payload: t.payload ?? null,
    });
    this.events.push({
      type: 'timer.set',
      payload: {
        name: t.name,
        key: t.key,
        deliverAt: t.deliverAt.toISOString(),
        inserted: res.inserted,
      },
    });
    return res;
  }

  async external<T extends Json>(key: string, call: (k: string) => Promise<T>): Promise<T> {
    if (key in this.state.externals) return this.state.externals[key] as T;
    if (this.externals.has(key)) return this.externals.get(key) as T;
    const result = await call(key);
    this.externals.set(key, result);
    this.events.push({ type: 'external.recorded', payload: { key, result } });
    return result;
  }
}
