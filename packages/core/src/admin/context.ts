import type { Context, Hono } from 'hono';
import type { Geocoder } from '../modules/geocode.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import type { PaymentProvider } from '../modules/payments/provider.ts';
import type { SignupReadiness } from '../modules/billing/signup-gate.ts';
import type { DomainProviders } from '../modules/domains/providers.ts';
import type { FleetDeps } from '../modules/fleet/deps.ts';
import type { AdminHub } from './live.ts';

export type Role = 'owner' | 'manager' | 'attendant';
export const ROLES: readonly Role[] = ['owner', 'manager', 'attendant'];

export interface Merchant {
  userId: string;
  sessionId: string;
  name: string;
  phone: string;
  role: Role;
}

export type AdminVars = { tenant: Tenant; merchant: Merchant };
export type AdminApp = Hono<{ Variables: AdminVars }>;
export type AdminCtx = Context<{ Variables: AdminVars }>;

export interface AdminDeps {
  admin: AdminApp;
  sql: Sql;
  sessionSecret: string;
  hub: AdminHub;
  idempotency: (
    sql: Sql,
    run: (c: Context, tx: Sql) => Promise<{ status: number; body: unknown }>,
  ) => (c: Context) => Promise<Response>;
  /** fallback `<slug>.<storeDomain>` for storeOrigin — never build a store URL from it directly */
  storeDomain: string;
  provider: PaymentProvider;
  notify: MerchantNotify;
  /** `https://<admin host>` — OAuth redirects, webhook URLs and links in messages */
  publicOrigin: (c: Context) => string;
  /** address → approximate point, to place the store's pin (ADR 0024) */
  geocode: Geocoder;
  /** may a visitor sign up now (modules/billing/signup-gate.ts) */
  signupReady: () => Promise<SignupReadiness>;
  /** the registrar, DNS host and probes behind own domains (ADR 0038) */
  domains: DomainProviders;
  /** the Control Plane: Aparência's site switch moves the store between bundles (ADR 0040) */
  fleet: FleetDeps;
}

/** How a platform WhatsApp message rides the outbox once the number is on the gateway (ignored
 *  before the cutover, when it is sent at once). */
export interface WhatsAppNotifyOpts {
  /** default 'notice' */
  purpose?: 'otp' | 'notice';
  /** one per logical message, so a retried caller doesn't send it twice */
  dedupeKey?: string;
  /** wait this long for the gateway to send it; anything but sent throws */
  waitMs?: number;
}

/** Messages to store people (not shoppers) from the platform's own number and address. */
export interface MerchantNotify {
  whatsapp: (phone: string, text: string, opts?: WhatsAppNotifyOpts) => Promise<void>;
  email: (to: string, subject: string, text: string, idemKey: string) => Promise<void>;
}

const RANK: Record<Role, number> = { attendant: 1, manager: 2, owner: 3 };

/** 403 below the role — the UI hides what a role can't do, this is the real line. */
export function need(c: Context, role: Role): Merchant {
  const m = (c as AdminCtx).get('merchant');
  if (RANK[m.role] < RANK[role])
    throw new HttpError(403, 'FORBIDDEN', 'your role cannot do this', { need: role });
  return m;
}

export function roleAtLeast(role: Role, min: Role) {
  return RANK[role] >= RANK[min];
}

// ── input helpers (bounded, stable 4xx) ─────────────────────────────────────

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function int(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    throw new HttpError(422, 'BAD_REQUEST', `${name} must be an integer ${min}–${max}`, {
      field: name,
    });
  return v;
}

export function optInt(v: unknown, name: string, min: number, max: number) {
  return v === undefined ? undefined : v === null ? null : int(v, name, min, max);
}

export function text(v: unknown, name: string, max: number, min = 0): string {
  if (typeof v !== 'string')
    throw new HttpError(422, 'BAD_REQUEST', `${name} must be text`, { field: name });
  const t = v.trim();
  if (t.length < min || t.length > max)
    throw new HttpError(
      422,
      'BAD_REQUEST',
      min > 0 ? `${name} must have ${min}–${max} characters` : `${name} is too long (max ${max})`,
      { field: name },
    );
  return t;
}

export function optText(v: unknown, name: string, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = text(v, name, max);
  return t === '' ? null : t;
}

export function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean')
    throw new HttpError(422, 'BAD_REQUEST', `${name} must be true or false`, { field: name });
  return v;
}

export function oneOf<T extends string>(v: unknown, name: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T))
    throw new HttpError(422, 'BAD_REQUEST', `${name} must be one of ${allowed.join(', ')}`, {
      field: name,
    });
  return v as T;
}

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** A real calendar day: DATE_RE lets 2026-02-31 and year 0 through, and Postgres answers them
 *  with a 500. */
export function isDate(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    DATE_RE.test(v) &&
    v >= '0001-01-01' &&
    new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
  );
}

/** The one slug fold (store addresses and catalog handles): accents off, `&` read as "e",
 *  every other run of non-alphanumerics one dash, trimmed and capped at `max`. */
export function foldSlug(s: string, max: number): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** "slug-like" handle from a display name; accents folded, ≤ 60 chars. */
export function slugify(name: string): string {
  return foldSlug(name, 60) || 'item';
}
