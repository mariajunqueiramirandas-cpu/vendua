import { randomUUID } from 'node:crypto';
import {
  ToolError,
  type AgentEvent,
  type ConversationState,
  type Json,
  type JsonObject,
  type ToolContext,
  type Transport,
} from '@vendua/agent-runtime';
import { controlTx } from '../../../modules/control.ts';
import { emitControlEvent, type ControlEventType } from '../../../modules/control-events.ts';
import { afterCommit, type Sql } from '../../../platform/db.ts';
import { jobOf } from '../../../crm/jobs.ts';
import type { JobKind } from '../../../crm/policy.ts';

// What the three CRM agents share (ADR 0030 steps 2–4): the turn as its batch describes it, the
// control scope their tools read the CRM through, and the per-turn counters that bound paid and
// remote calls. Their actors live under Venduá's platform tenant; the CRM tables are platform data.

export type Ctx = ToolContext<Sql>;

/** One turn's job and its parameters, from the mailbox rows that started it. */
export interface TurnInfo {
  id: string | null;
  kind: JobKind;
  /** the decisive row's source (whatsapp, agent, cadence, staff:<who>, schedule…) */
  source: string;
  /** the decisive row's kind (message.inbound, timer.followup…) */
  trigger: string;
  params: Params;
  /** a lead-facing action landed since the turn's input */
  acted: boolean;
  /** the act-or-escalate nudge already went out this turn */
  nudged: boolean;
  /** leads this turn created or merged into (discovery may only touch these) */
  leads: string[];
  leadsCreated: number;
  pageReads: number;
  monidUsd: number;
  /** contact values already banked this turn: a repeat isn't progress */
  seen: string[];
  /** a message already went back once for sounding like a robot */
  styleBounced: boolean;
  /** discovery's working memory: the prospect ledger and the campaign plan */
  book: BookEntry[];
  campaign: string | null;
  /** the lead opted out this turn: nothing else may go out */
  closed: boolean;
}

/** One prospect in discovery's ledger: what it found and which moves it already spent. */
export interface BookEntry {
  name: string;
  city: string | null;
  status: 'open' | 'resolved' | 'dead';
  channels: Record<string, string>;
  /** move tags: 'maps', 'ig', 'hub', 'serp', 'dir', free-form */
  tried: string[];
  note: string | null;
}

export interface Params {
  draftOnly?: boolean;
  channel?: string;
  focus?: string;
  goal?: 'negotiation' | 'meeting';
  text?: string;
  /** discovery */
  query?: string;
  segment?: string;
  city?: string;
  target?: number;
  briefId?: string;
  briefName?: string;
  monidCapUsd?: number;
  /** the inbound message this turn answers */
  messageId?: string;
  threadId?: string;
  by?: string;
}

export const EMPTY_TURN: TurnInfo = {
  id: null,
  kind: 'outreach',
  source: 'agent',
  trigger: 'timer.followup',
  params: {},
  acted: false,
  nudged: false,
  leads: [],
  leadsCreated: 0,
  pageReads: 0,
  monidUsd: 0,
  seen: [],
  styleBounced: false,
  book: [],
  campaign: null,
  closed: false,
};

export interface CrmCustom {
  turn: TurnInfo;
}

const obj = (v: Json | undefined): JsonObject =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};

// a lead's message outranks a staff ask, which outranks a promise, which outranks the agent's plans
const RANK: Record<string, number> = {
  'message.inbound': 0,
  'staff.request': 1,
  'staff.regenerate': 2,
  'timer.callback': 3,
  'lead.first_contact': 4,
  'timer.followup': 5,
  'timer.daily': 6,
  'timer.weekly': 6,
};

