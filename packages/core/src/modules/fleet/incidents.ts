import type { Sql } from '../../platform/db.ts';
import { log } from '../../platform/log.ts';
import type { FleetDeps } from './deps.ts';

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
  if (opened[0]) return opened[0];
  if (severity === 'critical')
    await tx`
      update fleet_incidents set severity = 'critical', summary = ${i.summary.slice(0, 300)},
        updated_at = now()
      where kind = ${i.kind} and subject = ${i.subject} and resolved_at is null
        and severity <> 'critical'
    `;
  return null;
}

export async function resolveIncidentTx(
  tx: Sql,
  kind: IncidentKind,
  subject: string,
  note?: string,
): Promise<IncidentRow | null> {
  return (
    (
      await tx<IncidentRow[]>`
        update fleet_incidents set resolved_at = now(), updated_at = now(),
          detail = detail || ${tx.json((note ? { resolution: note } : {}) as never)}
        where kind = ${kind} and subject = ${subject} and resolved_at is null
        returning *
      `
    )[0] ?? null
  );
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
