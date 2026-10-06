import type { Context } from 'hono';
import { withTenant, type Sql } from '../platform/db.ts';
import { bodyJson, HttpError } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import {
  need,
  roleAtLeast,
  type AdminCtx,
  type AdminDeps,
  type Merchant,
  type Role,
} from './context.ts';

type Work<T> = (tx: Sql, tenant: Tenant, m: Merchant, c: Context) => Promise<T>;

/**
 * Routes Duá Copilot may run as functions (ADR 0034): the handler a screen calls, by name, so an
 * answer reads what the screen reads and a confirmed change goes through the route's own
 * validation, audit row and live update. Last mount wins: one admin app per process in
 * production; in tests every app mounts the same code.
 */
const ROUTES = new Map<string, { role: Role; fn: Work<unknown> }>();

/** What a replayed request carries instead of an HTTP request. */
export interface Replay {
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

const REPLAY = Symbol('replay');

function replayContext(r: Replay): Context {
  const req = {
    param: (k?: string) => (k === undefined ? { ...r.params } : r.params?.[k]),
    query: (k?: string) => (k === undefined ? { ...r.query } : r.query?.[k]),
  };
  return { req, [REPLAY]: r } as unknown as Context;
}

/** The request's JSON body, or a replay's: what a handler Copilot can run reads instead of bodyJson. */
export async function bodyOf(c: Context, max?: number): Promise<Record<string, unknown>> {
  const r = (c as unknown as { [REPLAY]?: Replay })[REPLAY];
  return r ? { ...r.body } : bodyJson(c, max);
}

/**
 * Runs a named route's handler inside `tx` (the caller's tenant transaction). A write's handler
 * does its own audit and `emitAdminTx`; the caller owns the claim and the commit.
 */
export async function runRoute(
  tx: Sql,
  name: string,
  t: Tenant,
  m: Merchant,
  r: Replay = {},
): Promise<unknown> {
  const route = ROUTES.get(name);
  if (!route) throw new Error(`no admin route named ${name}`);
  if (!roleAtLeast(m.role, route.role))
    throw new HttpError(403, 'FORBIDDEN', 'your role cannot do this', { need: route.role });
  return route.fn(tx, t, m, replayContext(r));
}

/** The role a named route needs. */
export function routeRole(name: string): Role | null {
  return ROUTES.get(name)?.role ?? null;
}

/**
 * read = role check + tenant tx; write = role check + idempotent claim in the tenant tx.
 * A `name` also lists the handler for Copilot (`runRoute`).
 */
export function handlers(d: AdminDeps) {
  const read = (role: Role, fn: Work<object>, name?: string) => {
    if (name) ROUTES.set(name, { role, fn });
    return async (c: AdminCtx): Promise<Response> => {
      const m = need(c, role);
      const t = c.get('tenant');
      const out = await withTenant(d.sql, t.id, (tx) => fn(tx, t, m, c));
      c.header('cache-control', 'no-store');
      return c.json(out);
    };
  };
  const write = (role: Role, fn: Work<{ status: number; body: unknown }>, name?: string) => {
    if (name) ROUTES.set(name, { role, fn });
    return async (c: AdminCtx): Promise<Response> => {
      const m = need(c, role);
      const t = c.get('tenant');
      return d.idempotency(d.sql, (c2, tx) => fn(tx, t, m, c2))(c);
    };
  };
  return { read, write };
}
