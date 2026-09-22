import type { Sql } from '../platform/db.ts';
import { HttpError, str } from '../platform/http.ts';
import { claimControl, controlTx, type ClaimResult } from './control.ts';

/**
 * leads module — the Founder CRM's merchant-intake pipeline (docs/roadmap.md,
 * Phase 1). `leads` is platform data, not tenant data — every query runs
 * under the `vendua.control` GUC and the /control/v1 gate is the only access
 * boundary. Phase 4 folds these states into the Control Plane's provisioner.
 */

export const LEAD_STATES = ['lead', 'contacted', 'invited', 'live'] as const;
export type LeadState = (typeof LEAD_STATES)[number];

export const AGENT_MODES = ['off', 'draft', 'auto'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** What the agent is trying to get out of the conversation — staff picks it
 *  at dispatch time; 'negotiation' closes in-thread, 'meeting' drives toward
 *  the configured booking link. */
export const AGENT_GOALS = ['negotiation', 'meeting'] as const;
export type AgentGoal = (typeof AGENT_GOALS)[number];

/** One item of the lead's negotiation checklist — the agent writes it via
 *  `plan` (lead kinds) and ticks `done` as stages complete. Persisted on the
 *  lead so the plan survives across runs. */
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
  email_bounced_at: string | null;
  next_action_at: string | null;
  lost_reason: string | null;
  archived_at: string | null;
  unsubscribed_at: string | null;
  discovered_via: string | null;
  created_at: string;
  updated_at: string;
}

/** camelCase API view — the contract shape the app and callers see. */
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
  emailBouncedAt: string | null;
  nextActionAt: string | null;
  lostReason: string | null;
  archivedAt: string | null;
  unsubscribedAt: string | null;
  discoveredVia: string | null;
  createdAt: string;
  updatedAt: string;
}

/** List view — a lead plus the board/list columns the UI renders without
 *  N+1 queries. score comes from LEAD_SCORE_SQL below. */
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
    emailBouncedAt: row.email_bounced_at,
    nextActionAt: row.next_action_at,
    lostReason: row.lost_reason,
    archivedAt: row.archived_at,
    unsubscribedAt: row.unsubscribed_at,
    discoveredVia: row.discovered_via,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Validated state enum — anything outside it is a 422 contract error. */
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

/** fitScore payload → int 0–10 or null. The model's ICP match — kept
 *  separate from the SQL completeness score. */
