/**
 * agent-memory — memory v2 (ADR 0014): workspace/segment learnings,
 * discovery debriefs, and structured per-lead facts.
 *
 * Control-plane tables (workspace-global, no tenant_id) — every function
 * here runs inside a control tx: the runner's claim tx for the *Tx exports,
 * controlTx/claimControl for the route helpers.
 *
 * Caps: workspace+segment learnings share one 200-item cap, debriefs a
 * separate 60 — discovery history can no longer flush learnings the way
 * the old shared facts list let it. Eviction prefers the oldest UNPINNED
 * item; a pinned item is staff's "never forget". rememberTx dedupes
 * case-insensitively on (scope, segment, content) — a re-learned fact
 * refreshes updated_at, which is also its eviction protection.
 */
import { HttpError, UUID_RE } from '../platform/http.ts';
import type { Sql } from '../platform/db.ts';
import { claimControl, controlTx, type ClaimResult } from './control.ts';
import { emitControlEvent } from './control-events.ts';

export const MEMORY_SCOPES = ['workspace', 'segment', 'debrief'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_SOURCES = ['agent', 'staff', 'debrief'] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const LEAD_FACT_SOURCES = ['agent', 'staff'] as const;
export type LeadFactSource = (typeof LEAD_FACT_SOURCES)[number];

const LEARNINGS_CAP = 200;
const DEBRIEFS_CAP = 60;
// How much debrief history a run's memory feed carries at most.
const DEBRIEF_FEED = 8;

export const LEAD_FACT_KEY_RE = /^[a-z][a-z0-9_]{0,59}$/;

export interface MemoryItemRow {
  id: string;
  scope: MemoryScope;
  segment: string | null;
  content: string;
  pinned: boolean;
  source: MemorySource;
  source_run_id: string | null;
  uses: number;
  created_at: string;
  updated_at: string;
}

/** camelCase API view — the ADR 0014 MemoryItem contract. */
export interface MemoryItem {
  id: string;
  scope: MemoryScope;
  segment: string | null;
  content: string;
  pinned: boolean;
  source: MemorySource;
  sourceRunId: string | null;
  uses: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeadFactRow {
  lead_id: string;
  key: string;
  value: string;
  confidence: number | string; // numeric(3,2) reads back as string
  source: LeadFactSource;
  source_run_id: string | null;
  updated_at: string;
}

/** camelCase API view — the ADR 0014 LeadFact contract. */
export interface LeadFact {
  key: string;
  value: string;
  confidence: number;
  source: LeadFactSource;
  sourceRunId: string | null;
  updatedAt: string;
}

export function memoryItemJson(row: MemoryItemRow): MemoryItem {
  return {
    id: row.id,
    scope: row.scope,
    segment: row.segment,
    content: row.content,
    pinned: row.pinned,
    source: row.source,
    sourceRunId: row.source_run_id,
    uses: row.uses,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function leadFactJson(row: LeadFactRow): LeadFact {
  return {
    key: row.key,
    value: row.value,
    confidence: Number(row.confidence),
    source: row.source,
    sourceRunId: row.source_run_id,
    updatedAt: row.updated_at,
  };
}

/** True when the 0035 memory tables are deployed — a control box ahead of
 *  its migrations keeps the legacy `control_settings.agent_memory` read
 *  path and turns the write tools into no-op errors instead of 42P01s. */
export async function hasMemoryTablesTx(tx: Sql): Promise<boolean> {
  const r = await tx<{ r: string | null }[]>`select to_regclass('agent_memory_items') as r`;
  return r[0]!.r !== null;
}

const bad = (field: string, why: string) =>
  new HttpError(422, 'BAD_REQUEST', `${field} ${why}`, { field });

/** Validated scope enum for query/body fields — 422 outside the contract. */
export function memoryScope(v: unknown): MemoryScope {
  return checkScope(v);
}

function checkScope(v: unknown): MemoryScope {
  if (typeof v !== 'string' || !(MEMORY_SCOPES as readonly string[]).includes(v)) {
    throw bad('scope', 'must be workspace|segment|debrief');
  }
  return v as MemoryScope;
}

function checkSegment(scope: MemoryScope, v: unknown): string | null {
  if (v !== undefined && v !== null && typeof v !== 'string') {
    throw bad('segment', 'must be a string');
  }
  const segment = typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null;
  if (scope === 'segment' && !segment) {
    throw bad('segment', 'is required for segment-scoped items');
  }
  if (segment && segment.length > 120) throw bad('segment', 'must be ≤120 chars');
  return segment;
}

function checkContent(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw bad('content', 'must be a non-empty string');
  if (v.length > 500) throw bad('content', 'must be ≤500 chars');
  return v;
}

function checkSourceRunId(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !UUID_RE.test(v)) {
    throw new HttpError(400, 'BAD_REQUEST', 'sourceRunId must be a uuid', { field: 'sourceRunId' });
  }
  return v;
}

/** Cap enforcement inside the remember tx: keep ⌊cap − pinned⌋ newest
 *  unpinned items of the class. Pinning is the staff override — a class
 *  entirely pinned leaves no room at all, so a write into it is rejected
 *  (MEMORY_CAP_PINNED) rather than silently evicting what was just stored.
 *  Learnings evict by updated_at (a dedupe-hit refresh is an anti-eviction
 *  signal); debriefs are an append log, evict by created_at. */
async function enforceMemoryCapTx(
  tx: Sql,
  cls: 'learning' | 'debrief',
): Promise<{ id: string; content: string }[]> {
  const rows =
    cls === 'learning'
      ? await tx<{ id: string; content: string }[]>`
          with pins as (
            select count(*)::int as n from agent_memory_items
            where scope in ('workspace', 'segment') and pinned
          )
          delete from agent_memory_items
          where id in (
            select id from agent_memory_items
            where scope in ('workspace', 'segment') and not pinned
            order by updated_at desc, id asc
            offset (select greatest(0, ${LEARNINGS_CAP} - n) from pins)
          )
          returning id, content
        `
      : await tx<{ id: string; content: string }[]>`
          with pins as (
            select count(*)::int as n from agent_memory_items
            where scope = 'debrief' and pinned
          )
          delete from agent_memory_items
          where id in (
            select id from agent_memory_items
            where scope = 'debrief' and not pinned
            order by created_at desc, id asc
            offset (select greatest(0, ${DEBRIEFS_CAP} - n) from pins)
          )
          returning id, content
        `;
  return rows;
}

/** Shared insert + dedupe + cap for learnings and debriefs. */
export async function rememberTx(
  tx: Sql,
  input: {
    scope: MemoryScope;
    segment?: string | null;
    content: string;
    source: MemorySource;
    sourceRunId?: string | null;
  },
): Promise<{ item: MemoryItem; evicted: string[] }> {
  const scope = checkScope(input.scope);
  const segment = checkSegment(scope, input.segment);
  const content = checkContent(input.content);
  if (!(MEMORY_SOURCES as readonly string[]).includes(input.source)) {
    throw bad('source', 'must be agent|staff|debrief');
  }
  const sourceRunId = checkSourceRunId(input.sourceRunId);
  if (sourceRunId) {
    const run = await tx<{ id: string }[]>`select id from agent_runs where id = ${sourceRunId}`;
    if (!run.length) {
      throw new HttpError(422, 'SOURCE_RUN_NOT_FOUND', 'sourceRunId has no agent_runs row', {
        field: 'sourceRunId',
      });
    }
  }
  // Serialize writers: concurrent remembers must see each other's committed
  // row before computing cap eviction or two txs could each keep an
  // over-cap set (the old settings-row FOR UPDATE had the same job).
  await tx`select pg_advisory_xact_lock(hashtext('vendua.agent_memory'))`;
  // clock_timestamp() (not now()): this tx may have started BEFORE waiting on
  // the lock — a tx-start stamp would sort the new row behind the previous
  // winner's commits and eviction could delete the row being written.
  const rows = await tx<MemoryItemRow[]>`
    insert into agent_memory_items (scope, segment, content, source, source_run_id, created_at, updated_at)
    values (${scope}, ${segment}, ${content}, ${input.source}, ${sourceRunId}, clock_timestamp(), clock_timestamp())
    on conflict (scope, (coalesce(segment, '')), (lower(content)))
    do update set
      updated_at = clock_timestamp(),
      -- Debriefs are an append log: a repeat means THIS run produced it —
      -- restamp created_at (feeds and eviction order by it) and point at
      -- the new run. Learnings keep their original created_at.
      created_at = case
        when agent_memory_items.scope = 'debrief' then clock_timestamp()
        else agent_memory_items.created_at
      end,
      source_run_id = case
        when agent_memory_items.scope = 'debrief' then excluded.source_run_id
        else agent_memory_items.source_run_id
      end
    returning *
  `;
  const evicted = await enforceMemoryCapTx(tx, scope === 'debrief' ? 'debrief' : 'learning');
  // Fully-pinned class: every unpinned row gets evicted — including the one
  // just written. Roll back (this throw undoes the insert AND the evictions)
  // rather than return a phantom item the next read can't find.
  if (evicted.some((r) => r.id === rows[0]!.id)) {
    throw new HttpError(
      422,
      'MEMORY_CAP_PINNED',
      `all ${scope === 'debrief' ? DEBRIEFS_CAP : LEARNINGS_CAP} ${scope === 'debrief' ? 'debriefs' : 'learnings'} are pinned — unpin one to make room`,
      { field: 'pinned' },
    );
  }
  return { item: memoryItemJson(rows[0]!), evicted: evicted.map((r) => r.content) };
}

/** Discovery debrief line (the runner's writeDebrief successor): own scope,
 *  own cap — appended under the same dedupe/eviction rules as learnings.
 *  `segment` tags the run's niche so the feed ranks segment-matched debriefs
 *  first (same normalization as segment learnings). */
export async function appendDebriefTx(
  tx: Sql,
  input: { content: string; sourceRunId?: string | null; segment?: string | null },
): Promise<{ item: MemoryItem; evicted: string[] }> {
  return rememberTx(tx, {
    scope: 'debrief',
    segment: input.segment ?? null,
    content: input.content,
    source: 'debrief',
    sourceRunId: input.sourceRunId ?? null,
  });
}

/** The run's memory feed (runner system prompt): pinned first, then
 *  segment-matched learnings, then workspace learnings by recency/uses,
 *  then the latest debriefs (segment-matched first). Returned learnings
 *  get their `uses` bumped — proven knowledge keeps surfacing. */
export async function memoryForRunTx(
  tx: Sql,
  opts: { segment?: string | null; limit?: number } = {},
): Promise<string[]> {
  const seg =
    typeof opts.segment === 'string' && opts.segment.trim()
      ? opts.segment.trim().toLowerCase()
      : null;
  const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? 60), 260));
  // Bucket order: pinned of any scope (0) → segment-matched learnings (1)
  // → workspace learnings (2) → latest debriefs (3, capped at DEBRIEF_FEED,
  // segment-matched first). rn ranks inside each bucket: learnings by
  // recency/uses, debriefs by match then recency.
  const rows = await tx<{ id: string; content: string; learning: boolean }[]>`
    with feed as (
      select id, content, scope, segment, updated_at, uses, created_at,
             case when pinned then 0
                  when scope = 'segment' and segment = ${seg} then 1
                  when scope = 'workspace' then 2
                  else 3 end as grp
      from agent_memory_items
      where pinned
         or scope = 'workspace'
         or (scope = 'segment' and segment = ${seg})
         or (scope = 'debrief' and not pinned)
    ),
    picked as (
      select *,
             case when grp = 3
                  then row_number() over w_debrief
                  else row_number() over w_learning
             end as rn
      from feed
      window
        w_debrief as (partition by (grp = 3)
                      order by (segment is not null and segment = ${seg}) desc, created_at desc),
        w_learning as (partition by (grp < 3) order by updated_at desc, uses desc)
    )
    select id, content, scope <> 'debrief' as learning from picked
    where grp < 3 or rn <= ${DEBRIEF_FEED}
    order by grp, rn
    limit ${limit}
  `;
  const learningIds = rows.filter((r) => r.learning).map((r) => r.id);
  if (learningIds.length) {
    await tx`update agent_memory_items set uses = uses + 1 where id = any(${learningIds}::uuid[])`;
  }
  return rows.map((r) => r.content);
}

