import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import { DEFAULT_BUNDLE, storeNameTx, type FleetDeps } from './deps.ts';
import { openIncidentTx, type IncidentRow } from './incidents.ts';
import { latestPassedTx, type ReleaseRow } from './releases.ts';

// Deployment = a pointer flip (ADR 0003): one tx writes the deployment row and moves
// storefront_ops.live_release_id. The edge follows within its route TTL; a probe that sees the
// edge serve the new release marks the deployment live (probe.ts).

export interface OpsRow {
  tenant_id: string;
  ring: string;
  bundle: string;
  bundle_locked: boolean;
  release_policy: 'auto' | 'pinned';
  pinned_reason: string | null;
  live_release_id: string | null;
  live_since: Date | null;
}

export type DeploymentKind = 'promote' | 'rollback' | 'auto' | 'provision';
export type DeploymentStatus = 'pending' | 'live' | 'failed' | 'rolled_back' | 'superseded';

export interface DeploymentRow {
  id: string;
  tenant_id: string;
  release_id: string;
  previous_release_id: string | null;
  kind: DeploymentKind;
  status: DeploymentStatus;
  actor: string;
  reason: string | null;
  detail: string | null;
  started_at: Date;
  finished_at: Date | null;
}

/** a pending deployment no probe verified within this is failed (and rolled back) */
export const VERIFY_TIMEOUT_MS = 5 * 60_000;
/** failing probes in a row that fail a pending deployment early */
export const VERIFY_FAILURES = 3;

export async function lockOpsTx(tx: Sql, tenantId: string): Promise<OpsRow> {
  await tx`insert into storefront_ops (tenant_id) values (${tenantId}) on conflict do nothing`;
  return (
    await tx<OpsRow[]>`
      select tenant_id, ring, bundle, bundle_locked, release_policy, pinned_reason,
             live_release_id, live_since
      from storefront_ops where tenant_id = ${tenantId} for update
    `
  )[0]!;
}

export async function pendingTx(tx: Sql, tenantId: string): Promise<DeploymentRow | null> {
  return (
    (
      await tx<DeploymentRow[]>`
        select * from deployments where tenant_id = ${tenantId} and status = 'pending'
      `
    )[0] ?? null
  );
}

export async function promoteTx(
  tx: Sql,
  d: FleetDeps,
  tenantId: string,
  releaseId: string,
  o: {
    kind: DeploymentKind;
    actor: string;
    reason?: string | null;
    /** keep = leave the store's policy as it is */
    policy: 'auto' | 'pinned' | 'keep';
    pinnedReason?: string | null;
    force?: boolean;
  },
): Promise<DeploymentRow | null> {
  const ops = await lockOpsTx(tx, tenantId);
  const release = (await tx<ReleaseRow[]>`select * from releases where id = ${releaseId}`)[0];
  if (!release) throw new HttpError(404, 'RELEASE_NOT_FOUND', 'release not found');
  if (release.bundle !== ops.bundle)
    throw new HttpError(
      409,
      'RELEASE_WRONG_BUNDLE',
      `this store runs bundle ${ops.bundle}, the release is from ${release.bundle}`,
    );
  if (release.qa_status !== 'passed' && !o.force)
    throw new HttpError(409, 'RELEASE_QA_FAILED', 'this release failed its checks');

  const policy = o.policy === 'keep' ? ops.release_policy : o.policy;
  const pinnedReason = policy === 'pinned' ? (o.pinnedReason ?? ops.pinned_reason ?? null) : null;
  const pending = await pendingTx(tx, tenantId);
  if (ops.live_release_id === releaseId && !pending) {
    await tx`
      update storefront_ops set release_policy = ${policy}, pinned_reason = ${pinnedReason},
        updated_at = now()
      where tenant_id = ${tenantId}
    `;
    return null;
  }
  if (pending)
    await tx`
      update deployments set status = 'superseded', finished_at = now()
      where id = ${pending.id} and status = 'pending'
    `;
  // a release that was still pending never proved itself: what came before it is the fallback
  const previous = pending ? pending.previous_release_id : ops.live_release_id;
  const verified = !d.probes;
  const row = (
    await tx<DeploymentRow[]>`
      insert into deployments (tenant_id, release_id, previous_release_id, kind, status, actor,
                               reason, detail, finished_at)
      values (${tenantId}, ${releaseId}, ${previous}, ${o.kind},
              ${verified ? 'live' : 'pending'}, ${o.actor.slice(0, 80)},
              ${o.reason ? o.reason.slice(0, 300) : null},
              ${verified ? 'sondas desligadas: no ar ao trocar o ponteiro' : null},
              ${verified ? tx`now()` : null})
      returning *
    `
  )[0]!;
  await tx`
    update storefront_ops set live_release_id = ${releaseId}, live_since = now(),
      live_kernel_version = ${release.kernel_version},
      release_policy = ${policy}, pinned_reason = ${pinnedReason}, updated_at = now()
    where tenant_id = ${tenantId}
  `;
  // verify soon instead of at the next 60 s slot
  await tx`update fleet_probes set next_check_at = now() where tenant_id = ${tenantId}`;
  // only staff promote by hand; rollbackTx records its own
  if (o.kind === 'promote')
    await recordStaffEventTx(
      tx,
      'deployment.manual',
      {
        action: 'promote',
        storeName: (await storeNameTx(tx, tenantId)) ?? tenantId,
        releaseId,
        by: o.actor,
      },
      { tenantId },
    );
  return row;
}

