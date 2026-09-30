import type { Sql } from '../../platform/db.ts';
import { isPublicHost } from '../../platform/store-origin.ts';
import { deploymentJson, type DeploymentRow } from './deploy.ts';
import { incidentJson, type IncidentRow } from './incidents.ts';
import type { ProbeRow } from './probe.ts';
import { provisioningJson, type ProvisioningRow } from './provision.ts';
import { releaseJson, type ReleaseRow } from './releases.ts';

// Read models for the CRM (Lojas → frota) and `vendua fleet`. Cross-store, under controlTx.

interface ListRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  created_at: Date;
  bundle: string;
  bundle_locked: boolean;
  ring: string;
  release_policy: 'auto' | 'pinned';
  pinned_reason: string | null;
  live_release_id: string | null;
  live_since: Date | null;
  loader_state: string;
  kernel_version: string | null;
  latest_release_id: string | null;
  hosts: string[] | null;
  probe_status: 'unknown' | 'ok' | 'failing' | null;
  probe_checked_at: Date | null;
  probe_error: string | null;
  probe_latency_ms: number | null;
  probe_release: string | null;
  dep_id: string | null;
  dep_status: string | null;
  dep_kind: string | null;
  dep_release: string | null;
  dep_started_at: Date | null;
  prov_id: string | null;
  prov_state: string | null;
  prov_error: string | null;
  incidents: number;
}

function primary(hosts: string[] | null): string | null {
  if (!hosts?.length) return null;
  return hosts.find(isPublicHost) ?? hosts[0]!;
}

function storefrontJson(r: ListRow) {
  return {
    tenantId: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    plan: r.plan,
    createdAt: r.created_at,
    bundle: r.bundle,
    bundleLocked: r.bundle_locked,
    ring: r.ring,
    policy: r.release_policy,
    pinnedReason: r.pinned_reason,
    maintenance: r.loader_state === 'maintenance',
    host: primary(r.hosts),
    hosts: r.hosts ?? [],
    live: r.live_release_id
      ? { release: r.live_release_id, kernelVersion: r.kernel_version, since: r.live_since }
      : null,
    latestRelease: r.latest_release_id,
    behind: r.latest_release_id !== null && r.latest_release_id !== r.live_release_id,
    probe: r.probe_status
      ? {
          status: r.probe_status,
          checkedAt: r.probe_checked_at,
          error: r.probe_error,
          latencyMs: r.probe_latency_ms,
          release: r.probe_release,
        }
      : null,
    deployment: r.dep_id
      ? {
          id: r.dep_id,
          status: r.dep_status,
          kind: r.dep_kind,
          release: r.dep_release,
          startedAt: r.dep_started_at,
        }
      : null,
    provisioning: r.prov_id
      ? { id: r.prov_id, state: r.prov_state, lastError: r.prov_error }
      : null,
    openIncidents: r.incidents,
  };
}

export type FleetStorefront = ReturnType<typeof storefrontJson>;

const listSql = (tx: Sql, where: ReturnType<Sql>) => tx<ListRow[]>`
  select t.id, t.slug, t.name, t.status, t.plan, t.created_at,
    coalesce(o.bundle, '_template') as bundle, coalesce(o.bundle_locked, false) as bundle_locked,
    coalesce(o.ring, 'stable') as ring, coalesce(o.release_policy, 'auto') as release_policy,
    o.pinned_reason, o.live_release_id, o.live_since, coalesce(o.loader_state, 'normal') as loader_state,
    r.kernel_version,
    (select id from releases lr where lr.bundle = coalesce(o.bundle, '_template')
       and lr.qa_status = 'passed' order by published_at desc, created_at desc limit 1)
      as latest_release_id,
    (select array_agg(host order by is_primary desc, length(host), host) from domains dm
       where dm.tenant_id = t.id) as hosts,
    p.status as probe_status, p.last_checked_at as probe_checked_at, p.last_error as probe_error,
    p.latency_ms as probe_latency_ms, p.last_release_id as probe_release,
    dp.id as dep_id, dp.status as dep_status, dp.kind as dep_kind, dp.release_id as dep_release,
    dp.started_at as dep_started_at,
    pv.id as prov_id, pv.state as prov_state, pv.last_error as prov_error,
    (select count(*)::int from fleet_incidents i where i.tenant_id = t.id and i.resolved_at is null)
      as incidents
  from tenants t
  left join storefront_ops o on o.tenant_id = t.id
  left join releases r on r.id = o.live_release_id
  left join lateral (
    select * from fleet_probes fp where fp.tenant_id = t.id
    order by (fp.status = 'failing') desc, (fp.status = 'unknown') desc, fp.host limit 1
  ) p on true
  left join lateral (
    select * from deployments d where d.tenant_id = t.id order by d.started_at desc limit 1
  ) dp on true
  left join provisionings pv on pv.tenant_id = t.id
  ${where}
`;

export async function listStorefrontsTx(tx: Sql) {
  const rows = await listSql(tx, tx`order by t.created_at desc limit 1000`);
  return rows.map(storefrontJson);
}

