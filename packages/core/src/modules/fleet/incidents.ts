import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import { claimControl, type ClaimResult } from '../control.ts';
import { emitControlEvent } from '../control-events.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import { storeNameTx, type FleetDeps } from './deps.ts';

// Operations incidents (docs/architecture/16): one open row per (kind, subject), so a probe that
// keeps failing is one incident and one staff alert, not one per minute. Distinct from
// platform_incidents, which is what merchants read in Ajuda.

export const fleetLog = log.child({ mod: 'fleet' });

export type IncidentKind =
  'probe_failing' | 'deployment_failed' | 'provisioning_stuck' | 'fleet_degraded';

export interface IncidentRow {
  id: string;
  tenant_id: string | null;
  kind: IncidentKind;
  severity: 'warning' | 'critical';
  subject: string;
  summary: string;
  detail: Record<string, unknown>;
  opened_at: Date;
  acked_at: Date | null;
  resolved_at: Date | null;
}

/** Opens the incident unless one is already open; returns it only when newly opened
 *  (the caller alerts after commit). A worse severity upgrades the open one. */
export async function openIncidentTx(
  tx: Sql,
  i: {
    tenantId: string | null;
    kind: IncidentKind;
    subject: string;
    summary: string;
    severity?: 'warning' | 'critical';
    detail?: Record<string, unknown>;
  },
): Promise<IncidentRow | null> {
  const severity = i.severity ?? 'warning';
  const opened = await tx<IncidentRow[]>`
    insert into fleet_incidents (tenant_id, kind, severity, subject, summary, detail)
    values (${i.tenantId}, ${i.kind}, ${severity}, ${i.subject.slice(0, 260)},
            ${i.summary.slice(0, 300)}, ${tx.json((i.detail ?? {}) as never)})
    on conflict (kind, subject) where resolved_at is null do nothing
    returning *
  `;
  if (opened[0]) {
    const row = opened[0];
    await recordStaffEventTx(
      tx,
      'incident.opened',
      {
        incidentId: row.id,
        kind: row.kind,
        severity: row.severity,
        subject: row.subject,
        summary: row.summary,
        storeName: row.tenant_id ? await storeNameTx(tx, row.tenant_id) : null,
      },
      { tenantId: row.tenant_id },
    );
    return row;
  }
  if (severity === 'critical') {
    const escalated = await tx<{ id: string; tenant_id: string | null }[]>`
      update fleet_incidents set severity = 'critical', summary = ${i.summary.slice(0, 300)},
        updated_at = now()
      where kind = ${i.kind} and subject = ${i.subject} and resolved_at is null
        and severity <> 'critical'
      returning id, tenant_id
    `;
    if (escalated[0])
      await recordStaffEventTx(
        tx,
        'incident.updated',
        {
          incidentId: escalated[0].id,
          change: 'escalated',
          by: null,
          summary: i.summary.slice(0, 300),
        },
        { tenantId: escalated[0].tenant_id, dedupeKey: `incident:${escalated[0].id}:escalated` },
      );
  }
  return null;
}

export async function resolveIncidentTx(
  tx: Sql,
  kind: IncidentKind,
  subject: string,
  note?: string,
): Promise<IncidentRow | null> {
  const row =
    (
      await tx<IncidentRow[]>`
        update fleet_incidents set resolved_at = now(), updated_at = now(),
          detail = detail || ${tx.json((note ? { resolution: note } : {}) as never)}
        where kind = ${kind} and subject = ${subject} and resolved_at is null
        returning *
      `
    )[0] ?? null;
  if (row)
    await recordStaffEventTx(
      tx,
      'incident.updated',
      { incidentId: row.id, change: 'resolved', by: null, summary: note ?? null },
      { tenantId: row.tenant_id, dedupeKey: `incident:${row.id}:resolved` },
    );
  return row;
}

/** Staff ack or resolve: the CRM's PATCH and Discord's buttons. One claim per key, so a replay
 *  changes nothing and records nothing. */
export async function ackIncident(
  sql: Sql,
  id: string,
  op: { ack?: true; resolved?: true },
  by: string,
  idemKey: string,
): Promise<ClaimResult<{ incident: ReturnType<typeof incidentJson> }>> {
  if (op.ack !== true && op.resolved !== true)
    throw new HttpError(422, 'BAD_REQUEST', 'send ack: true or resolved: true');
  const res = await claimControl(sql, idemKey, async (tx) => {
    const before = (
      await tx<{ acked: boolean; resolved: boolean }[]>`
        select acked_at is not null as acked, resolved_at is not null as resolved
        from fleet_incidents where id = ${id} for update
      `
    )[0];
    const row = (
      await tx<IncidentRow[]>`
        update fleet_incidents set
          acked_at = coalesce(acked_at, now()),
          resolved_at = ${op.resolved === true ? tx`coalesce(resolved_at, now())` : tx`resolved_at`},
          updated_at = now()
        where id = ${id} returning *
      `
    )[0];
    if (!row || !before) throw new HttpError(404, 'INCIDENT_NOT_FOUND', 'incident not found');
    // acking a closed incident changes nothing anyone needs to hear about
    const change =
      op.resolved === true && !before.resolved
        ? 'resolved'
        : !before.acked && !before.resolved
          ? 'acked'
          : null;
    if (change)
      await recordStaffEventTx(
        tx,
        'incident.updated',
        { incidentId: row.id, change, by, summary: null },
        { tenantId: row.tenant_id, dedupeKey: `incident:${row.id}:${change}` },
      );
    return { status: 200, body: { incident: incidentJson(row) } };
  });
  if (!res.replayed) emitControlEvent('fleet.change');
  return res;
}

/** Staff alert for a newly opened (or resolved) incident. Never throws. */
export function alertStaff(d: FleetDeps, row: IncidentRow, resolved = false) {
  const subject = resolved
    ? `Resolvido: ${row.summary}`
    : `${row.severity === 'critical' ? 'Crítico' : 'Atenção'}: ${row.summary}`;
  const body = resolved
    ? 'O Control Plane viu a loja voltar ao normal. Nada a fazer.'
    : `${row.summary}\n\nVeja em Lojas → frota no CRM.`;
  void d
    .staff({ subject, body, idemKey: `fleet:${row.id}:${resolved ? 'resolved' : 'opened'}` })
    .catch((err) => fleetLog.warn({ err, incident: row.id }, 'staff alert failed'));
}

export function incidentJson(r: IncidentRow & { tenant_slug?: string | null }) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    tenant: r.tenant_slug ?? null,
    kind: r.kind,
    severity: r.severity,
    subject: r.subject,
    summary: r.summary,
    detail: r.detail,
    openedAt: r.opened_at,
    ackedAt: r.acked_at,
    resolvedAt: r.resolved_at,
  };
}
