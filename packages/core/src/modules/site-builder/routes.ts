import type { Context, Hono } from 'hono';
import { text } from '../../admin/context.ts';
import { emitAdminTx } from '../../admin/live.ts';
import type { Sql } from '../../platform/db.ts';
import { HttpError, boundedText, parseJsonObject, uuidParam } from '../../platform/http.ts';
import type { Tenant } from '../../platform/tenancy.ts';
import { claimControl, controlTx } from '../control.ts';
import { emitControlEvent } from '../control-events.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import type { SiteDeps } from './deps.ts';
import { validSignature } from './github.ts';
import {
  MAX_FIX_PUSHES,
  TASK_SELECT,
  branchFor,
  escalateTx,
  siteTaskJson,
  storeOfTx,
  taskEventTx,
  type SiteTaskDbRow,
  type SiteTaskJoined,
} from './tasks.ts';

// /control/v1/site-tasks — the CRM's queue of bespoke sites: staff approve the green PR (the
// one human gate), retry, take over by hand or cancel. /control/v1/github/webhook is GitHub's
// (signed, no staff secret): pull requests and CI runs move the task.

const WEBHOOK_MAX_BYTES = 1024 * 1024;
const CI_WORKFLOW = '.github/workflows/ci.yml';
/** a running task with no PR this long after its fire may be retried */
const RUNNING_STUCK_MS = 60 * 60_000;
const LIVE_PR = ['running', 'pr_open', 'approved'] as const;

function idemKey(c: Context, scope: string) {
  const key = c.req.header('idempotency-key');
  if (!key)
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  if (key.length > 200) throw new HttpError(400, 'BAD_REQUEST', 'Idempotency-Key too long');
  return `site:${scope}:${key}`;
}

/** an optional JSON body: staff actions mostly send none */
async function optBody(c: Context): Promise<Record<string, unknown>> {
  const raw = await boundedText(c, 4096);
  return raw.trim() ? parseJsonObject(raw) : {};
}

async function lockTaskTx(tx: Sql, id: string): Promise<SiteTaskDbRow> {
  const t = (await tx<SiteTaskDbRow[]>`select * from site_tasks where id = ${id} for update`)[0];
  if (!t) throw new HttpError(404, 'SITE_TASK_NOT_FOUND', 'site task not found');
  return t;
}

async function taskJsonTx(tx: Sql, id: string) {
  const r = (await tx<SiteTaskJoined[]>`${TASK_SELECT(tx)} where s.id = ${id}`)[0]!;
  return siteTaskJson(r);
}

