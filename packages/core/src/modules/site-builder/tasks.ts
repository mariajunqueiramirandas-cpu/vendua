import { emitAdminTx } from '../../admin/live.ts';
import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import type { DesignSpec } from './spec.ts';

// A site task: one build of a store's site request, from the owner applying Duá's card to the
// site live. requestSiteTaskTx is the only insert (one producer, like requestAgentTx); the
// fleet loop (jobs.ts) and GitHub's webhook (routes.ts) move it; staff approve it in the CRM.

export type SiteTaskKind = 'generate' | 'revision';
export type SiteTaskStatus =
  | 'queued'
  | 'firing'
  | 'running'
  | 'pr_open'
  | 'approved'
  | 'merged'
  | 'delivered'
  | 'escalated'
  | 'cancelled';
export type SiteSource = 'owner' | 'copilot' | 'staff';

/** one day from the owner's yes to the site live, weekends included */
export const DELIVERY_MS = 24 * 60 * 60_000;
/** failed CI runs on distinct shas before staff take over */
export const MAX_FIX_PUSHES = 4;

export interface SiteTaskDbRow {
  id: string;
  tenant_id: string;
  site_request_id: string;
  kind: SiteTaskKind;
  source: string;
  spec: DesignSpec;
  note: string | null;
  runner: 'claude_routine' | 'human';
  status: SiteTaskStatus;
  attempt: number;
  branch: string;
  session_id: string | null;
  session_url: string | null;
  pr_number: number | null;
  pr_url: string | null;
  head_sha: string | null;
  ci: 'pending' | 'success' | 'failure' | null;
  iterations: number;
  merge_sha: string | null;
  merged_at: Date | null;
  design: SiteDesign | null;
  design_applied_at: Date | null;
  due_at: Date;
  due_soon_at: Date | null;
  overdue_at: Date | null;
  escalated_reason: string | null;
  approved_at: Date | null;
  approved_by: string | null;
  fired_at: Date | null;
  delivered_at: Date | null;
  lease_until: Date | null;
  next_attempt_at: Date | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SiteDesign {
  templates: Record<string, unknown>;
  tokens: unknown;
}

/**
 * The git branch a task's agent pushes. The task id makes it unambiguous across stores (a slug
 * may itself end in "-ajuste" or "-2"); a retry adds its attempt.
 */
export function branchFor(slug: string, kind: SiteTaskKind, taskId: string, attempt = 1): string {
  const base = `claude/site-${slug}${kind === 'revision' ? '-ajuste' : ''}--${taskId.slice(0, 8)}`;
  return attempt > 1 ? `${base}-${attempt}` : base;
}

export async function storeOfTx(
  tx: Sql,
  tenantId: string,
): Promise<{ name: string; slug: string }> {
  const t = (
    await tx<
      { name: string; slug: string }[]
    >`select name, slug from tenants where id = ${tenantId}`
  )[0];
  if (!t) throw new HttpError(404, 'STORE_NOT_FOUND', 'store not found');
  return t;
}

/** A line on the CRM timeline; detail is bounded by the column's 4 kB check. */
export async function taskEventTx(
  tx: Sql,
  task: { id: string; tenant_id: string },
  kind: string,
  detail: Record<string, unknown> = {},
) {
  const json = JSON.stringify(detail).length > 3800 ? { truncated: true } : detail;
  await tx`
    insert into site_task_events (tenant_id, task_id, kind, detail)
    values (${task.tenant_id}, ${task.id}, ${kind.slice(0, 40)}, ${tx.json(json as never)})
  `;
}

/**
 * The one producer of site tasks. Writes the task, its first timeline line and the staff event
 * in the caller's transaction; never calls out (the fleet loop fires it after commit). 409
 * SITE_ALREADY_BUILDING while the request has a live task.
 */
export async function requestSiteTaskTx(
  tx: Sql,
  o: {
    tenantId: string;
    siteRequestId: string;
    kind: SiteTaskKind;
    spec: DesignSpec;
    note?: string | null;
    source: SiteSource;
  },
): Promise<SiteTaskDbRow> {
  const live = await tx`
    select 1 from site_tasks
    where site_request_id = ${o.siteRequestId} and status not in ('delivered', 'cancelled')
  `;
  if (live.length)
    throw new HttpError(409, 'SITE_ALREADY_BUILDING', 'this site is already being built');
  const store = await storeOfTx(tx, o.tenantId);
  const id = crypto.randomUUID();
  let row: SiteTaskDbRow | undefined;
  try {
    row = (
      await tx<SiteTaskDbRow[]>`
        insert into site_tasks (id, tenant_id, site_request_id, kind, source, spec, note, branch,
                                due_at)
        values (${id}, ${o.tenantId}, ${o.siteRequestId}, ${o.kind}, ${o.source},
                ${tx.json(o.spec as never)}, ${o.note ?? null}, ${branchFor(store.slug, o.kind, id)},
                now() + make_interval(secs => ${DELIVERY_MS / 1000}))
        returning *
      `
    )[0];
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new HttpError(409, 'SITE_ALREADY_BUILDING', 'this site is already being built');
    throw err;
  }
  const task = row!;
  await taskEventTx(tx, task, 'queued', { kind: o.kind, source: o.source, branch: task.branch });
  await recordStaffEventTx(
    tx,
    'site.task_queued',
    {
      storeName: store.name,
      slug: store.slug,
      taskId: task.id,
      kind: task.kind,
      dueAt: task.due_at.toISOString(),
    },
    { tenantId: o.tenantId },
  );
  return task;
}

/** Hands the task to staff: the owner still sees "construindo". */
export async function escalateTx(
  tx: Sql,
  task: Pick<SiteTaskDbRow, 'id' | 'tenant_id' | 'kind'>,
  reason: string,
  detail: Record<string, unknown> = {},
) {
  const r = reason.slice(0, 300);
  await tx`
    update site_tasks set status = 'escalated', escalated_reason = ${r}, lease_until = null,
      updated_at = now()
    where id = ${task.id}
  `;
  await taskEventTx(tx, task, 'escalated', { reason: r, ...detail });
  const store = await storeOfTx(tx, task.tenant_id);
  await recordStaffEventTx(
    tx,
    'site.escalated',
    { storeName: store.name, slug: store.slug, taskId: task.id, kind: task.kind, reason: r },
    { tenantId: task.tenant_id },
  );
  await emitAdminTx(tx, task.tenant_id, 'billing');
}

// ── views ────────────────────────────────────────────────────────────────────

export type SiteStage = 'fila' | 'construindo' | 'revisao' | 'publicando';

/** What the owner sees of a live task: never escalation, PRs, CI or sessions. */
export function stageOf(status: SiteTaskStatus): SiteStage | null {
  switch (status) {
    case 'queued':
    case 'firing':
      return 'fila';
    case 'running':
    case 'pr_open':
    case 'escalated':
      return 'construindo';
    case 'approved':
      return 'revisao';
    case 'merged':
      return 'publicando';
    default:
      return null;
  }
}

/** The account's siteRequest (GET /admin/v1/account). */
export async function siteRequestViewTx(tx: Sql, tenantId: string) {
  const site = (
    await tx<
      {
        id: string;
        status: string;
        brief: string | null;
        created_at: Date;
        updated_at: Date;
        spec: DesignSpec | null;
        delivered_at: Date | null;
        revisions_used: number;
      }[]
    >`
      select id, status, brief, created_at, updated_at, spec, delivered_at, revisions_used
      from site_requests where tenant_id = ${tenantId}
      order by (status in ('requested', 'in_progress')) desc, created_at desc limit 1
    `
  )[0];
  if (!site) return null;
  const task = (
    await tx<{ kind: SiteTaskKind; status: SiteTaskStatus; due_at: Date }[]>`
      select kind, status, due_at from site_tasks
      where site_request_id = ${site.id} and status not in ('delivered', 'cancelled')
      limit 1
    `
  )[0];
  const stage = task ? stageOf(task.status) : null;
  return {
    id: site.id,
    status: site.status,
    brief: site.brief,
    createdAt: site.created_at,
    updatedAt: site.updated_at,
    spec: site.spec,
    dueAt: task ? task.due_at.toISOString() : null,
    deliveredAt: site.delivered_at ? site.delivered_at.toISOString() : null,
    revisionsUsed: (site.revisions_used >= 1 ? 1 : 0) as 0 | 1,
    revisionsIncluded: 1 as const,
    building: task && stage ? { kind: task.kind, stage } : null,
  };
}

export type SiteTaskJoined = SiteTaskDbRow & { store_name: string; slug: string };

export const TASK_SELECT = (tx: Sql) => tx`
  select s.*, t.name as store_name, t.slug from site_tasks s join tenants t on t.id = s.tenant_id
`;

/** SiteTaskRow, the CRM's shape. */
export function siteTaskJson(r: SiteTaskJoined) {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    storeName: r.store_name,
    slug: r.slug,
    kind: r.kind,
    status: r.status,
    runner: r.runner,
    attempt: r.attempt,
    branch: r.branch,
    sessionUrl: r.session_url,
    prNumber: r.pr_number,
    prUrl: r.pr_url,
    ci: r.ci,
    iterations: r.iterations,
    dueAt: iso(r.due_at),
    escalatedReason: r.escalated_reason,
    approvedBy: r.approved_by,
    createdAt: iso(r.created_at),
    firedAt: iso(r.fired_at),
    mergedAt: iso(r.merged_at),
    deliveredAt: iso(r.delivered_at),
    spec: r.spec,
    note: r.note,
  };
}