/** The newest release of the store's current bundle that was live here, other than `not`: a
 *  release of a bundle the store left can't be promoted on it. */
async function earlierLiveTx(tx: Sql, ops: OpsRow, not: string): Promise<ReleaseRow | null> {
  return (
    (
      await tx<ReleaseRow[]>`
        select r.* from deployments d join releases r on r.id = d.release_id
        where d.tenant_id = ${ops.tenant_id} and d.status = 'live' and d.release_id <> ${not}
          and r.bundle = ${ops.bundle}
        order by d.started_at desc limit 1
      `
    )[0] ?? null
  );
}

/** Back to the newest release of its bundle this store had live before the current one; pins
 *  the store. */
export async function rollbackTx(
  tx: Sql,
  d: FleetDeps,
  tenantId: string,
  o: { actor: string; reason?: string | null },
): Promise<DeploymentRow> {
  const ops = await lockOpsTx(tx, tenantId);
  const current = ops.live_release_id;
  if (!current) throw new HttpError(409, 'NOTHING_TO_ROLL_BACK', 'this store has no release live');
  const target = (await earlierLiveTx(tx, ops, current))?.id;
  if (!target)
    throw new HttpError(
      409,
      'NO_PREVIOUS_RELEASE',
      `no earlier release of bundle ${ops.bundle} was ever live here`,
    );
  await tx`
    update deployments set status = 'rolled_back', finished_at = coalesce(finished_at, now())
    where tenant_id = ${tenantId} and release_id = ${current} and status in ('pending', 'live')
  `;
  const reason = o.reason?.trim() || 'voltou para a versão anterior';
  const dep = (await promoteTx(tx, d, tenantId, target, {
    kind: 'rollback',
    actor: o.actor,
    reason,
    policy: 'pinned',
    pinnedReason: reason,
    force: true,
  }))!;
  await recordStaffEventTx(
    tx,
    'deployment.manual',
    {
      action: 'rollback',
      storeName: (await storeNameTx(tx, tenantId)) ?? tenantId,
      releaseId: target,
      by: o.actor,
    },
    { tenantId },
  );
  return dep;
}

/** Desired vs live: an auto store runs its bundle's newest passed release. */
export async function reconcileTx(
  tx: Sql,
  d: FleetDeps,
  tenantId: string,
  o: { kind?: DeploymentKind; actor?: string } = {},
): Promise<DeploymentRow | null> {
  const ops = await lockOpsTx(tx, tenantId);
  if (ops.release_policy === 'pinned' && ops.live_release_id) return null;
  const desired = await latestPassedTx(tx, ops.bundle);
  if (!desired || desired.id === ops.live_release_id) return null;
  return promoteTx(tx, d, tenantId, desired.id, {
    kind: o.kind ?? 'auto',
    actor: o.actor ?? 'control-plane',
    reason: `nova versão publicada de ${ops.bundle}`,
    policy: 'keep',
  });
}

/** A bundle built for a store (storefronts/<slug>, tenant <slug>) becomes that store's bundle,
 *  unless staff chose one. The template's own tenant already runs it. Only a bundle named after
 *  its tenant: the manifest's tenant comes from the storefront's package.json, which that
 *  store's PR can rewrite to take over another store. */
export async function adoptBundleTx(tx: Sql, release: ReleaseRow): Promise<string | null> {
  if (release.bundle === DEFAULT_BUNDLE || release.bundle !== release.tenant_slug) return null;
  const hit = (
    await tx<{ tenant_id: string }[]>`
      update storefront_ops o set bundle = ${release.bundle}, updated_at = now()
      from tenants t
      where t.slug = ${release.tenant_slug} and o.tenant_id = t.id
        and o.bundle <> ${release.bundle} and not o.bundle_locked
      returning o.tenant_id
    `
  )[0];
  if (!hit) return null;
  // a pin on the old bundle's release means nothing on the new bundle
  await tx`
    update storefront_ops set release_policy = 'auto', pinned_reason = null
    where tenant_id = ${hit.tenant_id}
  `;
  return hit.tenant_id;
}