/** Structured per-lead facts — the agent's keyed dossier memory.
 *  `order: 'key'` for the staff listing (stable alphabetical); 'recent' for
 *  the prompt read — a bounded feed must prefer the freshest facts, or a
 *  late-sorting key past the bound never reaches the agent. */
export async function leadFactsTx(
  tx: Sql,
  leadId: string,
  opts: { limit?: number; order?: 'key' | 'recent' } = {},
): Promise<LeadFact[]> {
  const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? 200), 1000));
  const rows =
    opts.order === 'recent'
      ? await tx<LeadFactRow[]>`
          select * from lead_facts where lead_id = ${leadId}
          order by updated_at desc, key limit ${limit}
        `
      : await tx<LeadFactRow[]>`
          select * from lead_facts where lead_id = ${leadId} order by key limit ${limit}
        `;
  return rows.map(leadFactJson);
}

export async function upsertLeadFactTx(
  tx: Sql,
  leadId: string,
  input: {
    key: string;
    value: string;
    confidence?: number;
    source: LeadFactSource;
    sourceRunId?: string | null;
  },
): Promise<LeadFact> {
  const key = input.key;
  if (typeof key !== 'string' || !LEAD_FACT_KEY_RE.test(key)) {
    throw bad('key', 'must be snake_case (^[a-z][a-z0-9_]{0,59}$)');
  }
  if (typeof input.value !== 'string' || !input.value.trim()) {
    throw bad('value', 'must be a non-empty string');
  }
  if (input.value.length > 500) throw bad('value', 'must be ≤500 chars');
  if (!(LEAD_FACT_SOURCES as readonly string[]).includes(input.source)) {
    throw bad('source', 'must be agent|staff');
  }
  const confidence = input.confidence ?? 1;
  if (
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw bad('confidence', 'must be a number in [0, 1]');
  }
  const sourceRunId = checkSourceRunId(input.sourceRunId);
  if (sourceRunId) {
    const run = await tx<{ id: string }[]>`select id from agent_runs where id = ${sourceRunId}`;
    if (!run.length) {
      throw new HttpError(422, 'SOURCE_RUN_NOT_FOUND', 'sourceRunId has no agent_runs row', {
        field: 'sourceRunId',
      });
    }
  }
  const rows = await tx<LeadFactRow[]>`
    insert into lead_facts (lead_id, key, value, confidence, source, source_run_id)
    values (${leadId}, ${key}, ${input.value}, ${confidence}, ${input.source}, ${sourceRunId})
    on conflict (lead_id, key)
    do update set value = excluded.value,
                  confidence = excluded.confidence,
                  source = excluded.source,
                  source_run_id = excluded.source_run_id,
                  updated_at = now()
    returning *
  `;
  return leadFactJson(rows[0]!);
}

