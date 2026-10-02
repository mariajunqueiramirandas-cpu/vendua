import type { Context, Hono } from 'hono';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { platformHost } from '../platform/store-origin.ts';
import { claimControl } from './control.ts';
import { recordStaffEventTx } from './staff-events.ts';

// Platform incidents: staff post "a Venduá está com instabilidade" from the CRM; every
// store's Ajuda reads it (GET /admin/v1/help/status), and so does status.vendua.com.br
// (GET /admin/v1/status, public — apps/status). Writes need vendua.control (RLS).

const SEVERITIES = ['info', 'degraded', 'outage'] as const;

const cols = (tx: Sql) => tx`
  id, title, body, severity, started_at as "startedAt", resolved_at as "resolvedAt"
`;

interface StatusRow {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  startedAt: Date;
  resolvedAt: Date | null;
}

function str(v: unknown, name: string, min: number, max: number): string {
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max)
    throw new HttpError(422, 'BAD_REQUEST', `${name} must have ${min}–${max} characters`, {
      field: name,
    });
  return v.trim();
}

function severity(v: unknown): (typeof SEVERITIES)[number] {
  if (typeof v !== 'string' || !(SEVERITIES as readonly string[]).includes(v))
    throw new HttpError(422, 'BAD_REQUEST', `severity must be one of ${SEVERITIES.join(', ')}`, {
      field: 'severity',
    });
  return v as (typeof SEVERITIES)[number];
}

/** Public, no session: open incidents plus the last 30 days' resolved ones, for the status page. */
export function publicIncidents(sql: Sql) {
  return sql`
    select ${cols(sql)} from platform_incidents
    where resolved_at is null or resolved_at > now() - interval '30 days'
    order by resolved_at is not null, started_at desc limit 50
  `;
}

/** Hosts the status page probes for "Lojas" and "Pedidos": the oldest active stores, so the
 *  probe follows the fleet instead of one tenant that can be renamed or deleted. */
export async function statusProbeHosts(sql: Sql, storeDomain: string, limit = 3) {
  const rows = await sql<{ slug: string }[]>`
    select slug from tenants where status = 'active' order by created_at, slug limit ${limit}
  `;
  return rows.map((r) => platformHost(r.slug, storeDomain));
}

/** control keys share one table across endpoints: scope ours to method + target */
function idemKey(c: Context, scope: string) {
  const key = c.req.header('idempotency-key');
  if (!key)
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  if (key.length > 120) throw new HttpError(400, 'BAD_REQUEST', 'Idempotency-Key too long');
  return `incidents:${scope}:${key}`;
}

export function mountIncidentsControl(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
}) {
  const { app, sql, controlGate } = o;

  app.get('/control/v1/incidents', async (c) => {
    controlGate(c);
    const incidents = await sql`
      select ${cols(sql)} from platform_incidents order by started_at desc, created_at desc limit 100
    `;
    c.header('cache-control', 'no-store');
    return c.json({ incidents });
  });

  app.post('/control/v1/incidents', async (c) => {
    controlGate(c);
    const key = idemKey(c, 'POST');
    const body = await bodyJson(c);
    const title = str(body.title, 'title', 3, 120);
    const text =
      body.body === undefined || body.body === null || body.body === ''
        ? null
        : str(body.body, 'body', 1, 1000);
    const sev = body.severity === undefined ? 'degraded' : severity(body.severity);
    const res = await claimControl(sql, key, async (tx) => {
      const incident = (
        await tx<StatusRow[]>`
          insert into platform_incidents (title, body, severity)
          values (${title}, ${text}, ${sev}) returning ${cols(tx)}
        `
      )[0]!;
      await recordStaffEventTx(tx, 'status.opened', {
        incidentId: incident.id,
        title: incident.title,
        severity: incident.severity,
        body: incident.body,
      });
      return { status: 201, body: { incident } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body, res.status as 201);
  });

  app.patch('/control/v1/incidents/:id', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const key = idemKey(c, `PATCH:${id}`);
    const body = await bodyJson(c);
    const set: Record<string, unknown> = {};
    if (body.title !== undefined) set.title = str(body.title, 'title', 3, 120);
    if (body.body !== undefined)
      set.body = body.body === null || body.body === '' ? null : str(body.body, 'body', 1, 1000);
    if (body.severity !== undefined) set.severity = severity(body.severity);
    if (body.resolved !== undefined && body.resolved !== true)
      throw new HttpError(422, 'BAD_REQUEST', 'resolved can only be true', { field: 'resolved' });
    if (!Object.keys(set).length && body.resolved !== true)
      throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
    const res = await claimControl(sql, key, async (tx) => {
      const before = (
        await tx<StatusRow[]>`
          select ${cols(tx)} from platform_incidents where id = ${id} for update
        `
      )[0];
      if (!before) throw new HttpError(404, 'INCIDENT_NOT_FOUND', 'incident not found');
      const row = (
        await tx<StatusRow[]>`
          update platform_incidents set
            title = ${set.title === undefined ? tx`title` : (set.title as string)},
            body = ${set.body === undefined ? tx`body` : (set.body as string | null)},
            severity = ${set.severity === undefined ? tx`severity` : (set.severity as string)},
            resolved_at = ${body.resolved === true ? tx`coalesce(resolved_at, now())` : tx`resolved_at`},
            updated_at = now()
          where id = ${id} returning ${cols(tx)}
        `
      )[0]!;
      const resolved = before.resolvedAt === null && row.resolvedAt !== null;
      if (
        resolved ||
        row.title !== before.title ||
        row.body !== before.body ||
        row.severity !== before.severity
      )
        await recordStaffEventTx(tx, 'status.updated', {
          incidentId: row.id,
          title: row.title,
          severity: row.severity,
          resolved,
        });
      return { status: 200, body: { incident: row } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body, res.status as 200);
  });
}
