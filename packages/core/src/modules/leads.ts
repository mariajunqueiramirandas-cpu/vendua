import type { Sql } from '../platform/db.ts';
import { HttpError, str } from '../platform/http.ts';

/**
 * leads module — Founder CRM v0 (docs/roadmap.md, Phase 1): Venduá's own
 * merchant-intake pipeline. `leads` is platform data, not tenant data — every
 * query runs without a tenant context and the /control/v1 gate is the only
 * access boundary. Phase 4 folds these states into the Control Plane's
 * provisioner.
 */

export const LEAD_STATES = ['lead', 'contacted', 'invited', 'live'] as const;
export type LeadState = (typeof LEAD_STATES)[number];

export interface LeadNote {
  at: string;
  body: string;
}

export interface LeadRow {
  id: string;
  name: string;
  business_name: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  city: string | null;
  source: string | null;
  state: LeadState;
  notes: LeadNote[] | null;
  created_at: string;
  updated_at: string;
}

/** camelCase API view — the contract shape the board and callers see. */
export interface Lead {
  id: string;
  name: string;
  businessName: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  city: string | null;
  source: string | null;
  state: LeadState;
  notes: LeadNote[];
  createdAt: string;
  updatedAt: string;
}

export function leadJson(row: LeadRow): Lead {
  return {
    id: row.id,
    name: row.name,
    businessName: row.business_name,
    phone: row.phone,
    email: row.email,
    instagram: row.instagram,
    city: row.city,
    source: row.source,
    state: row.state,
    notes: row.notes ?? [],
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

// API field → [column, max chars]. `name` is the only required field.
const LEAD_TEXT_FIELDS = {
  name: ['name', 200],
  businessName: ['business_name', 200],
  phone: ['phone', 60],
  email: ['email', 200],
  instagram: ['instagram', 100],
  city: ['city', 120],
  source: ['source', 100],
} as const;

type LeadTextField = keyof typeof LEAD_TEXT_FIELDS;

/** Create payload → column map. name required, the rest optional (→ null). */
export function leadInsert(body: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const field of Object.keys(LEAD_TEXT_FIELDS) as LeadTextField[]) {
    const [col, max] = LEAD_TEXT_FIELDS[field];
    const v = body[field];
    out[col] = v === undefined || v === null ? null : str(v, field, max);
  }
  if (!out.name?.trim()) {
    throw new HttpError(422, 'INVALID_LEAD', 'name is required', { field: 'name' });
  }
  return out;
}

/** Patch payload → column map. Absent keys are skipped; explicit null clears. */
export function leadPatch(body: Record<string, unknown>): Record<string, string | null> {
  const set: Record<string, string | null> = {};
  for (const field of Object.keys(LEAD_TEXT_FIELDS) as LeadTextField[]) {
    if (!(field in body)) continue;
    const [col, max] = LEAD_TEXT_FIELDS[field];
    const v = body[field];
    set[col] = v === null ? null : str(v, field, max);
  }
  if ('name' in set && !set.name?.trim()) {
    throw new HttpError(422, 'INVALID_LEAD', 'name cannot be empty', { field: 'name' });
  }
  if ('state' in body) set.state = leadState(body.state);
  if (Object.keys(set).length === 0) {
    throw new HttpError(422, 'BAD_REQUEST', 'no updatable fields in body');
  }
  return set;
}

/** Every control-plane query runs inside a transaction with the
 *  `vendua.control` GUC set — the leads / control_idempotency_keys RLS
 *  policies require it, so tenant-path code running as the same vendua_app
 *  role can never touch CRM tables. */
function controlTx<T>(sql: Sql, work: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (t) => {
    const tx = t as unknown as Sql;
    await tx`select set_config('vendua.control', '1', true)`;
    return work(tx);
  }) as Promise<T>;
}