const PARAM_KEYS = [
  'draftOnly',
  'channel',
  'focus',
  'goal',
  'text',
  'query',
  'segment',
  'city',
  'target',
  'briefId',
  'briefName',
  'monidCapUsd',
  'messageId',
  'threadId',
  'by',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The turn a batch starts: the decisive row sets the job; params merge, the decisive row last. */
export function turnOf(
  batch: readonly { kind: string; source: string; payload: Json }[],
  id: string | null,
): TurnInfo {
  const rows = batch.filter((b) => b.kind in RANK);
  if (!rows.length) return { ...EMPTY_TURN, id };
  const top = [...rows].sort((a, b) => RANK[a.kind]! - RANK[b.kind]!)[0]!;
  const params: Record<string, Json> = {};
  for (const r of [...rows.filter((r) => r !== top), top]) {
    const p = obj(r.payload);
    for (const k of PARAM_KEYS) if (p[k] !== undefined && p[k] !== null) params[k] = p[k]!;
  }
  // tools cast it: anything but a uuid (old mail, a hand-written payload) is no thread
  if (typeof params.threadId !== 'string' || !UUID.test(params.threadId)) delete params.threadId;
  return {
    ...EMPTY_TURN,
    id,
    kind: jobOf(top.kind, top.payload),
    source: top.source,
    trigger: top.kind,
    params: params as Params,
  };
}

/** Tools whose landed call is the turn's visible, lead-facing outcome. */
export const ACTION_TOOLS = new Set([
  'update_lead',
  'set_state',
  'create_task',
  'draft_message',
  'send_message',
  'request_human',
  'unsubscribe',
]);

/** A tool result the model may count as done: ok, no error, not blocked. */
export function landed(p: JsonObject): boolean {
  if (p.ok !== true) return false;
  const d = obj(p.data);
  return d.error === undefined && d.blocked !== true && d.ignored !== true;
}

/** Output guards that push back once per turn before the model may stop. */
export const NUDGES = ['must_act', 'book_settled'];

export function applyCrm(prev: Json, e: AgentEvent): Json {
  const c: CrmCustom = { turn: { ...EMPTY_TURN, ...(obj(prev).turn as unknown as TurnInfo) } };
  const p = obj(e.payload);
  switch (e.type) {
    case 'turn.started': {
      const batch = (Array.isArray(p.batch) ? p.batch : []) as unknown as {
        kind: string;
        source: string;
        payload: Json;
      }[];
      // a maintenance turn (compaction) keeps the job it follows
      if (batch.some((b) => b.kind in RANK)) c.turn = turnOf(batch, e.turnId);
      break;
    }
    case 'tool.returned': {
      const name = String(p.name ?? '');
      if (ACTION_TOOLS.has(name) && landed(p)) c.turn.acted = true;
      if (name === 'unsubscribe' && landed(p)) c.turn.closed = true;
      if (p.ok !== true) break;
      const d = obj(p.data);
      if (typeof d.pageReads === 'number') c.turn.pageReads += d.pageReads;
      if (typeof d.monidUsd === 'number') c.turn.monidUsd += d.monidUsd;
      if (d.styleBounced === true) c.turn.styleBounced = true;
      if (Array.isArray(d.contacts))
        c.turn.seen = [
          ...c.turn.seen,
          ...d.contacts.filter((v): v is string => typeof v === 'string'),
        ];
      // create_lead: the lead it filed or merged into is now this turn's to touch
      if (typeof d.leadId === 'string' && !c.turn.leads.includes(d.leadId))
        c.turn.leads = [...c.turn.leads, d.leadId];
      if (d.created === true) c.turn.leadsCreated += 1;
      if (name === 'book' && d.entry && typeof d.entry === 'object') {
        const e = d.entry as unknown as BookEntry;
        const key = e.name.toLowerCase();
        c.turn.book = [...c.turn.book.filter((b) => b.name.toLowerCase() !== key), e];
      }
      if (name === 'plan' && typeof d.campaign === 'string') c.turn.campaign = d.campaign;
      break;
    }
    case 'guard.blocked':
      if (NUDGES.includes(String(p.guard ?? ''))) c.turn.nudged = true;
      break;
  }
  return c as unknown as Json;
}

export function turn(s: Readonly<ConversationState>): TurnInfo {
  return { ...EMPTY_TURN, ...(obj(s.custom as Json).turn as unknown as TurnInfo) };
}

/** The lead this conversation is about: from the runtime, never from the model. */
export function leadOf(ctx: Ctx): string {
  return ctx.subject.id;
}

/** CRM tables are platform data: a tool reads and writes them with the control scope open, in
 *  the step's transaction (a savepoint that restores the scope after). */
export function crm<T>(ctx: { tx: Sql }, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return controlTx(ctx.tx, fn);
}

/** The CRM screens' SSE hint, once the step commits. */
export function emitAfter(ctx: { tx: Sql }, type: ControlEventType, ref?: string): void {
  afterCommit(ctx.tx, () => emitControlEvent(type, ref));
}

/**
 * Per-turn counters for calls that may run in parallel (`read` tools): seeded from the folded
 * turn, shared by the calls of this process, recorded through each result's `data` so a replayed
 * turn starts from what was really spent.
 */
const live = new Map<string, { pageReads: number; monidUsd: number; seen: Set<string> }>();
export function counters(ctx: Ctx): { pageReads: number; monidUsd: number; seen: Set<string> } {
  let c = live.get(ctx.turnId);
  if (!c) {
    const t = turn(ctx.state);
    c = { pageReads: t.pageReads, monidUsd: t.monidUsd, seen: new Set(t.seen) };
    if (live.size > 500) live.clear();
    live.set(ctx.turnId, c);
  }
  return c;
}

/**
 * The CRM agents speak to leads only through their message tools, so the model's plain text
 * reaches no one: it stays in the event log as the turn's note to staff (the activity view).
 */
export const crmLogTransport: Transport<Sql> = {
  id: 'crm-log',
  async send(_tx, msg) {
    return { outboxId: `${msg.actorId}:${msg.turnId}:${msg.step}` };
  },
};

export const str = (v: unknown): string | null => {
  const t = String(v ?? '').trim();
  return t || null;
};

/** A Core refusal (validation, a 404) is feedback the model can act on, not a failed turn: its
 *  writes roll back to the tool's savepoint and the model reads the reason. */
export async function refusals<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const { HttpError } = await import('../../../platform/http.ts');
    if (e instanceof HttpError) throw new ToolError(`${e.code}: ${e.message}`);
    throw e;
  }
}

/** An idempotency key for a module write made inside a step (the step itself is memoized). */
export const stepKey = (ctx: Ctx, tool: string) => `crm:${ctx.turnId}:${tool}:${randomUUID()}`;
