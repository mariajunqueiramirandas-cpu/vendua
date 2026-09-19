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
  /** Idempotency-Key the note was appended under — retries dedupe on it. */
  key?: string;
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
  idempotency_key: string | null;
  /** PATCH Idempotency-Keys already applied — bounded to the last 25 so the
   *  row stays small; a replay older than that just writes again (convergent
   *  by then). */
  mutation_keys: string[] | null;
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

export async function listLeads(sql: Sql, state?: LeadState): Promise<LeadRow[]> {
  return state === undefined
    ? sql<LeadRow[]>`select * from leads order by created_at desc`
    : sql<LeadRow[]>`select * from leads where state = ${state} order by created_at desc`;
}

export async function getLead(sql: Sql, id: string): Promise<LeadRow | null> {
  const rows = await sql<LeadRow[]>`select * from leads where id = ${id}`;
  return rows[0] ?? null;
}

/** Notes cap per lead — bounds both the jsonb row and every /leads response. */
export const MAX_NOTES_PER_LEAD = 500;

/** Insert claimed by the caller's Idempotency-Key: a retry lands on
 *  `on conflict do nothing` and replays the row the first write created. */
export async function createLead(
  sql: Sql,
  fields: Record<string, string | null>,
  idemKey: string,
): Promise<{ lead: LeadRow; replayed: boolean }> {
  const rows = await sql<LeadRow[]>`
    insert into leads ${sql({ ...fields, idempotency_key: idemKey })}
    on conflict (idempotency_key) do nothing
    returning *
  `;
  if (rows[0]) return { lead: rows[0], replayed: false };
  const existing = await sql<LeadRow[]>`select * from leads where idempotency_key = ${idemKey}`;
  return { lead: existing[0]!, replayed: true };
}

// PATCH keys claimed so far — a retry replays the stored row instead of
// writing again (and churning updated_at). The set converges anyway; the
// claim makes the response identical, matching the platform idempotency rule.
const MAX_MUTATION_KEYS = 25;

export async function updateLead(
  sql: Sql,
  id: string,
  set: Record<string, string | null>,
  idemKey: string,
): Promise<{ lead: LeadRow; replayed: boolean } | null> {
  return sql.begin(async (t) => {
    const tx = t as unknown as Sql;
    const cur = (await tx<LeadRow[]>`select * from leads where id = ${id} for update`)[0];
    if (!cur) return null;
    if ((cur.mutation_keys ?? []).includes(idemKey)) {
      return { lead: cur, replayed: true };
    }
    const keys = [...(cur.mutation_keys ?? []), idemKey].slice(-MAX_MUTATION_KEYS);
    const rows = await tx<LeadRow[]>`
      update leads set ${sql(set)}, updated_at = now(), mutation_keys = ${tx.json(keys)}
      where id = ${id} returning *
    `;
    return { lead: rows[0]!, replayed: false };
  }) as Promise<{ lead: LeadRow; replayed: boolean } | null>;
}

/** Appends under the caller's Idempotency-Key, stored inside the note: a
 *  retry sees its key already in notes[] and replays instead of appending a
 *  second copy. `for update` serializes concurrent appends on the row. */
export async function appendNote(
  sql: Sql,
  id: string,
  body: string,
  idemKey: string,
): Promise<{ lead: LeadRow; replayed: boolean } | null> {
  return sql.begin(async (t) => {
    const tx = t as unknown as Sql;
    const cur = (await tx<LeadRow[]>`select * from leads where id = ${id} for update`)[0];
    if (!cur) return null;
    if ((cur.notes ?? []).some((n) => n.key === idemKey)) {
      return { lead: cur, replayed: true };
    }
    if ((cur.notes ?? []).length >= MAX_NOTES_PER_LEAD) {
      throw new HttpError(
        422,
        'NOTE_LIMIT',
        `lead already has ${MAX_NOTES_PER_LEAD} notes — archive history before adding more`,
      );
    }
    // Inferred literal (not the LeadNote interface) so the object satisfies
    // tx.json's JSONValue/index-signature parameter type.
    const note = { at: new Date().toISOString(), body, key: idemKey };
    const rows = await tx<LeadRow[]>`
      update leads set notes = notes || ${tx.json([note])}, updated_at = now()
      where id = ${id} returning *
    `;
    return { lead: rows[0]!, replayed: false };
  }) as Promise<{ lead: LeadRow; replayed: boolean } | null>;
}