// ---- route helpers (controlTx/claimControl wrappers used by app.ts) ------

export async function listMemoryItems(
  sql: Sql,
  q: { scope?: MemoryScope | null; segment?: string | null },
): Promise<MemoryItem[]> {
  const segment = q.segment?.trim().toLowerCase() || null;
  const rows = await controlTx(
    sql,
    (tx) => tx<MemoryItemRow[]>`
      select * from agent_memory_items
      where (${q.scope ?? null}::text is null or scope = ${q.scope ?? null})
        and (${segment}::text is null or segment = ${segment})
      order by pinned desc, created_at desc
    `,
  );
  return rows.map(memoryItemJson);
}

export async function createMemoryItem(
  sql: Sql,
  input: { scope: MemoryScope; segment?: string | null; content: string },
  idemKey: string,
): Promise<ClaimResult<{ item: MemoryItem; evicted: string[] }>> {
  return claimControl(sql, idemKey, async (tx) => {
    const { item, evicted } = await rememberTx(tx, { ...input, source: 'staff' });
    return { status: 200, body: { item, evicted } };
  });
}

export async function patchMemoryItem(
  sql: Sql,
  id: string,
  patch: { content?: string; pinned?: boolean },
  idemKey: string,
): Promise<ClaimResult<{ item: MemoryItem }>> {
  return claimControl(sql, idemKey, async (tx) => {
    const cur = (
      await tx<MemoryItemRow[]>`select * from agent_memory_items where id = ${id} for update`
    )[0];
    if (!cur) throw new HttpError(404, 'MEMORY_ITEM_NOT_FOUND', 'memory item not found');
    const set: Record<string, unknown> = {};
    if (patch.content !== undefined) set.content = checkContent(patch.content);
    if (patch.pinned !== undefined) set.pinned = patch.pinned;
    set.updated_at = new Date();
    let rows: MemoryItemRow[];
    try {
      rows = await tx<MemoryItemRow[]>`
        update agent_memory_items set ${tx(set)} where id = ${id} returning *
      `;
    } catch (e) {
      // A content edit that collides with another item's (scope, segment,
      // content) dedupe key must 4xx, not surface the 23505 as a 500.
      if ((e as { code?: string }).code === '23505') {
        throw bad('content', 'duplicates an existing memory item');
      }
      throw e;
    }
    return { status: 200, body: { item: memoryItemJson(rows[0]!) } };
  });
}