/** Every auto store on the bundle moves to its newest passed release. */
export async function reconcileBundleTx(
  tx: Sql,
  d: FleetDeps,
  bundle: string,
): Promise<{ tenantId: string; deployment: DeploymentRow }[]> {
  const ids = await tx<{ tenant_id: string }[]>`
    select tenant_id from storefront_ops where bundle = ${bundle} order by tenant_id
  `;
  const out: { tenantId: string; deployment: DeploymentRow }[] = [];
  for (const { tenant_id } of ids) {
    const dep = await reconcileTx(tx, d, tenant_id);
    if (dep) out.push({ tenantId: tenant_id, deployment: dep });
  }
  return out;
}

export async function markVerifiedTx(
  tx: Sql,
  tenantId: string,
  releaseSeen: string,
): Promise<DeploymentRow | null> {
  return (
    (
      await tx<DeploymentRow[]>`
        update deployments set status = 'live', finished_at = now(),
          detail = 'a sonda viu a versão no ar'
        where tenant_id = ${tenantId} and status = 'pending' and release_id = ${releaseSeen}
        returning *
      `
    )[0] ?? null
  );
}

/** A pending deployment that didn't verify: failed, and back to the previous release when
 *  there is one on the store's bundle. A rollback that fails isn't rolled back again: that
 *  would return to the release someone just moved off. Takes the store's ops lock first —
 *  the same order as a promotion — so the two never deadlock. */
export async function failDeploymentTx(
  tx: Sql,
  d: FleetDeps,
  dep: DeploymentRow,
  why: string,
): Promise<{ rollback: DeploymentRow | null; incident: IncidentRow | null }> {
  const ops = await lockOpsTx(tx, dep.tenant_id);
  const failed = await tx`
    update deployments set status = 'failed', finished_at = now(), detail = ${why.slice(0, 500)}
    where id = ${dep.id} and status = 'pending' returning id
  `;
  if (!failed[0]) return { rollback: null, incident: null };
  const store = (
    await tx<{ slug: string; name: string; host: string | null }[]>`
      select slug, name, (select host from domains where tenant_id = t.id
                          order by is_primary desc, length(host), host limit 1) as host
      from tenants t where id = ${dep.tenant_id}
    `
  )[0];
  const slug = store?.slug ?? dep.tenant_id;
  const before = dep.previous_release_id
    ? ((await tx<ReleaseRow[]>`select * from releases where id = ${dep.previous_release_id}`)[0] ??
      null)
    : null;
  // the release before this one may be of the bundle the store just left
  const previous =
    before?.bundle === ops.bundle ? before : await earlierLiveTx(tx, ops, dep.release_id);
  const canRollBack = previous !== null && dep.kind !== 'rollback';
  let rollback: DeploymentRow | null = null;
  if (canRollBack) {
    const reason = `a versão ${dep.release_id.slice(0, 7)} falhou: ${why}`.slice(0, 300);
    rollback = await promoteTx(tx, d, dep.tenant_id, previous.id, {
      kind: 'rollback',
      actor: 'control-plane',
      reason,
      policy: 'pinned',
      pinnedReason: reason,
      force: true,
    });
  }
  await recordStaffEventTx(
    tx,
    'deployment.failed',
    {
      deploymentId: dep.id,
      storeName: store?.name ?? slug,
      host: store?.host ?? null,
      releaseId: dep.release_id,
      rolledBackTo: canRollBack ? previous.id : null,
      reason: why,
    },
    { tenantId: dep.tenant_id, dedupeKey: `deployment:${dep.id}:failed` },
  );
  const incident = await openIncidentTx(tx, {
    tenantId: dep.tenant_id,
    kind: 'deployment_failed',
    subject: dep.id,
    severity: canRollBack ? 'warning' : 'critical',
    summary: canRollBack
      ? `${slug}: a versão ${dep.release_id.slice(0, 7)} falhou e a loja voltou para ${previous.id.slice(0, 7)}`
      : `${slug}: a versão ${dep.release_id.slice(0, 7)} não subiu e ficou no ar sem volta automática`,
    detail: { why, release: dep.release_id, previous: dep.previous_release_id },
  });
  return { rollback, incident };
}

export function deploymentJson(r: DeploymentRow) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    release: r.release_id,
    previousRelease: r.previous_release_id,
    kind: r.kind,
    status: r.status,
    actor: r.actor,
    reason: r.reason,
    detail: r.detail,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}