export function mountSiteBuilder(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  deps: SiteDeps;
}) {
  const { app, sql, controlGate, deps } = o;

  const reply = <T>(c: Context, res: { status: number; body: T; replayed: boolean }) => {
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    else emitControlEvent('fleet.change', 'site');
    return c.json(res.body as object, res.status as 200);
  };

  app.get('/control/v1/site-tasks', async (c) => {
    controlGate(c);
    const status = c.req.query('status') ?? 'open';
    if (status !== 'open' && status !== 'all')
      throw new HttpError(422, 'BAD_REQUEST', "status must be 'open' or 'all'", {
        field: 'status',
      });
    const rows = await controlTx(
      sql,
      (tx) => tx<SiteTaskJoined[]>`
        ${TASK_SELECT(tx)}
        where ${status === 'all' ? tx`true` : tx`s.status not in ('delivered', 'cancelled')`}
        order by s.due_at limit 200
      `,
    );
    c.header('cache-control', 'no-store');
    return c.json({ tasks: rows.map(siteTaskJson) });
  });

  app.get('/control/v1/site-tasks/:id', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const out = await controlTx(sql, async (tx) => {
      const r = (await tx<SiteTaskJoined[]>`${TASK_SELECT(tx)} where s.id = ${id}`)[0];
      if (!r) throw new HttpError(404, 'SITE_TASK_NOT_FOUND', 'site task not found');
      const events = await tx<{ at: Date; kind: string; detail: unknown }[]>`
        select at, kind, detail from site_task_events where task_id = ${id}
        order by id desc limit 200
      `;
      return {
        task: siteTaskJson(r),
        events: events.reverse().map((e) => ({
          at: e.at.toISOString(),
          kind: e.kind,
          detail: e.detail,
        })),
      };
    });
    c.header('cache-control', 'no-store');
    return c.json(out);
  });

  app.post('/control/v1/site-tasks/:id/approve', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const key = idemKey(c, `approve:${id}`);
    const body = await optBody(c);
    const by = body.by === undefined || body.by === null ? 'equipe' : text(body.by, 'by', 80, 1);
    const res = await claimControl(sql, key, async (tx) => {
      const t = await lockTaskTx(tx, id);
      if (t.status !== 'pr_open' || t.ci !== 'success')
        throw new HttpError(409, 'SITE_TASK_NOT_GREEN', 'only a green open PR can be approved', {
          status: t.status,
          ci: t.ci,
        });
      await tx`
        update site_tasks set status = 'approved', approved_at = now(), approved_by = ${by},
          attempts = 0, next_attempt_at = null, last_error = null, updated_at = now()
        where id = ${id}
      `;
      await taskEventTx(tx, t, 'approved', { by });
      await emitAdminTx(tx, t.tenant_id, 'billing');
      return { status: 200, body: { task: await taskJsonTx(tx, id) } };
    });
    return reply(c, res);
  });

  app.post('/control/v1/site-tasks/:id/retry', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const key = idemKey(c, `retry:${id}`);
    await optBody(c);
    const res = await claimControl(sql, key, async (tx) => {
      const t = await lockTaskTx(tx, id);
      const stuck =
        t.status === 'running' &&
        (!t.fired_at || Date.now() - t.fired_at.getTime() >= RUNNING_STUCK_MS);
      if (t.status !== 'escalated' && t.status !== 'cancelled' && !stuck)
        throw new HttpError(409, 'SITE_TASK_BUSY', 'this task is not stuck', {
          status: t.status,
        });
      const store = await storeOfTx(tx, t.tenant_id);
      const attempt = t.attempt + 1;
      const branch = branchFor(store.slug, t.kind, t.id, attempt);
      try {
        await tx`
          update site_tasks set status = 'queued', runner = 'claude_routine', attempt = ${attempt},
            branch = ${branch}, iterations = 0, ci = null, pr_number = null, pr_url = null,
            head_sha = null, session_id = null, session_url = null, fired_at = null,
            escalated_reason = null, approved_at = null, approved_by = null, merge_sha = null,
            merged_at = null, design = null, design_applied_at = null, lease_until = null,
            next_attempt_at = null, attempts = 0, last_error = null, updated_at = now()
          where id = ${id}
        `;
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new HttpError(409, 'SITE_ALREADY_BUILDING', 'the request has another live task');
        throw err;
      }
      if (t.status === 'cancelled')
        await tx`
          update site_requests set status = 'in_progress', updated_at = now()
          where id = ${t.site_request_id}
        `.catch((err: { code?: string }) => {
          if (err.code === '23505')
            throw new HttpError(409, 'SITE_REQUEST_OPEN', 'the store has another open request');
          throw err;
        });
      await taskEventTx(tx, t, 'retried', { attempt, branch, from: t.status });
      await emitAdminTx(tx, t.tenant_id, 'billing');
      return { status: 200, body: { task: await taskJsonTx(tx, id) } };
    });
    return reply(c, res);
  });

  app.post('/control/v1/site-tasks/:id/human', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const key = idemKey(c, `human:${id}`);
    await optBody(c);
    const res = await claimControl(sql, key, async (tx) => {
      const t = await lockTaskTx(tx, id);
      if (t.status !== 'queued' && t.status !== 'escalated' && t.status !== 'running')
        throw new HttpError(409, 'SITE_TASK_BUSY', 'only a waiting or stuck task can be taken', {
          status: t.status,
        });
      await tx`
        update site_tasks set runner = 'human', status = 'running', escalated_reason = null,
          lease_until = null, next_attempt_at = null, last_error = null, updated_at = now()
        where id = ${id}
      `;
      await taskEventTx(tx, t, 'human', { branch: t.branch });
      await emitAdminTx(tx, t.tenant_id, 'billing');
      return { status: 200, body: { task: await taskJsonTx(tx, id) } };
    });
    return reply(c, res);
  });

  app.post('/control/v1/site-tasks/:id/cancel', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const key = idemKey(c, `cancel:${id}`);
    const body = await optBody(c);
    const reason = text(body.reason, 'reason', 300, 3);
    const res = await claimControl(sql, key, async (tx) => {
      const t = await lockTaskTx(tx, id);
      if (t.status === 'delivered' || t.status === 'cancelled' || t.status === 'merged')
        throw new HttpError(409, 'SITE_TASK_DONE', 'this task can no longer be cancelled', {
          status: t.status,
        });
      // a fire or a merge may be in flight: its result would land on a cancelled task
      if (t.status === 'firing' || t.status === 'approved')
        throw new HttpError(409, 'SITE_TASK_BUSY', 'wait for the fire or the merge to finish', {
          status: t.status,
        });
      await tx`
        update site_tasks set status = 'cancelled', escalated_reason = ${reason},
          lease_until = null, updated_at = now()
        where id = ${id}
      `;
      // a revision's site is already live: its request goes back to delivered
      await tx`
        update site_requests
        set status = ${t.kind === 'revision' ? 'delivered' : 'requested'}, updated_at = now()
        where id = ${t.site_request_id} and status = 'in_progress'
      `;
      await taskEventTx(tx, t, 'cancelled', { reason });
      await emitAdminTx(tx, t.tenant_id, 'billing');
      return { status: 200, body: { task: await taskJsonTx(tx, id) } };
    });
    return reply(c, res);
  });

  // ── GitHub ────────────────────────────────────────────────────────────────

  app.post('/control/v1/github/webhook', async (c) => {
    const secret = deps.webhookSecret;
    if (!secret) throw new HttpError(404, 'NOT_FOUND', 'not found');
    const raw = await boundedText(c, WEBHOOK_MAX_BYTES);
    if (!validSignature(raw, c.req.header('x-hub-signature-256'), secret))
      throw new HttpError(401, 'BAD_SIGNATURE', 'signature does not match');
    const delivery = c.req.header('x-github-delivery') ?? '';
    const event = c.req.header('x-github-event') ?? '';
    if (!/^[A-Za-z0-9-]{1,100}$/.test(delivery) || !/^[a-z_]{1,60}$/.test(event))
      throw new HttpError(400, 'BAD_REQUEST', 'missing delivery or event header');
    if (event !== 'pull_request' && event !== 'workflow_run') return c.body(null, 204);
    const payload = parseJsonObject(raw);
    const fullName = (v: unknown) =>
      typeof (v as { full_name?: unknown } | undefined)?.full_name === 'string'
        ? ((v as { full_name: string }).full_name.toLowerCase() as string)
        : null;
    const base = fullName(payload.repository);
    const repo = deps.github?.repo.toLowerCase() ?? base;
    if (!repo || base !== repo) return c.body(null, 204);
    // a fork's branch may carry one of ours by name: only the repository's own branches count
    const head =
      event === 'pull_request'
        ? fullName(((payload.pull_request ?? {}) as { head?: { repo?: unknown } }).head?.repo)
        : fullName(
            (payload.workflow_run as { head_repository?: unknown } | undefined)?.head_repository,
          );
    if (head !== repo) return c.body(null, 204);
    const handled = await controlTx(sql, async (tx) => {
      const fresh = await tx`
        insert into github_deliveries (delivery_id, event) values (${delivery}, ${event})
        on conflict (delivery_id) do nothing returning delivery_id
      `;
      if (!fresh.length) return null;
      return event === 'pull_request' ? pullRequestTx(tx, payload) : workflowRunTx(tx, payload);
    });
    if (!handled) return c.body(null, 204);
    emitControlEvent('fleet.change', 'site');
    return c.json({ ok: true, taskId: handled });
  });
}