function fitScoreValue(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10) {
    throw new HttpError(422, 'BAD_REQUEST', 'fitScore must be an integer in [0, 10]', {
      field: 'fitScore',
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
} as const;

type LeadTextField = keyof typeof LEAD_TEXT_FIELDS;

const MAX_TAGS = 20;
const MAX_TAG_LEN = 40;
const MAX_DEAL_VALUE_CENTS = 999_999_999;

/** tags payload → text[] value. Arrays only; entries trimmed, bounded. */
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

/** dealValueCents payload → int. null clears; negatives and fractions rejected. */
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

/** ISO-8601 timestamp payload → string postgres can cast. null clears. */
function timestampValue(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = str(v, field, 60);
  if (Number.isNaN(new Date(s).getTime())) {
    throw new HttpError(422, 'BAD_REQUEST', `${field} must be an ISO-8601 timestamp`, { field });
  }
  return s;
}

/** Create payload → column map. name required, the rest optional (→ null). */
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
  // Every path through here is an explicit whatsapp write — the setter is
  // asserting real evidence, so the provenance flag rides with the value.
  // Discovery overrides this to false right after for its mobile-derived fill.
  out.whatsapp_verified = Boolean(out.whatsapp);
  if ('tags' in body) out.tags = tagsValue(body.tags);
  if ('dealValueCents' in body) out.deal_value_cents = dealValue(body.dealValueCents);
  if ('nextActionAt' in body)
    out.next_action_at = timestampValue(body.nextActionAt, 'nextActionAt');
  if ('agentMode' in body) out.agent_mode = agentMode(body.agentMode);
  if ('agentGoal' in body) out.agent_goal = agentGoal(body.agentGoal);
  if ('fitScore' in body) out.fit_score = fitScoreValue(body.fitScore);
  if ('state' in body) out.state = leadState(body.state);
  return out;
}

/** Patch payload → column map. Absent keys are skipped; explicit null clears.
 *  `archived: true|false` maps to archived_at = now()/null — archive is a
 *  flag, not a pipeline state. */
export function leadPatch(body: Record<string, unknown>): Record<string, unknown> {
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
  // An explicit whatsapp write is the setter asserting real evidence — flag
  // it; clearing the field clears the flag too. (Discovery's mobile-derived
  // fill bypasses this path and lands the column itself.)
  if ('whatsapp' in set) set.whatsapp_verified = Boolean(set.whatsapp);
  if ('state' in body) set.state = leadState(body.state);
  if ('agentMode' in body) set.agent_mode = agentMode(body.agentMode);
  if ('agentGoal' in body) set.agent_goal = agentGoal(body.agentGoal);
  if ('fitScore' in body) set.fit_score = fitScoreValue(body.fitScore);
  if ('tags' in body) set.tags = tagsValue(body.tags);
  if ('dealValueCents' in body) set.deal_value_cents = dealValue(body.dealValueCents);
  if ('nextActionAt' in body)
    set.next_action_at = timestampValue(body.nextActionAt, 'nextActionAt');
  if ('archived' in body)
    set.archived_at = body.archived === true ? new Date().toISOString() : null;
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
  /** Opaque cursor from a previous page's nextCursor. */
  cursor?: string;
}

/**
 * Lead score, computed in SQL — deterministic, explainable, no model call.
 * Contact completeness + engagement recency, minus hard negatives
 * (unsubscribed/archived floor it at 0). Kept as one expression so list,
 * board and detail all rank identically.
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
  // Phone-shaped queries match NORMALIZED digits, not the stored formatting —
  // "997123470" must find "+55 22 99712-3470". The query must be ALL phone
  // characters, or a name like "Studio 54 2026" digit-matches strangers'
  // numbers. ≥4 digits guards short runs like "Doces 22".
  const qDigits = q && /^[+\d\s().-]+$/.test(q) ? q.replace(/\D/g, '') : '';
  const qDigitsLike = qDigits.length >= 4 ? `%${qDigits}%` : null;

  // Keyset pagination: (created_at, id) desc — stable under concurrent
  // inserts where a naive offset page can skip/dupe rows.
  let cursorAt: string | null = null;
  let cursorId: string | null = null;
  if (query.cursor) {
    try {
      const decoded = Buffer.from(query.cursor, 'base64url').toString('utf8');
      const sep = decoded.lastIndexOf('|');
      if (sep <= 0 || sep === decoded.length - 1) throw new Error('shape');
      cursorAt = decoded.slice(0, sep);
      cursorId = decoded.slice(sep + 1);
      if (Number.isNaN(new Date(cursorAt).getTime())) throw new Error('shape');
      // Postgres would reject a malformed uuid mid-query with a 500 — check
      // the shape here so bad cursors get the BAD_REQUEST above instead.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursorId)) {
        throw new Error('shape');
      }
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
      cursorAt && cursorId ? `(l.created_at, l.id) < (${p(cursorAt)}, ${p(cursorId)})` : 'true',
    ];
    return tx.unsafe(
      `select l.*, ${LEAD_SCORE_SQL} as score,
              coalesce(tk.n, 0)::int as open_tasks,
              coalesce(dr.n, 0)::int as pending_drafts,
              act.last_at as last_activity_at
       ${LEAD_LIST_FROM}
       where ${clauses.join('\n         and ')}
       order by l.created_at desc, l.id desc
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
        ? Buffer.from(`${last.created_at}|${last.id}`, 'utf8').toString('base64url')
        : null,
  };
}

export async function getLead(sql: Sql, id: string): Promise<LeadRow | null> {
  return controlTx(sql, async (tx) => {
    const rows = await tx<LeadRow[]>`select * from leads where id = ${id}`;
    return rows[0] ?? null;
  });
}

/** Detail view: the lead plus its score + inbox-style counters. */
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
  return claimControl(sql, idemKey, (tx) => insertLeadTx(tx, fields));
}

/** Tx-local insert — callers combining lead creation with side effects in
 *  one claim (the POST /leads route inserts the lead and its triage run
 *  under a single idempotency key) use this. */
export async function insertLeadTx(
  tx: Sql,
  fields: Record<string, unknown>,
): Promise<{ status: number; body: { lead: Lead } }> {
  const rows = await tx<LeadRow[]>`insert into leads ${tx(fields)} returning *`;
  await tx`
    insert into lead_state_history (lead_id, from_state, to_state, actor, value_cents)
    values (${rows[0]!.id}, null, ${rows[0]!.state}, 'staff', ${rows[0]!.deal_value_cents})
  `;
  return { status: 201, body: { lead: leadJson(rows[0]!) } };
}