export async function listLeads(sql: Sql, state?: LeadState): Promise<LeadRow[]> {
  return controlTx(sql, (tx) =>
    state === undefined
      ? tx<LeadRow[]>`select * from leads order by created_at desc`
      : tx<LeadRow[]>`select * from leads where state = ${state} order by created_at desc`,
  );
}

export async function getLead(sql: Sql, id: string): Promise<LeadRow | null> {
  return controlTx(sql, async (tx) => {
    const rows = await tx<LeadRow[]>`select * from leads where id = ${id}`;
    return rows[0] ?? null;
  });
}

/** Notes cap per lead — bounds both the jsonb row and every /leads response. */
export const MAX_NOTES_PER_LEAD = 500;

export interface ClaimResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/** Durable Idempotency-Key claim for control mutations — the platform
 *  counterpart of the tenant-scoped `idempotency()` wrapper (leads has no
 *  tenant FK for that table's composite key). The first execution runs `work`
 *  in the claim transaction and stores its status+body; every retry replays
 *  that stored response. Claims are never evicted — a replay can never
 *  re-apply — and a concurrent same-key request blocks on the row's write
 *  lock until the winner commits. If `work` throws (e.g. LEAD_NOT_FOUND) the
 *  claim rolls back with it, so errors are re-evaluated, never replayed. */
async function claimControl<T>(
  sql: Sql,
  key: string,
  work: (tx: Sql) => Promise<{ status: number; body: T }>,
): Promise<ClaimResult<T>> {
  return controlTx(sql, async (tx) => {
    const claimed = await tx`
      insert into control_idempotency_keys (key) values (${key})
      on conflict (key) do nothing
      returning key
    `;
    if (!claimed[0]) {
      const row = (
        await tx<{ response: T; status_code: number }[]>`
          select response, status_code from control_idempotency_keys where key = ${key}
        `
      )[0]!;
      return { status: row.status_code, body: row.response, replayed: true };
    }
    const res = await work(tx);
    await tx`
      update control_idempotency_keys
      set response = ${tx.json(res.body as never)}, status_code = ${res.status}
      where key = ${key}
    `;
    return { ...res, replayed: false };
  });
}

export async function createLead(
  sql: Sql,
  fields: Record<string, string | null>,
  idemKey: string,
): Promise<ClaimResult<{ lead: Lead }>> {
  return claimControl(sql, idemKey, async (tx) => {
    const rows = await tx<LeadRow[]>`insert into leads ${tx(fields)} returning *`;
    return { status: 201, body: { lead: leadJson(rows[0]!) } };
  });
}

export async function updateLead(
  sql: Sql,
  id: string,
  set: Record<string, string | null>,
  idemKey: string,
): Promise<ClaimResult<{ lead: Lead }>> {
  return claimControl(sql, idemKey, async (tx) => {
    const rows = await tx<LeadRow[]>`
      update leads set ${tx(set)}, updated_at = now() where id = ${id} returning *
    `;
    if (!rows[0]) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    return { status: 200, body: { lead: leadJson(rows[0]) } };
  });
}

/** Appends under the caller's Idempotency-Key claim; `for update` serializes
 *  concurrent appends on the row. */
export async function appendNote(
  sql: Sql,
  id: string,
  body: string,
  idemKey: string,
): Promise<ClaimResult<{ lead: Lead }>> {
  return claimControl(sql, idemKey, async (tx) => {
    const cur = (await tx<LeadRow[]>`select * from leads where id = ${id} for update`)[0];
    if (!cur) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    if ((cur.notes ?? []).length >= MAX_NOTES_PER_LEAD) {
      throw new HttpError(
        422,
        'NOTE_LIMIT',
        `lead already has ${MAX_NOTES_PER_LEAD} notes — archive history before adding more`,
      );
    }
    const note = { at: new Date().toISOString(), body };
    const rows = await tx<LeadRow[]>`
      update leads set notes = notes || ${tx.json([note])}, updated_at = now()
      where id = ${id} returning *
    `;
    return { status: 200, body: { lead: leadJson(rows[0]!) } };
  });
}