const str = (v: unknown, max: number) =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

async function taskByBranchTx(tx: Sql, branch: string | null): Promise<SiteTaskDbRow | null> {
  if (!branch) return null;
  return (
    (
      await tx<SiteTaskDbRow[]>`
        select * from site_tasks where branch = ${branch} and status in ${tx(LIVE_PR)}
        order by created_at desc limit 1 for update
      `
    )[0] ?? null
  );
}

/** pull_request: opened/reopened → pr_open; synchronize → new head; closed → merged or
 *  escalated. Returns the task id when it moved one. */
async function pullRequestTx(tx: Sql, p: Record<string, unknown>): Promise<string | null> {
  const action = p.action;
  const pr = (p.pull_request ?? {}) as Record<string, unknown>;
  const head = (pr.head ?? {}) as Record<string, unknown>;
  const t = await taskByBranchTx(tx, str(head.ref, 120));
  if (!t) return null;
  const number = typeof pr.number === 'number' && Number.isInteger(pr.number) ? pr.number : null;
  const sha = str(head.sha, 64);
  const url = str(pr.html_url, 500);
  switch (action) {
    case 'opened':
    case 'reopened': {
      await tx`
        update site_tasks set status = 'pr_open', pr_number = ${number}, pr_url = ${url},
          head_sha = ${sha}, ci = 'pending', approved_at = null, approved_by = null,
          updated_at = now()
        where id = ${t.id}
      `;
      await taskEventTx(tx, t, 'pr_opened', { number, url, sha });
      break;
    }
    case 'synchronize': {
      if (sha === t.head_sha) return null;
      // a push after approval needs a new approval: the merge is pinned to the approved sha
      await tx`
        update site_tasks set head_sha = ${sha}, ci = 'pending',
          status = ${t.status === 'approved' ? 'pr_open' : t.status},
          approved_at = ${t.status === 'approved' ? null : t.approved_at},
          approved_by = ${t.status === 'approved' ? null : t.approved_by},
          pr_number = coalesce(pr_number, ${number}), pr_url = coalesce(pr_url, ${url}),
          updated_at = now()
        where id = ${t.id}
      `;
      await taskEventTx(tx, t, 'pushed', { sha });
      break;
    }
    case 'closed': {
      if (pr.merged === true) {
        await tx`
          update site_tasks set status = 'merged', merge_sha = ${str(pr.merge_commit_sha, 64)},
            merged_at = now(), lease_until = null, attempts = 0, next_attempt_at = null,
            last_error = null, updated_at = now()
          where id = ${t.id}
        `;
        await taskEventTx(tx, t, 'merged', { sha: str(pr.merge_commit_sha, 64), by: 'github' });
      } else {
        await escalateTx(tx, t, 'PR fechado sem merge', { number });
        return t.id;
      }
      break;
    }
    default:
      return null;
  }
  await emitAdminTx(tx, t.tenant_id, 'billing');
  return t.id;
}