export async function updateLead(
  sql: Sql,
  id: string,
  set: Record<string, unknown>,
  idemKey: string,
  actor: 'staff' | 'agent' | 'system' = 'staff',
): Promise<ClaimResult<{ lead: Lead }>> {
  return claimControl(sql, idemKey, async (tx) => {
    const cur = (await tx<LeadRow[]>`select * from leads where id = ${id}`)[0];
    if (!cur) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    // The bounce marker describes the stored address — a patch that swaps in
    // a different one must clear it, or the replacement stays blocked forever.
    const normEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : null);
    if ('email' in set && normEmail(set.email) !== normEmail(cur.email)) {
      set.email_bounced_at = null;
    }
    const rows = await tx<LeadRow[]>`
      update leads set ${tx(set)}, updated_at = now() where id = ${id} returning *
    `;
    if (typeof set.state === 'string' && set.state !== cur.state) {
      // value_cents stamps the post-update deal value — a same-patch edit to
      // dealValueCents is the value effective at the transition.
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
}

export async function deleteLead(
  sql: Sql,
  id: string,
  idemKey: string,
): Promise<ClaimResult<{ ok: true }>> {
  return claimControl(sql, idemKey, async (tx) => {
    const rows =
      await tx`update leads set archived_at = now(), updated_at = now() where id = ${id} returning id`;
    if (!rows[0]) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    return { status: 200, body: { ok: true as const } };
  });
}

/** Opt-out signal — from an inbound "para/unsubscribe" or a staff action.
 *  Once set, the agent guardrail blocks every outbound on this lead. */
export async function unsubscribeLead(sql: Sql, id: string): Promise<void> {
  await controlTx(sql, async (tx) => {
    await tx`update leads set unsubscribed_at = now(), updated_at = now() where id = ${id} and unsubscribed_at is null`;
    await tx`
      insert into lead_activities (lead_id, kind, body, created_by)
      values (${id}, 'system', 'Descadastrado — sem novos envios', 'system')
    `;
  });
}

// ---------------------------------------------------------------------------
// Stats + duplicates — the dashboard reads
// ---------------------------------------------------------------------------

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

/** Live per-state funnel totals — the same read leadStats serves and
 *  snapshotPipelineTx freezes into pipeline_snapshots (forecast.ts). */
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
    // "Won" = first 'live' entry inside the window per lead — a lead that
    // bounced through 'live' twice counts once. value_cents is frozen at
    // transition time (migration 0015 backfills pre-column rows), so post-win
    // edits to deal_value_cents can't rewrite reported revenue.
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
  /** leads created in the last 30d — the denominator that pairs with
   *  costCents (also 30d) for an apples-to-apples CPL. */
  leads30d: number;
  contacted: number;
  replied: number;
  live: number;
  costCents: number;
  /** costCents / leads30d; null when the segment produced no lead in the
   *  window — a spend with zero output is a worse signal than "—" implies,
   *  but inventing a per-lead price would be fiction. */
  cplCents: number | null;
}

/** Per-segment performance — leads found, contacts made, replies received,
 *  actives won, and 30d agent spend. Powers the Discovery panel and feeds
 *  each discovery run's context, so the agent leans into segments that
 *  convert instead of only following the brief's defaults. costCents covers
 *  BOTH lead-bound runs (triaged by the lead's segment) and discovery runs
 *  carrying params.segment — discovery is the acquisition spend, so a CPL
 *  without it would be fiction. */
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
    const discovery = await tx<{ segment: string | null; cost_cents: number }[]>`
      select nullif(r.params->>'segment', '') as segment,
             coalesce(sum(r.cost_cents), 0)::int as cost_cents
      from agent_runs r
      where r.kind = 'discovery' and r.created_at > now() - interval '30 days'
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

/** Exact normalized matches on the four contact channels — cheap, honest
 *  duplicate detection (fuzzy matching is a Phase-4+ concern). */
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

// ---------------------------------------------------------------------------
// CSV export / import
// ---------------------------------------------------------------------------

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
      // Our own export joins tags with ';' — split back so the round trip
      // preserves them instead of writing one giant tag.
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

/** Bulk import inside one claim: skips rows whose email/phone/instagram
 *  already exists — re-importing the same spreadsheet is a no-op. */
export async function importLeads(
  sql: Sql,
  rows: Record<string, unknown>[],
  idemKey: string,
): Promise<ClaimResult<{ created: number; skipped: { reason: string; name?: string }[] }>> {
  return claimControl(sql, idemKey, async (tx) => {
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
      const dup = await tx<{ id: string }[]>`
        select id from leads where archived_at is null and (
          (${email} is not null and lower(trim(email)) = lower(trim(${email})))
          or (${phone} is not null
              and length(regexp_replace(${phone}, '\\D', '', 'g')) >= 6
              and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = regexp_replace(${phone}, '\\D', '', 'g'))
          or (${whatsapp} is not null
              and length(regexp_replace(${whatsapp}, '\\D', '', 'g')) >= 6
              and regexp_replace(coalesce(whatsapp, ''), '\\D', '', 'g') = regexp_replace(${whatsapp}, '\\D', '', 'g'))
          or (${instagram} is not null and lower(trim(instagram)) = lower(trim(${instagram})))
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
}
