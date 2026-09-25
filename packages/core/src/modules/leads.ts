import type { Sql } from '../platform/db.ts';
import { HttpError, str, UUID_RE } from '../platform/http.ts';
import { claimControl, controlTx, type ClaimResult } from './control.ts';
import { emitControlEvent } from './control-events.ts';

/**
 * Lead CRM module — `leads` is platform data under the `vendua.control`
 * GUC; /control/v1 is the only access boundary.
 */

export const LEAD_STATES = ['lead', 'contacted', 'invited', 'live'] as const;
export type LeadState = (typeof LEAD_STATES)[number];

export const AGENT_MODES = ['off', 'draft', 'auto'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** Staff-set conversation goal: 'negotiation' closes in-thread, 'meeting'
 *  drives to the booking link. */
export const AGENT_GOALS = ['negotiation', 'meeting'] as const;
export type AgentGoal = (typeof AGENT_GOALS)[number];

/** Agent-written negotiation checklist persisted on the lead so the plan
 *  survives across runs. */
export const AGENT_PLAN_STATUSES = ['todo', 'done', 'skip'] as const;
export type AgentPlanStatus = (typeof AGENT_PLAN_STATUSES)[number];
export interface AgentPlanStep {
  step: string;
  status: AgentPlanStatus;
  note: string | null;
}

export interface LeadRow {
  id: string;
  name: string;
  business_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  /** false = auto-derived from a mobile phone; true = real whatsapp evidence. */
  whatsapp_verified: boolean;
  email: string | null;
  instagram: string | null;
  website: string | null;
  city: string | null;
  segment: string | null;
  source: string | null;
  owner: string | null;
  tags: string[] | null;
  deal_value_cents: number | null;
  state: LeadState;
  agent_mode: AgentMode;
  agent_goal: AgentGoal;
  agent_plan: AgentPlanStep[];
  fit_score: number | null;
  fit_reason: string | null;
  intent_score: number | null;
  intent_reason: string | null;
  email_bounced_at: string | null;
  next_action_at: string | null;
  lost_reason: string | null;
  archived_at: string | null;
  unsubscribed_at: string | null;
  agent_paused_at: string | null;
  discovered_via: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  name: string;
  businessName: string | null;
  phone: string | null;
  whatsapp: string | null;
  whatsappVerified: boolean;
  email: string | null;
  instagram: string | null;
  website: string | null;
  city: string | null;
  segment: string | null;
  source: string | null;
  owner: string | null;
  tags: string[];
  dealValueCents: number | null;
  state: LeadState;
  agentMode: AgentMode;
  agentGoal: AgentGoal;
  agentPlan: AgentPlanStep[];
  fitScore: number | null;
  fitReason: string | null;
  intentScore: number | null;
  intentReason: string | null;
  emailBouncedAt: string | null;
  nextActionAt: string | null;
  lostReason: string | null;
  archivedAt: string | null;
  unsubscribedAt: string | null;
  agentPausedAt: string | null;
  discoveredVia: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lead + board/list counters without N+1; score from LEAD_SCORE_SQL. */
export interface LeadListItem extends Lead {
  score: number;
  openTasks: number;
  pendingDrafts: number;
  lastActivityAt: string | null;
}

export function leadJson(row: LeadRow): Lead {
  return {
    id: row.id,
    name: row.name,
    businessName: row.business_name,
    phone: row.phone,
    whatsapp: row.whatsapp,
    whatsappVerified: row.whatsapp_verified,
    email: row.email,
    instagram: row.instagram,
    website: row.website,
    city: row.city,
    segment: row.segment,
    source: row.source,
    owner: row.owner,
    tags: row.tags ?? [],
    dealValueCents: row.deal_value_cents,
    state: row.state,
    agentMode: row.agent_mode,
    agentGoal: row.agent_goal,
    agentPlan: row.agent_plan ?? [],
    fitScore: row.fit_score,
    fitReason: row.fit_reason,
    intentScore: row.intent_score,
    intentReason: row.intent_reason,
    emailBouncedAt: row.email_bounced_at,
    nextActionAt: row.next_action_at,
    lostReason: row.lost_reason,
    archivedAt: row.archived_at,
    unsubscribedAt: row.unsubscribed_at,
    agentPausedAt: row.agent_paused_at,
    discoveredVia: row.discovered_via,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function leadState(v: unknown): LeadState {
  if (typeof v !== 'string' || !(LEAD_STATES as readonly string[]).includes(v)) {
    throw new HttpError(422, 'INVALID_STATE', `state must be one of: ${LEAD_STATES.join(', ')}`, {
      field: 'state',
    });
  }
  return v as LeadState;
}

export function agentGoal(v: unknown): AgentGoal {
  if (typeof v !== 'string' || !(AGENT_GOALS as readonly string[]).includes(v)) {
    throw new HttpError(
      422,
      'INVALID_AGENT_GOAL',
      `agentGoal must be one of: ${AGENT_GOALS.join(', ')}`,
      {
        field: 'agentGoal',
      },
    );
  }
  return v as AgentGoal;
}

/** Score payload → int 0–10 or null; model's fit/intent scores, separate
 *  from the SQL completeness score. */
function score010(v: unknown, field: 'fitScore' | 'intentScore'): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10) {
    throw new HttpError(422, 'BAD_REQUEST', `${field} must be an integer in [0, 10]`, {
      field,
    });
  }
  return n;
}

export function agentMode(v: unknown): AgentMode {
  if (typeof v !== 'string' || !(AGENT_MODES as readonly string[]).includes(v)) {
    throw new HttpError(
      422,
      'INVALID_AGENT_MODE',
      `agentMode must be one of: ${AGENT_MODES.join(', ')}`,
      {
        field: 'agentMode',
      },
    );
  }
  return v as AgentMode;
}

// API field → [column, max chars]. `name` is the only required field.
const LEAD_TEXT_FIELDS = {
  name: ['name', 200],
  businessName: ['business_name', 200],
  phone: ['phone', 60],
  whatsapp: ['whatsapp', 60],
  email: ['email', 200],
  instagram: ['instagram', 100],
  website: ['website', 300],
  city: ['city', 120],
  segment: ['segment', 80],
  source: ['source', 100],
  owner: ['owner', 80],
  lostReason: ['lost_reason', 300],
  discoveredVia: ['discovered_via', 120],
  fitReason: ['fit_reason', 300],
  intentReason: ['intent_reason', 300],
} as const;

type LeadTextField = keyof typeof LEAD_TEXT_FIELDS;

const MAX_TAGS = 20;
const MAX_TAG_LEN = 40;
const MAX_DEAL_VALUE_CENTS = 999_999_999;

function tagsValue(v: unknown): string[] {
  if (!Array.isArray(v)) {
    throw new HttpError(422, 'BAD_REQUEST', 'tags must be an array of strings', { field: 'tags' });
  }
  if (v.length > MAX_TAGS) {
    throw new HttpError(422, 'BAD_REQUEST', `tags accepts at most ${MAX_TAGS} entries`, {
      field: 'tags',
    });
  }
  return v.map((t) => str(t, 'tags', MAX_TAG_LEN));
}

function dealValue(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_DEAL_VALUE_CENTS) {
    throw new HttpError(422, 'BAD_REQUEST', 'dealValueCents must be an integer ≥ 0', {
      field: 'dealValueCents',
    });
  }
  return n;
}

function timestampValue(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = str(v, field, 60);
  if (Number.isNaN(new Date(s).getTime())) {
    throw new HttpError(422, 'BAD_REQUEST', `${field} must be an ISO-8601 timestamp`, { field });
  }
  return s;
}

export function leadInsert(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(LEAD_TEXT_FIELDS) as LeadTextField[]) {
    const [col, max] = LEAD_TEXT_FIELDS[field];
    const v = body[field];
    out[col] = v === undefined || v === null ? null : str(v, field, max);
  }
  if (!out.name?.toString().trim()) {
    throw new HttpError(422, 'INVALID_LEAD', 'name is required', { field: 'name' });
  }
  // explicit whatsapp write = real evidence; Discovery overrides to false
  // for its mobile-derived fill
  out.whatsapp_verified = Boolean(out.whatsapp);
  if ('tags' in body) out.tags = tagsValue(body.tags);
  if ('dealValueCents' in body) out.deal_value_cents = dealValue(body.dealValueCents);
  if ('nextActionAt' in body)
    out.next_action_at = timestampValue(body.nextActionAt, 'nextActionAt');
  if ('agentMode' in body) out.agent_mode = agentMode(body.agentMode);
  if ('agentGoal' in body) out.agent_goal = agentGoal(body.agentGoal);
  if ('fitScore' in body) out.fit_score = score010(body.fitScore, 'fitScore');
  if ('intentScore' in body) out.intent_score = score010(body.intentScore, 'intentScore');
  if ('state' in body) out.state = leadState(body.state);
  return out;
}