export async function storefrontDetailTx(tx: Sql, tenantId: string) {
  const row = (await listSql(tx, tx`where t.id = ${tenantId}`))[0];
  if (!row) return null;
  const base = storefrontJson(row);
  const [deployments, releases, probes, checks, incidents, provisioning] = await Promise.all([
    tx<(DeploymentRow & { kernel_version: string })[]>`
      select d.*, r.kernel_version from deployments d join releases r on r.id = d.release_id
      where d.tenant_id = ${tenantId} order by d.started_at desc limit 30
    `,
    tx<ReleaseRow[]>`
      select * from releases where bundle = ${base.bundle}
      order by published_at desc, created_at desc limit 20
    `,
    tx<ProbeRow[]>`select * from fleet_probes where tenant_id = ${tenantId} order by host`,
    tx<
      {
        id: number;
        host: string;
        at: Date;
        ok: boolean;
        latency_ms: number | null;
        release_id: string | null;
        checks: unknown;
      }[]
    >`
      select id, host, at, ok, latency_ms, release_id, checks from health_checks
      where tenant_id = ${tenantId} order by at desc limit 30
    `,
    tx<IncidentRow[]>`
      select * from fleet_incidents where tenant_id = ${tenantId}
      order by (resolved_at is null) desc, opened_at desc limit 20
    `,
    tx<ProvisioningRow[]>`select * from provisionings where tenant_id = ${tenantId}`,
  ]);
  return {
    ...base,
    deployments: deployments.map((d) => ({
      ...deploymentJson(d),
      kernelVersion: d.kernel_version,
    })),
    releases: releases.map(releaseJson),
    probes: probes.map((p) => ({
      host: p.host,
      status: p.status,
      failures: p.failures,
      failingSince: p.failing_since,
      checkedAt: p.last_checked_at,
      okAt: p.last_ok_at,
      error: p.last_error,
      release: p.last_release_id,
      latencyMs: p.latency_ms,
    })),
    healthChecks: checks.map((h) => ({
      id: String(h.id),
      host: h.host,
      at: h.at,
      ok: h.ok,
      latencyMs: h.latency_ms,
      release: h.release_id,
      checks: h.checks,
    })),
    incidents: incidents.map((i) => incidentJson(i)),
    provisioningDetail: provisioning[0] ? provisioningJson(provisioning[0]) : null,
  };
}

export async function fleetStatusTx(tx: Sql, probes: boolean) {
  const [counts, kernels, bundles, incidents] = await Promise.all([
    tx<
      {
        stores: number;
        live: number;
        pinned: number;
        maintenance: number;
        pending: number;
        probing: number;
        failing: number;
        provisioning: number;
      }[]
    >`
      select
        (select count(*)::int from tenants) as stores,
        (select count(*)::int from storefront_ops where live_release_id is not null) as live,
        (select count(*)::int from storefront_ops where release_policy = 'pinned') as pinned,
        (select count(*)::int from storefront_ops where loader_state = 'maintenance') as maintenance,
        (select count(*)::int from deployments where status = 'pending') as pending,
        (select count(*)::int from fleet_probes) as probing,
        (select count(*)::int from fleet_probes where status = 'failing') as failing,
        (select count(*)::int from provisionings where state <> 'live') as provisioning
    `,
    tx<{ kernel_version: string; stores: number }[]>`
      select r.kernel_version, count(*)::int as stores
      from storefront_ops o join releases r on r.id = o.live_release_id
      group by r.kernel_version order by r.kernel_version desc
    `,
    tx<
      {
        bundle: string;
        latest: string | null;
        kernel_version: string | null;
        published_at: Date | null;
        stores: number;
        behind: number;
      }[]
    >`
      with latest as (
        select distinct on (bundle) bundle, id, kernel_version, published_at from releases
        where qa_status = 'passed' order by bundle, published_at desc, created_at desc
      )
      select b.bundle, l.id as latest, l.kernel_version, l.published_at,
        (select count(*)::int from storefront_ops o where o.bundle = b.bundle) as stores,
        (select count(*)::int from storefront_ops o where o.bundle = b.bundle
           and o.live_release_id is distinct from l.id) as behind
      from (select bundle from releases union select bundle from storefront_ops) b
      left join latest l on l.bundle = b.bundle
      order by b.bundle
    `,
    tx<{ severity: string; n: number }[]>`
      select severity, count(*)::int as n from fleet_incidents where resolved_at is null
      group by severity
    `,
  ]);
  const c = counts[0]!;
  return {
    probes,
    stores: c.stores,
    live: c.live,
    pinned: c.pinned,
    maintenance: c.maintenance,
    pendingDeployments: c.pending,
    probedHosts: c.probing,
    failingHosts: c.failing,
    provisioning: c.provisioning,
    kernels: kernels.map((k) => ({ version: k.kernel_version, stores: k.stores })),
    bundles: bundles.map((b) => ({
      bundle: b.bundle,
      latestRelease: b.latest,
      kernelVersion: b.kernel_version,
      publishedAt: b.published_at,
      stores: b.stores,
      behind: b.behind,
    })),
    openIncidents: {
      warning: incidents.find((i) => i.severity === 'warning')?.n ?? 0,
      critical: incidents.find((i) => i.severity === 'critical')?.n ?? 0,
    },
  };
}
