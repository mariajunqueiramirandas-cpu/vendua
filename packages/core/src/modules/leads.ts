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

export async function listLeads(sql: Sql, state?: LeadState): Promise<LeadRow[]> {
  return state === undefined
    ? sql<LeadRow[]>`select * from leads order by created_at desc`
    : sql<LeadRow[]>`select * from leads where state = ${state} order by created_at desc`;
}

export async function getLead(sql: Sql, id: string): Promise<LeadRow | null> {
  const rows = await sql<LeadRow[]>`select * from leads where id = ${id}`;
  return rows[0] ?? null;
}

export async function createLead(
  sql: Sql,
  fields: Record<string, string | null>,
): Promise<LeadRow> {
  const rows = await sql<LeadRow[]>`insert into leads ${sql(fields)} returning *`;
  return rows[0]!;
}

export async function updateLead(
  sql: Sql,
  id: string,
  set: Record<string, string | null>,
): Promise<LeadRow | null> {
  const rows = await sql<LeadRow[]>`
    update leads set ${sql(set)}, updated_at = now() where id = ${id} returning *
  `;
  return rows[0] ?? null;
}

export async function appendNote(sql: Sql, id: string, body: string): Promise<LeadRow | null> {
  const note = { at: new Date().toISOString(), body };
  const rows = await sql<LeadRow[]>`
    update leads set notes = notes || ${sql.json([note])}, updated_at = now()
    where id = ${id} returning *
  `;
  return rows[0] ?? null;
}