/** Patch payload → column map; `archived` maps to archived_at; `actor`
 *  stamps next_action_source — 'auto' for tool calls ('agent' is the
 *  unrecoverable 0025 legacy — never reuse it). */
export function leadPatch(
  body: Record<string, unknown>,
  actor: 'agent' | 'staff' = 'staff',
  /** true marks nextActionAt as lead-requested — a promised callback that
   *  survives an inbound reply, unlike the agent's own follow-up. */
  nextActionRequested = false,
): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const field of Object.keys(LEAD_TEXT_FIELDS) as LeadTextField[]) {
    if (!(field in body)) continue;
    const [col, max] = LEAD_TEXT_FIELDS[field];
    const v = body[field];
    set[col] = v === null ? null : str(v, field, max);
  }
  if ('name' in set && !set.name?.toString().trim()) {
    throw new HttpError(422, 'INVALID_LEAD', 'name cannot be empty', { field: 'name' });
  }
  // explicit whatsapp write = real evidence → flag it; clearing clears it
  // (Discovery's mobile-derived fill bypasses this path)
  if ('whatsapp' in set) set.whatsapp_verified = Boolean(set.whatsapp);
  if ('state' in body) set.state = leadState(body.state);
  if ('agentMode' in body) set.agent_mode = agentMode(body.agentMode);
  if ('agentGoal' in body) set.agent_goal = agentGoal(body.agentGoal);
  if ('fitScore' in body) set.fit_score = score010(body.fitScore, 'fitScore');
  if ('intentScore' in body) set.intent_score = score010(body.intentScore, 'intentScore');
  if ('tags' in body) set.tags = tagsValue(body.tags);
  if ('dealValueCents' in body) set.deal_value_cents = dealValue(body.dealValueCents);
  if ('nextActionAt' in body) {
    set.next_action_at = timestampValue(body.nextActionAt, 'nextActionAt');
    // who set it — updateLead turns this into an agenda entry (ADR 0016)
    set.next_action_source =
      set.next_action_at === null
        ? null
        : nextActionRequested
          ? 'requested'
          : actor === 'agent'
            ? 'auto'
            : actor;
  }
  if ('archived' in body) {
    if (typeof body.archived !== 'boolean') {
      throw new HttpError(422, 'BAD_REQUEST', 'archived must be a boolean', {
        field: 'archived',
      });
    }
    set.archived_at = body.archived ? new Date().toISOString() : null;
  }
  // staff resume after an unbound request_human — the lead-wide pause
  // gates every channel until cleared
  if ('agentPaused' in body) {
    if (typeof body.agentPaused !== 'boolean') {
      throw new HttpError(422, 'BAD_REQUEST', 'agentPaused must be a boolean', {
        field: 'agentPaused',
      });
    }
    set.agent_paused_at = body.agentPaused ? new Date().toISOString() : null;
  }
  if (Object.keys(set).length === 0) {
    throw new HttpError(422, 'BAD_REQUEST', 'no updatable fields in body');
  }
  return set;
}