const FAILED = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

/** workflow_run completed (CI only) for the task's current head: green → ready for staff;
 *  red on a new sha counts a fix push, and past MAX_FIX_PUSHES staff take over. */
async function workflowRunTx(tx: Sql, p: Record<string, unknown>): Promise<string | null> {
  if (p.action !== 'completed') return null;
  const run = (p.workflow_run ?? {}) as Record<string, unknown>;
  if (run.path !== CI_WORKFLOW) return null;
  const t = await taskByBranchTx(tx, str(run.head_branch, 120));
  const sha = str(run.head_sha, 64);
  if (!t || !sha || sha !== t.head_sha) return null;
  const conclusion = run.conclusion;
  const runId = typeof run.id === 'number' ? run.id : null;
  const attempt = typeof run.run_attempt === 'number' ? run.run_attempt : 1;
  if (conclusion === 'success') {
    if (t.ci === 'success') return null;
    // a red sha turns green only by re-running that same run: another run of ci.yml on the
    // sha (a label added) skips the jobs that failed and concludes success anyway
    const red = await tx<{ run_id: string | null }[]>`
      select detail->>'runId' as run_id from site_task_events
      where task_id = ${t.id} and kind = 'ci_failure' and detail->>'sha' = ${sha}
    `;
    if (
      red.length &&
      !(attempt > 1 && red.some((r) => runId !== null && r.run_id === String(runId)))
    )
      return null;
    await tx`update site_tasks set ci = 'success', updated_at = now() where id = ${t.id}`;
    await taskEventTx(tx, t, 'ci_success', { sha });
    if (t.status === 'pr_open') {
      const store = await storeOfTx(tx, t.tenant_id);
      await recordStaffEventTx(
        tx,
        'site.ready',
        { storeName: store.name, slug: store.slug, taskId: t.id, kind: t.kind, prUrl: t.pr_url },
        { tenantId: t.tenant_id, dedupeKey: `site.ready:${t.id}:${sha}` },
      );
    }
    return t.id;
  }
  if (typeof conclusion !== 'string' || !FAILED.has(conclusion)) return null;
  const seen = await tx`
    select 1 from site_task_events
    where task_id = ${t.id} and kind = 'ci_failure' and detail->>'sha' = ${sha}
  `;
  const iterations = t.iterations + (seen.length ? 0 : 1);
  await tx`
    update site_tasks set ci = 'failure', iterations = ${iterations}, updated_at = now()
    where id = ${t.id}
  `;
  if (!seen.length || runId !== null)
    await taskEventTx(tx, t, 'ci_failure', { sha, runId, conclusion, iterations });
  if (iterations > MAX_FIX_PUSHES)
    await escalateTx(tx, t, `não ficou verde em ${MAX_FIX_PUSHES} tentativas`, { sha });
  return t.id;
}
