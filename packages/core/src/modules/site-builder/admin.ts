import { emitAdminTx } from '../../admin/live.ts';
import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { requireFeature } from '../billing/plans.ts';
import { validateSpec, type DesignSpec } from './spec.ts';
import { requestSiteTaskTx, type SiteSource, type SiteTaskDbRow } from './tasks.ts';

// The owner's two doors (admin routes site.build and site.revise, which Duá's cards replay and
// dry-run): they only write rows. The routine is fired by the fleet loop after commit.

export function specOr422(input: unknown): DesignSpec {
  const r = validateSpec(input);
  if (!r.ok)
    throw new HttpError(422, 'INVALID_SPEC', 'the design spec is not valid', { errors: r.errors });
  return r.spec;
}

/** Applying Duá's card: the spec goes on the open request and the build is queued. */
export async function buildSiteTx(
  tx: Sql,
  tenantId: string,
  o: { spec: unknown; source: SiteSource },
): Promise<SiteTaskDbRow> {
  await requireFeature(tx, tenantId, 'customSite');
  const spec = specOr422(o.spec);
  const req = (
    await tx<{ id: string; status: string }[]>`
      select id, status from site_requests
      where tenant_id = ${tenantId} and status in ('requested', 'in_progress')
      for update
    `
  )[0];
  if (!req) throw new HttpError(404, 'SITE_REQUEST_NOT_FOUND', 'there is no open site request');
  const live = await tx`
    select 1 from site_tasks
    where site_request_id = ${req.id} and status not in ('delivered', 'cancelled')
  `;
  if (live.length)
    throw new HttpError(409, 'SITE_ALREADY_BUILDING', 'this site is already being built');
  if (req.status !== 'requested')
    throw new HttpError(409, 'SITE_REQUEST_NOT_READY', 'the team is already handling this request');
  await tx`
    update site_requests set spec = ${tx.json(spec as never)}, spec_version = spec_version + 1,
      status = 'in_progress', updated_at = now(),
      brief = coalesce(nullif(btrim(brief), ''), ${spec.summary.slice(0, 2000)})
    where id = ${req.id}
  `;
  const task = await requestSiteTaskTx(tx, {
    tenantId,
    siteRequestId: req.id,
    kind: 'generate',
    spec,
    source: o.source,
  });
  await emitAdminTx(tx, tenantId, 'billing');
  return task;
}

/** The one included revision, after delivery. */
export async function reviseSiteTx(
  tx: Sql,
  tenantId: string,
  o: { note: string; spec: unknown; source: SiteSource },
): Promise<SiteTaskDbRow> {
  await requireFeature(tx, tenantId, 'customSite');
  const spec = specOr422(o.spec);
  const req = (
    await tx<{ id: string; status: string; revisions_used: number }[]>`
      select id, status, revisions_used from site_requests where tenant_id = ${tenantId}
      order by created_at desc limit 1
      for update
    `
  )[0];
  if (!req) throw new HttpError(404, 'SITE_REQUEST_NOT_FOUND', 'there is no site request');
  if (req.revisions_used >= 1)
    throw new HttpError(409, 'REVISION_USED', 'the included revision was already used');
  if (req.status !== 'delivered')
    throw new HttpError(409, 'SITE_NOT_DELIVERED', 'the site is not live yet');
  try {
    await tx`
      update site_requests set spec = ${tx.json(spec as never)}, spec_version = spec_version + 1,
        revisions_used = 1, status = 'in_progress', updated_at = now()
      where id = ${req.id}
    `;
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new HttpError(409, 'SITE_REQUEST_OPEN', 'the store already has an open site request');
    throw err;
  }
  const task = await requestSiteTaskTx(tx, {
    tenantId,
    siteRequestId: req.id,
    kind: 'revision',
    spec,
    note: o.note,
    source: o.source,
  });
  await emitAdminTx(tx, tenantId, 'billing');
  return task;
}