export interface ListLeadsQuery {
  q?: string;
  state?: LeadState;
  tag?: string;
  /** 'exclude' (default) hides archived, 'only' shows just them, 'all' both. */
  archived?: 'exclude' | 'only' | 'all';
  limit?: number;
  cursor?: string;
  /** Keyset order — 'new' (default) walks created_at desc. */
  sort?: LeadSort;
}

export const LEAD_SORTS = ['new', 'activity', 'score', 'value', 'name'] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export function leadSort(v: unknown): LeadSort {
  if (typeof v !== 'string' || !(LEAD_SORTS as readonly string[]).includes(v)) {
    throw new HttpError(422, 'INVALID_SORT', `sort must be one of: ${LEAD_SORTS.join(', ')}`, {
      field: 'sort',
    });
  }
  return v as LeadSort;
}

/**
 * Lead score in SQL — completeness + engagement recency, minus hard
 * negatives; one expression so list, board and detail rank identically.
 */
const LEAD_SCORE_SQL = `greatest(0, least(100, (
    (case when l.phone is not null or l.whatsapp is not null then 20 else 0 end)
  + (case when l.email is not null then 10 else 0 end)
  + (case when l.instagram is not null then 10 else 0 end)
  + (case when l.business_name is not null then 10 else 0 end)
  + (case when l.segment is not null then 10 else 0 end)
  + (case when l.city is not null then 5 else 0 end)
  + (case when l.website is not null then 5 else 0 end)
  + (case when l.deal_value_cents is not null then 5 else 0 end)
  + least(15, coalesce(act.n, 0) * 3)
  + (case when act.last_at > now() - interval '7 days' then 10
          when act.last_at > now() - interval '30 days' then 5 else 0 end)
  - (case when l.unsubscribed_at is not null or l.archived_at is not null then 100 else 0 end)
)))`;

/** Shared FROM shape: lead + score + the counters the UI needs inline. */
const LEAD_LIST_FROM = `
  from leads l
  left join lateral (
    select count(*)::int n, max(a.at) last_at
    from lead_activities a where a.lead_id = l.id
  ) act on true
  left join lateral (
    select count(*)::int n from lead_tasks t
    where t.lead_id = l.id and t.done_at is null
  ) tk on true
  left join lateral (
    select count(*)::int n from lead_messages m
    join lead_threads th on th.id = m.thread_id
    where th.lead_id = l.id and m.status = 'draft'
  ) dr on true
`;

interface LeadListRow extends LeadRow {
  score: number;
  open_tasks: number;
  pending_drafts: number;
  last_activity_at: string | null;
  /** cursor-minting columns — ::text keeps microseconds JS Date would drop. */
  created_at_ts: string;
  last_at_ts: string | null;
}

/** `timestamptz::text` shape + calendar sanity — Postgres' cast is the
 *  authority, so pre-validate (offset ≤15, day ≤ month length). */
const TS_TEXT_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)?[+-](\d{2})$/;
function tsTextOk(ts: string): boolean {
  const m = TS_TEXT_RE.exec(ts);
  if (!m) return false;
  const [y, mo, d, h, mi, s, oh] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const days = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    mo >= 1 &&
    mo <= 12 &&
    d >= 1 &&
    d <= days[mo - 1]! &&
    h <= 23 &&
    mi <= 59 &&
    s <= 59 &&
    oh <= 15
  );
}

/** Per-sort keyset contract: cursor-WHERE key expression, ORDER BY
 *  fragment, direction, nullability (null keys page last on desc). */
const LEAD_SORT_SPEC: Record<
  LeadSort,
  {
    key: string;
    /** wraps the bound cursor value — e.g. 'lower' compares lower(name) on
     *  both sides. */
    cwrap?: string;
    order: string;
    desc: boolean;
    nullable: boolean;
  }
> = {
  new: { key: 'l.created_at', order: 'l.created_at desc, l.id desc', desc: true, nullable: false },
  activity: {
    key: 'act.last_at',
    order: 'act.last_at desc nulls last, l.id desc',
    desc: true,
    nullable: true,
  },
  // 'score' keys on the expression — the alias only exists in ORDER BY
  score: {
    key: `(${LEAD_SCORE_SQL})`,
    order: 'score desc, l.id desc',
    desc: true,
    nullable: false,
  },
  value: {
    key: 'l.deal_value_cents',
    order: 'l.deal_value_cents desc nulls last, l.id desc',
    desc: true,
    nullable: true,
  },
  name: {
    key: 'lower(l.name)',
    cwrap: 'lower',
    order: 'lower(l.name) asc, l.id asc',
    desc: false,
    nullable: false,
  },
};
function sortKeyOf(sort: LeadSort, row: LeadListRow): string | number | null {
  switch (sort) {
    case 'activity':
      return row.last_at_ts ?? null;
    case 'score':
      return Number(row.score);
    case 'value':
      return row.deal_value_cents;
    case 'name':
      return row.name;
    case 'new':
      return row.created_at_ts;
  }
}