export async function deleteMemoryItem(
  sql: Sql,
  id: string,
  idemKey: string,
): Promise<ClaimResult<{ ok: true }>> {
  return claimControl(sql, idemKey, async (tx) => {
    const rows = await tx`delete from agent_memory_items where id = ${id} returning id`;
    if (!rows[0]) throw new HttpError(404, 'MEMORY_ITEM_NOT_FOUND', 'memory item not found');
    return { status: 200, body: { ok: true as const } };
  });
}

export async function listLeadFacts(sql: Sql, leadId: string): Promise<LeadFact[]> {
  return controlTx(sql, async (tx) => {
    const lead = (await tx`select id from leads where id = ${leadId}`)[0];
    if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    return leadFactsTx(tx, leadId);
  });
}

export async function putLeadFact(
  sql: Sql,
  leadId: string,
  key: string,
  input: { value: string; confidence?: number },
  idemKey: string,
): Promise<ClaimResult<{ fact: LeadFact }>> {
  const res = await claimControl(sql, idemKey, async (tx) => {
    const lead = (await tx`select id from leads where id = ${leadId}`)[0];
    if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    const fact = await upsertLeadFactTx(tx, leadId, { ...input, key, source: 'staff' });
    return { status: 200, body: { fact } };
  });
  if (!res.replayed) emitControlEvent('lead.change', leadId);
  return res;
}

export async function deleteLeadFact(
  sql: Sql,
  leadId: string,
  key: string,
  idemKey: string,
): Promise<ClaimResult<{ ok: true }>> {
  const res = await claimControl(sql, idemKey, async (tx) => {
    const rows = await tx`
      delete from lead_facts where lead_id = ${leadId} and key = ${key} returning key
    `;
    if (!rows[0]) {
      const lead = (await tx`select id from leads where id = ${leadId}`)[0];
      if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
      throw new HttpError(404, 'FACT_NOT_FOUND', 'lead fact not found');
    }
    return { status: 200, body: { ok: true as const } };
  });
  if (!res.replayed) emitControlEvent('lead.change', leadId);
  return res;
}