function listItemJson(row: LeadListRow): LeadListItem {
  return {
    ...leadJson(row),
    score: Number(row.score),
    openTasks: Number(row.open_tasks),
    pendingDrafts: Number(row.pending_drafts),
    lastActivityAt: row.last_activity_at,
  };
}

export async function listLeads(
  sql: Sql,
  query: ListLeadsQuery = {},
): Promise<{ leads: LeadListItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const archived = query.archived ?? 'exclude';
  const q = query.q?.trim();
  // \ is Postgres' default LIKE escape — user % and _ can't widen the match.
  const qEsc = q ? `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%` : null;
  // phone-shaped queries match normalized digits — must be ALL phone chars
  // and ≥4 digits so names can't digit-match strangers' numbers
  const qDigits = q && /^[+\d\s().-]+$/.test(q) ? q.replace(/\D/g, '') : '';
  const qDigitsLike = qDigits.length >= 4 ? `%${qDigits}%` : null;

  // keyset cursor [sort, keyValue, id] — stable under concurrent inserts;
  // a cursor is only valid for its own sort
  const sort = query.sort ?? 'new';
  const spec = LEAD_SORT_SPEC[sort];
  let curVal: string | number | null = null;
  let curId: string | null = null;
  if (query.cursor) {
    try {
      const [s, v, i] = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as [
        string,
        string | number | null,
        string,
      ];
      if (s !== sort) throw new Error('shape');
      // reject malformed uuid here so bad cursors get BAD_REQUEST, not a 500
      if (typeof i !== 'string' || !UUID_RE.test(i)) throw new Error('shape');
      if (v === null) {
        if (!spec.nullable) throw new Error('shape');
      } else if (sort === 'score' || sort === 'value') {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('shape');
      } else if (sort === 'new' || sort === 'activity') {
        // cursor ts is minted from timestamptz::text — microseconds included.
        if (typeof v !== 'string' || !tsTextOk(v)) throw new Error('shape');
      } else {
        if (typeof v !== 'string') throw new Error('shape');
      }
      curVal = v;
      curId = i;
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'invalid cursor');
    }
  }

  const rows = await controlTx(sql, (tx) => {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const clauses = [
      archived === 'all'
        ? 'true'
        : archived === 'only'
          ? 'l.archived_at is not null'
          : 'l.archived_at is null',
      query.state ? `l.state = ${p(query.state)}` : 'true',
      query.tag ? `l.tags @> array[${p(query.tag)}]::text[]` : 'true',
      qEsc
        ? `(l.name ilike ${p(qEsc)} or l.business_name ilike ${p(qEsc)}
           or l.email ilike ${p(qEsc)} or l.phone ilike ${p(qEsc)}
           or l.whatsapp ilike ${p(qEsc)} or l.instagram ilike ${p(qEsc)}
           or l.city ilike ${p(qEsc)}
           ${
             qDigitsLike
               ? `or regexp_replace(coalesce(l.phone,''),'\\D','','g') like ${p(qDigitsLike)}
           or regexp_replace(coalesce(l.whatsapp,''),'\\D','','g') like ${p(qDigitsLike)}`
               : ''
           })`
        : 'true',
      // cursor predicate: strictly past last key, then id tiebreak; null
      // keys page last on desc
      curId
        ? curVal === null
          ? `(${spec.key} is null and l.id ${spec.desc ? '<' : '>'} ${p(curId)}::uuid)`
          : (() => {
              // timestamp keys bind as text cast server-side — a JS Date
              // bind would drop microseconds
              const kv =
                sort === 'new' || sort === 'activity'
                  ? `${p(curVal)}::text::timestamptz`
                  : spec.cwrap
                    ? `${spec.cwrap}(${p(curVal)})`
                    : p(curVal);
              const op = spec.desc ? '<' : '>';
              return (
                `(${spec.key} ${op} ${kv} or ` +
                `(${spec.key} = ${kv} and l.id ${op} ${p(curId)}::uuid)` +
                `${spec.nullable ? ` or ${spec.key} is null` : ''})`
              );
            })()
        : 'true',
    ];
    return tx.unsafe(
      `select l.*, ${LEAD_SCORE_SQL} as score,
              coalesce(tk.n, 0)::int as open_tasks,
              coalesce(dr.n, 0)::int as pending_drafts,
              act.last_at as last_activity_at,
              l.created_at::text as created_at_ts,
              act.last_at::text as last_at_ts
       ${LEAD_LIST_FROM}
       where ${clauses.join('\n         and ')}
       order by ${spec.order}
       limit ${limit + 1}`,
      params as never[],
    ) as Promise<LeadListRow[]>;
  });

  const items = rows.slice(0, limit).map(listItemJson);
  const overflow = rows.length > limit;
  const last = rows[Math.min(limit, rows.length) - 1];
  return {
    leads: items,
    nextCursor:
      overflow && last
        ? Buffer.from(JSON.stringify([sort, sortKeyOf(sort, last), last.id]), 'utf8').toString(
            'base64url',
          )
        : null,
  };
}

export async function getLead(sql: Sql, id: string): Promise<LeadRow | null> {
  return controlTx(sql, async (tx) => {
    const rows = await tx<LeadRow[]>`select * from leads where id = ${id}`;
    return rows[0] ?? null;
  });
}

export async function getLeadDetail(sql: Sql, id: string): Promise<LeadListItem | null> {
  const rows = await controlTx(
    sql,
    (tx) =>
      tx.unsafe(
        `select l.*, ${LEAD_SCORE_SQL} as score,
                coalesce(tk.n, 0)::int as open_tasks,
                coalesce(dr.n, 0)::int as pending_drafts,
                act.last_at as last_activity_at
         ${LEAD_LIST_FROM}
         where l.id = $1`,
        [id] as never[],
      ) as Promise<LeadListRow[]>,
  );
  const row = rows[0];
  return row ? listItemJson(row) : null;
}

export async function createLead(
  sql: Sql,
  fields: Record<string, unknown>,
  idemKey: string,
): Promise<ClaimResult<{ lead: Lead }>> {
  const res = await claimControl(sql, idemKey, (tx) => insertLeadTx(tx, fields));
  if (!res.replayed) emitControlEvent('lead.change', res.body.lead.id);
  return res;
}

/** Tx-local insert for callers combining lead creation with side effects
 *  under one claim key (e.g. POST /leads + triage run). */
export async function insertLeadTx(
  tx: Sql,
  fields: Record<string, unknown>,
): Promise<{ status: number; body: { lead: Lead } }> {
  const { next_action_at: nextAt, next_action_source: _src, ...cols } = fields;
  let rows = await tx<LeadRow[]>`insert into leads ${tx(cols)} returning *`;
  await tx`
    insert into lead_state_history (lead_id, from_state, to_state, actor, value_cents)
    values (${rows[0]!.id}, null, ${rows[0]!.state}, 'staff', ${rows[0]!.deal_value_cents})
  `;
  // a next-action date is an agenda entry (ADR 0016) — the column only mirrors it
  if (nextAt) {
    const { setNextActionTx } = await import('../agent/wakeups.ts');
    await setNextActionTx(tx, rows[0]!.id, nextAt as string, 'staff');
    rows = await tx<LeadRow[]>`select * from leads where id = ${rows[0]!.id}`;
  }
  return { status: 201, body: { lead: leadJson(rows[0]!) } };
}

export async function updateLead(
  sql: Sql,
  id: string,
  set: Record<string, unknown>,
  idemKey: string,
  actor: 'staff' | 'agent' | 'system' = 'staff',
  /** Optional fence inside the claim tx — a live-claim check so a
   *  reclaimed run can't still mutate. */
  guard?: (tx: Sql) => Promise<void>,
): Promise<ClaimResult<{ lead: Lead }>> {
  const res = await claimControl(sql, idemKey, async (tx) => {
    await guard?.(tx);
    const cur = (await tx<LeadRow[]>`select * from leads where id = ${id}`)[0];
    if (!cur) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    // the bounce marker describes the stored address — a different email
    // must clear it
    const normEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : null);
    if ('email' in set && normEmail(set.email) !== normEmail(cur.email)) {
      set.email_bounced_at = null;
    }
    // a next-action date is an agenda entry (ADR 0016) — the column only mirrors it
    let nextAction: { at: string | null; who: 'staff' | 'agent' | 'requested' } | null = null;
    if ('next_action_at' in set) {
      const src = set.next_action_source;
      nextAction = {
        at: (set.next_action_at as string | null) ?? null,
        who: src === 'requested' ? 'requested' : actor === 'agent' ? 'agent' : 'staff',
      };
      delete set.next_action_at;
      delete set.next_action_source;
      // agenda first: every agenda writer locks wakeup:advisory → wakeup rows → the lead row
      // (scheduleWakeupTx, the wakeup sweep) — updating the lead first would invert that
      const { setNextActionTx } = await import('../agent/wakeups.ts');
      await setNextActionTx(tx, id, nextAction.at, nextAction.who);
    }
    const rows = Object.keys(set).length
      ? await tx<LeadRow[]>`
          update leads set ${tx(set)}, updated_at = now() where id = ${id} returning *
        `
      : await tx<LeadRow[]>`update leads set updated_at = now() where id = ${id} returning *`;
    if (typeof set.state === 'string' && set.state !== cur.state) {
      // value_cents stamps the post-update deal value at the transition
      await tx`
        insert into lead_state_history (lead_id, from_state, to_state, actor, value_cents)
        values (${id}, ${cur.state}, ${set.state}, ${actor}, ${rows[0]!.deal_value_cents})
      `;
      await tx`
        insert into lead_activities (lead_id, kind, body, meta, created_by)
        values (${id}, 'state_change', ${`${cur.state} → ${set.state}`},
                ${tx.json({ from: cur.state, to: set.state })}, ${actor})
      `;
    }
    return { status: 200, body: { lead: leadJson(rows[0]!) } };
  });
  if (!res.replayed) emitControlEvent('lead.change', res.body.lead.id);
  return res;
}

export async function deleteLead(
  sql: Sql,
  id: string,
  idemKey: string,
): Promise<ClaimResult<{ ok: true }>> {
  const res = await claimControl(sql, idemKey, async (tx) => {
    const rows =
      await tx`update leads set archived_at = now(), updated_at = now() where id = ${id} returning id`;
    if (!rows[0]) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    return { status: 200, body: { ok: true as const } };
  });
  if (!res.replayed) emitControlEvent('lead.change', id);
  return res;
}

/** Opt-out — once set, the guardrail blocks every outbound on this lead. */
export async function unsubscribeLead(sql: Sql, id: string): Promise<void> {
  const transitioned = await controlTx(sql, async (tx) => {
    const rows = await tx`
      update leads set unsubscribed_at = now(), updated_at = now()
      where id = ${id} and unsubscribed_at is null returning id
    `;
    const exists = rows[0] ?? (await tx`select id from leads where id = ${id}`)[0];
    if (!exists) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    if (!rows[0]) return false;
    // queued runs on an opted-out lead can never claim — cancel them
    await tx`
      update agent_runs set status = 'canceled', error = 'descadastrado', finished_at = now()
      where lead_id = ${id} and status = 'queued'
    `;
    await tx`
      insert into lead_activities (lead_id, kind, body, created_by)
      values (${id}, 'system', 'Descadastrado — sem novos envios', 'system')
    `;
    return true;
  });
  if (transitioned) emitControlEvent('lead.change', id);
}

export interface LeadStats {
  total: number;
  byState: Record<string, { count: number; valueCents: number }>;
  bySource: { key: string; count: number; valueCents: number }[];
  bySegment: { key: string; count: number; valueCents: number }[];
  /** distinct leads that ever reached each state (funnel conversion). */
  everReached: Record<string, number>;
  medianDaysInState: Record<string, number>;
  /** leads that reached 'live' in the last 30d — the "won" read for reports. */
  won30d: { count: number; valueCents: number };
  openTasks: number;
  overdueTasks: number;
  pendingDrafts: number;
  discoveredThisWeek: number;
  agent30d: { runs: number; tokens: number; costCents: number };
}

export interface StateBucket {
  count: number;
  valueCents: number;
}

/** Live per-state funnel totals — the read snapshotPipelineTx freezes
 *  into pipeline_snapshots (forecast.ts). */
export async function pipelineByStateTx(tx: Sql): Promise<Record<string, StateBucket>> {
  const rows = await tx<{ state: string; count: number; value_cents: number }[]>`
    select state, count(*)::int as count, coalesce(sum(deal_value_cents), 0)::int as value_cents
    from leads where archived_at is null group by state
  `;
  return Object.fromEntries(
    rows.map((r) => [r.state, { count: r.count, valueCents: r.value_cents }]),
  );
}

export async function leadStats(sql: Sql): Promise<LeadStats> {
  return controlTx(sql, async (tx) => {
    const byStateMap = await pipelineByStateTx(tx);
    const total = (
      await tx<{ n: number }[]>`select count(*)::int n from leads where archived_at is null`
    )[0]!.n;
    const bySource = await tx<{ key: string; count: number; value_cents: number }[]>`
      select coalesce(nullif(source, ''), '—') as key, count(*)::int as count,
             coalesce(sum(deal_value_cents), 0)::int as value_cents
      from leads where archived_at is null group by 1 order by 2 desc, 1
    `;
    const bySegment = await tx<{ key: string; count: number; value_cents: number }[]>`
      select coalesce(nullif(segment, ''), '—') as key, count(*)::int as count,
             coalesce(sum(deal_value_cents), 0)::int as value_cents
      from leads where archived_at is null group by 1 order by 2 desc, 1
    `;
    // "won" = first 'live' entry in the window per lead; value_cents frozen
    // at transition so later edits can't rewrite reported revenue
    const won = (
      await tx<{ n: number; value_cents: number }[]>`
        select count(*)::int as n, coalesce(sum(w.value_cents), 0)::int as value_cents
        from (select distinct on (lead_id) lead_id, value_cents
              from lead_state_history
              where to_state = 'live' and at > now() - interval '30 days'
              order by lead_id, at) w
      `
    )[0]!;
    const reached = await tx<{ to_state: string; n: number }[]>`
      select to_state, count(distinct lead_id)::int n from lead_state_history group by to_state
    `;
    // Median hours per transition → days; funnel stall points per stage.
    const medians = await tx<{ to_state: string; days: number }[]>`
      select to_state,
             round((percentile_cont(0.5) within group (
               order by extract(epoch from (at - first_at)) / 86400.0))::numeric, 1)::float8 as days
      from (
        select h.to_state, h.lead_id, h.at,
               first_value(h.at) over (partition by h.lead_id order by h.at) as first_at
        from lead_state_history h
      ) s group by to_state
    `;
    const tasks = (
      await tx<{ open: number; overdue: number }[]>`
        select count(*)::int as open,
               count(*) filter (where due_at < now())::int as overdue
        from lead_tasks where done_at is null
      `
    )[0]!;
    const drafts = (
      await tx<{ n: number }[]>`select count(*)::int n from lead_messages where status = 'draft'`
    )[0]!.n;
    const discovered = (
      await tx<{ n: number }[]>`
        select count(*)::int n from leads
        where discovered_via is not null and created_at > now() - interval '7 days'
      `
    )[0]!.n;
    const agent = (
      await tx<{ runs: number; tokens: number; cost_cents: number }[]>`
        select count(*)::int as runs,
               coalesce(sum(tokens_in + tokens_out), 0)::int as tokens,
               coalesce(sum(cost_cents), 0)::int as cost_cents
        from agent_runs where created_at > now() - interval '30 days'
      `
    )[0]!;

    return {
      total,
      byState: byStateMap,
      bySource: bySource.map((r) => ({ key: r.key, count: r.count, valueCents: r.value_cents })),
      bySegment: bySegment.map((r) => ({ key: r.key, count: r.count, valueCents: r.value_cents })),
      everReached: Object.fromEntries(reached.map((r) => [r.to_state, r.n])),
      medianDaysInState: Object.fromEntries(medians.map((r) => [r.to_state, r.days])),
      won30d: { count: won.n, valueCents: won.value_cents },
      openTasks: tasks.open,
      overdueTasks: tasks.overdue,
      pendingDrafts: drafts,
      discoveredThisWeek: discovered,
      agent30d: { runs: agent.runs, tokens: agent.tokens, costCents: agent.cost_cents },
    };
  });
}

export interface SegmentStat {
  segment: string;
  leads: number;
  /** leads created in the last 30d — denominator pairing with costCents
   *  for CPL. */
  leads30d: number;
  contacted: number;
  replied: number;
  live: number;
  costCents: number;
  /** costCents/leads30d; null with no leads in window — inventing a price
   *  would be fiction. */
  cplCents: number | null;
}

/** Per-segment performance incl. 30d spend — costCents covers lead-bound
 *  runs AND lead-less discovery runs (acquisition spend) so CPL is honest. */
export async function segmentStats(sql: Sql): Promise<SegmentStat[]> {
  return controlTx(sql, async (tx) => {
    const rows = await tx<
      {
        segment: string;
        leads: number;
        leads30d: number;
        contacted: number;
        replied: number;
        live: number;
      }[]
    >`
      select coalesce(nullif(l.segment, ''), '—') as segment,
             count(*)::int as leads,
             count(*) filter (where l.created_at > now() - interval '30 days')::int as leads30d,
             count(*) filter (where exists (
               select 1 from lead_state_history h
               where h.lead_id = l.id and h.to_state <> 'lead'))::int as contacted,
             count(*) filter (where exists (
               select 1 from lead_threads t
               join lead_messages m on m.thread_id = t.id
               where t.lead_id = l.id and m.direction = 'in'))::int as replied,
             count(*) filter (where l.state = 'live')::int as live
      from leads l
      where l.archived_at is null
      group by 1
      order by 5 desc, 2 desc
      limit 12
    `;
    const costs = await tx<{ segment: string; cost_cents: number }[]>`
      select coalesce(nullif(l.segment, ''), '—') as segment,
             coalesce(sum(r.cost_cents), 0)::int as cost_cents
      from agent_runs r join leads l on l.id = r.lead_id
      where r.created_at > now() - interval '30 days'
        and l.archived_at is null
      group by 1
    `;
    // disjoint with the lead-bound query — params.segment only carries
    // lead-less runs, else every cost would double-count
    const discovery = await tx<{ segment: string | null; cost_cents: number }[]>`
      select nullif(r.params->>'segment', '') as segment,
             coalesce(sum(r.cost_cents), 0)::int as cost_cents
      from agent_runs r
      where r.kind = 'discovery' and r.lead_id is null
        and r.created_at > now() - interval '30 days'
      group by 1
    `;
    const costBy = new Map(costs.map((c) => [c.segment, c.cost_cents]));
    for (const d of discovery) {
      if (d.segment) costBy.set(d.segment, (costBy.get(d.segment) ?? 0) + d.cost_cents);
    }
    return rows.map((r) => {
      const costCents = costBy.get(r.segment) ?? 0;
      return { ...r, costCents, cplCents: r.leads30d ? Math.round(costCents / r.leads30d) : null };
    });
  });
}

export interface DuplicateGroup {
  field: 'email' | 'phone' | 'whatsapp' | 'instagram';
  value: string;
  leads: { id: string; name: string; businessName: string | null; state: LeadState }[];
}

/** Exact normalized matches on the contact channels — fuzzy matching is
 *  a later concern. */
export async function findDuplicates(sql: Sql): Promise<DuplicateGroup[]> {
  return controlTx(sql, async (tx) => {
    const norm = `
      select id, name, business_name, state,
             nullif(lower(trim(email)), '') as email,
             nullif(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), '') as phone,
             nullif(regexp_replace(coalesce(whatsapp, ''), '\\D', '', 'g'), '') as whatsapp,
             nullif(lower(trim(instagram)), '') as instagram
      from leads where archived_at is null`;
    const groups: DuplicateGroup[] = [];
    for (const field of ['email', 'phone', 'whatsapp', 'instagram'] as const) {
      const minLen = field === 'email' || field === 'instagram' ? 3 : 6;
      const rows = await tx.unsafe(
        `with norm as (${norm})
         select ${field} as value, jsonb_agg(jsonb_build_object(
           'id', id, 'name', name, 'businessName', business_name, 'state', state)) as leads
         from norm where ${field} is not null and length(${field}) >= ${minLen}
         group by ${field} having count(*) > 1`,
      );
      for (const r of rows as unknown as { value: string; leads: DuplicateGroup['leads'] }[]) {
        groups.push({ field, value: r.value, leads: r.leads });
      }
    }
    return groups;
  });
}

const CSV_COLUMNS: [string, (l: LeadRow) => string][] = [
  ['name', (l) => l.name],
  ['businessName', (l) => l.business_name ?? ''],
  ['phone', (l) => l.phone ?? ''],
  ['whatsapp', (l) => l.whatsapp ?? ''],
  ['email', (l) => l.email ?? ''],
  ['instagram', (l) => l.instagram ?? ''],
  ['website', (l) => l.website ?? ''],
  ['city', (l) => l.city ?? ''],
  ['segment', (l) => l.segment ?? ''],
  ['source', (l) => l.source ?? ''],
  ['state', (l) => l.state],
  ['dealValueCents', (l) => (l.deal_value_cents === null ? '' : String(l.deal_value_cents))],
  ['tags', (l) => (l.tags ?? []).join(';')],
];

function csvCell(v: string): string {
  return /[",\n;]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

export async function exportLeadsCsv(sql: Sql): Promise<string> {
  const rows = await controlTx(
    sql,
    (tx) => tx<LeadRow[]>`select * from leads where archived_at is null order by created_at desc`,
  );
  const header = CSV_COLUMNS.map(([h]) => h).join(',');
  const lines = rows.map((r) => CSV_COLUMNS.map(([, f]) => csvCell(f(r))).join(','));
  return [header, ...lines].join('\n') + '\n';
}

/** Header aliases — accepts our own export plus the obvious pt-BR dump. */
const CSV_HEADER_MAP: Record<
  string,
  keyof typeof LEAD_TEXT_FIELDS | 'dealValueCents' | 'state' | 'tags'
> = {
  name: 'name',
  nome: 'name',
  businessname: 'businessName',
  business_name: 'businessName',
  negocio: 'businessName',
  negócio: 'businessName',
  empresa: 'businessName',
  phone: 'phone',
  telefone: 'phone',
  tel: 'phone',
  whatsapp: 'whatsapp',
  zap: 'whatsapp',
  email: 'email',
  'e-mail': 'email',
  instagram: 'instagram',
  ig: 'instagram',
  website: 'website',
  site: 'website',
  city: 'city',
  cidade: 'city',
  segment: 'segment',
  segmento: 'segment',
  source: 'source',
  origem: 'source',
  dealvaluecents: 'dealValueCents',
  valor: 'dealValueCents',
  state: 'state',
  estado: 'state',
  estagio: 'state',
  estágio: 'state',
  stage: 'state',
  tags: 'tags',
  etiquetas: 'tags',
};

/** Minimal RFC-4180 CSV parse: quoted cells, doubled quotes, CRLF, `;`
 *  delimiter auto-detect (Brazilian Excel exports). */
export function parseLeadsCsv(text: string): {
  rows: Record<string, unknown>[];
  skipped: { line: number; reason: string }[];
} {
  const firstLine = text.slice(0, text.indexOf('\n') || text.length);
  const delim =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const records: string[][] = [];
  let cur: string[] = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) {
      cur.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cur.push(cell);
      cell = '';
      records.push(cur);
      cur = [];
    } else cell += ch;
  }
  if (cur.length || cell) {
    cur.push(cell);
    records.push(cur);
  }
  const [header, ...body] = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (!header) return { rows: [], skipped: [] };
  const cols = header.map((h) => CSV_HEADER_MAP[h.trim().toLowerCase()] ?? null);
  const rows: Record<string, unknown>[] = [];
  const skipped: { line: number; reason: string }[] = [];
  body.forEach((rec, i) => {
    const out: Record<string, unknown> = {};
    rec.forEach((v, j) => {
      const field = cols[j];
      if (!field || v.trim() === '') return;
      // our export joins tags with ';' — split back so the round trip
      // preserves them
      out[field] =
        field === 'tags'
          ? v
              .split(/[;|]/)
              .map((t) => t.trim())
              .filter(Boolean)
          : v.trim();
    });
    if (!out.name) skipped.push({ line: i + 2, reason: 'sem nome' });
    else rows.push(out);
  });
  return { rows, skipped };
}

/** Bulk import in one claim — skips existing email/phone/instagram;
 *  re-import is a no-op. */
export async function importLeads(
  sql: Sql,
  rows: Record<string, unknown>[],
  idemKey: string,
): Promise<ClaimResult<{ created: number; skipped: { reason: string; name?: string }[] }>> {
  const res = await claimControl(sql, idemKey, async (tx) => {
    let created = 0;
    const skipped: { reason: string; name?: string }[] = [];
    for (const row of rows) {
      let fields: Record<string, unknown>;
      try {
        fields = leadInsert(row);
      } catch (e) {
        skipped.push({ reason: e instanceof HttpError ? e.message : 'invalid row' });
        continue;
      }
      const email = fields.email as string | null;
      const phone = fields.phone as string | null;
      const whatsapp = fields.whatsapp as string | null;
      const instagram = fields.instagram as string | null;
      // ::text casts — a NULL param in bare "is not null" is untypable
      // (Postgres 42P18)
      const dup = await tx<{ id: string }[]>`
        select id from leads where archived_at is null and (
          (${email}::text is not null and lower(trim(email)) = lower(trim(${email})))
          or (${phone}::text is not null
              and length(regexp_replace(${phone}, '\\D', '', 'g')) >= 6
              and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = regexp_replace(${phone}, '\\D', '', 'g'))
          or (${whatsapp}::text is not null
              and length(regexp_replace(${whatsapp}, '\\D', '', 'g')) >= 6
              and regexp_replace(coalesce(whatsapp, ''), '\\D', '', 'g') = regexp_replace(${whatsapp}, '\\D', '', 'g'))
          or (${instagram}::text is not null and lower(trim(instagram)) = lower(trim(${instagram})))
        ) limit 1
      `;
      if (dup[0]) {
        skipped.push({ reason: 'duplicado', name: String(fields.name) });
        continue;
      }
      const ins = await tx<LeadRow[]>`insert into leads ${tx(fields)} returning *`;
      await tx`
        insert into lead_state_history (lead_id, from_state, to_state, actor, value_cents)
        values (${ins[0]!.id}, null, ${ins[0]!.state}, 'staff', ${ins[0]!.deal_value_cents})
      `;
      created++;
    }
    return { status: 200, body: { created, skipped } };
  });
  if (!res.replayed && res.body.created > 0) emitControlEvent('lead.change');
  return res;
}
