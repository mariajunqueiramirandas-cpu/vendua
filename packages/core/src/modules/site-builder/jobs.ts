import { validateTemplate, validateTokens, PAGE_RE } from '@vendua/templates';
import { emitAdminTx } from '../../admin/live.ts';
import { withTenant, type Sql } from '../../platform/db.ts';
import { log } from '../../platform/log.ts';
import { controlTx } from '../control.ts';
import { emitControlEvent } from '../control-events.ts';
import { scoped, type FleetDeps } from '../fleet/deps.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import { saveTemplateTx, saveTokensTx } from '../storefront-platform.ts';
import { GitHubError, checksVerdict } from './github.ts';
import { FireError, type FireTask } from './runners.ts';
import {
  MAX_FIX_PUSHES,
  escalateTx,
  storeOfTx,
  taskEventTx,
  type SiteDesign,
  type SiteTaskDbRow,
} from './tasks.ts';

// The site builder's pass in the fleet loop (fleet/jobs.ts tick): fire queued tasks, merge
// approved PRs, read the merged design, apply it once the store's new build is deploying,
// deliver when it is live, and tell staff about deadlines. Claims take a lease (replicas never
// double-step) and every HTTP call happens between transactions.

export const siteLog = log.child({ mod: 'site-builder' });

const LEASE = '2 minutes';
const NOT_CONFIGURED = 'routine não configurada';
const FIRE_UNCERTAIN = 'disparo incerto — confira as sessões antes de tentar de novo';
const DESIGN_MAX_ATTEMPTS = 10;
const TEMPLATE_FILE_RE = /^(layout|home|catalog|product|page\.[a-z0-9][a-z0-9-]{0,39})\.json$/;
const TEMPLATES_MAX = 30;

const backoff = (attempts: number) => Math.min(15_000 * 2 ** attempts, 10 * 60_000);
const errText = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 500);

export async function runSiteTasks(d: FleetDeps): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ['fire', () => fireQueued(d)],
    ['merge', () => mergeApproved(d)],
    ['design', () => fetchDesigns(d)],
    ['deliver', () => deliverMerged(d)],
    ['deadlines', () => deadlines(d)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (err) {
      siteLog.warn({ err, step: name }, 'site builder step failed');
    }
  }
}

// ── fire ─────────────────────────────────────────────────────────────────────

async function envelopeTx(tx: Sql, t: SiteTaskDbRow): Promise<FireTask> {
  const store = await storeOfTx(tx, t.tenant_id);
  const settings = (
    await tx<{ segment: string | null; logo_url: string | null }[]>`
      select segment, logo_url from store_settings where tenant_id = ${t.tenant_id}
    `
  )[0];
  const photos = await tx<{ url: string }[]>`
    select m.url from product_media m join products p on p.id = m.product_id
    where m.tenant_id = ${t.tenant_id} and p.deleted_at is null and m.url like 'https://%'
    order by p.created_at, m.sort, m.id limit 8
  `;
  const logo = settings?.logo_url?.startsWith('https://') ? settings.logo_url : null;
  return {
    taskId: t.id,
    kind: t.kind,
    slug: store.slug,
    storeName: store.name,
    segment: settings?.segment ?? null,
    spec: t.spec,
    note: t.note,
    assets: { logo, photos: photos.map((p) => p.url) },
    branch: t.branch,
    base: 'main',
    label: `storefront:${store.slug}`,
    marker: `vendua-task:${t.id}`,
    maxFixPushes: MAX_FIX_PUSHES,
    dueAt: t.due_at.toISOString(),
  };
}

/** queued → firing (committed) → the routine's /fire → running. A fire is never retried: an
 *  answer we can't read means the session may exist, so staff check before trying again. */
export async function fireQueued(d: FleetDeps): Promise<number> {
  const runner = d.site.runner;
  // a fire whose answer never landed (the process died mid-call) is as unclear as a timeout
  await controlTx(d.sql, async (tx) => {
    const stuck = await tx<SiteTaskDbRow[]>`
      select * from site_tasks
      where status = 'firing' and lease_until < now() ${scoped(tx, d, 'tenant_id')}
      for update skip locked
    `;
    for (const t of stuck) await escalateTx(tx, t, FIRE_UNCERTAIN, { stage: 'fire' });
  });
  if (!runner) {
    await controlTx(d.sql, async (tx) => {
      const parked = await tx<{ id: string; tenant_id: string; was: string | null }[]>`
        with due as (
          select id, last_error as was from site_tasks
          where status = 'queued' and runner = 'claude_routine'
            and (next_attempt_at is null or next_attempt_at <= now())
            ${scoped(tx, d, 'tenant_id')}
          for update skip locked
        )
        update site_tasks s set last_error = ${NOT_CONFIGURED},
          next_attempt_at = now() + interval '10 minutes', updated_at = now()
        from due where s.id = due.id
        returning s.id, s.tenant_id, due.was
      `;
      for (const p of parked)
        if (p.was !== NOT_CONFIGURED)
          await taskEventTx(tx, p, 'parked', { reason: NOT_CONFIGURED });
    });
    return 0;
  }
  const claimed = await controlTx(d.sql, async (tx) => {
    const rows = await tx<SiteTaskDbRow[]>`
      update site_tasks set status = 'firing', lease_until = now() + interval '5 minutes',
        attempts = attempts + 1, updated_at = now()
      where id in (
        select id from site_tasks
        where status = 'queued' and runner = 'claude_routine'
          and (next_attempt_at is null or next_attempt_at <= now())
          and (lease_until is null or lease_until < now())
          ${scoped(tx, d, 'tenant_id')}
        order by due_at limit 5
        for update skip locked
      )
      returning *
    `;
    for (const t of rows) await taskEventTx(tx, t, 'firing', { branch: t.branch });
    return rows;
  });
  for (const task of claimed) {
    // the store's own rows (settings, photos) are read as the store
    let envelope: FireTask;
    try {
      envelope = await withTenant(d.sql, task.tenant_id, (tx) => envelopeTx(tx, task));
    } catch (err) {
      // nothing was fired yet: back to the queue
      await controlTx(
        d.sql,
        (tx) => tx`
          update site_tasks set status = 'queued', lease_until = null, last_error = ${errText(err)},
            next_attempt_at = now() + make_interval(secs => ${backoff(task.attempts) / 1000}),
            updated_at = now()
          where id = ${task.id} and status = 'firing'
        `,
      );
      continue;
    }
    let started: { sessionId: string | null; sessionUrl: string | null } | null = null;
    let failure: { reason: string; detail: string } | null = null;
    try {
      started = await runner.start(envelope);
    } catch (err) {
      failure =
        err instanceof FireError && err.outcome === 'refused'
          ? { reason: `disparo recusado: ${err.message}`, detail: err.message }
          : { reason: FIRE_UNCERTAIN, detail: errText(err) };
    }
    await controlTx(d.sql, async (tx) => {
      const cur = (
        await tx<SiteTaskDbRow[]>`select * from site_tasks where id = ${task.id} for update`
      )[0];
      if (!cur || cur.status !== 'firing') return;
      if (started) {
        await tx`
          update site_tasks set status = 'running', session_id = ${started.sessionId},
            session_url = ${started.sessionUrl}, fired_at = now(), lease_until = null,
            last_error = null, updated_at = now()
          where id = ${task.id}
        `;
        await taskEventTx(tx, cur, 'fired', { sessionUrl: started.sessionUrl });
        await emitAdminTx(tx, cur.tenant_id, 'billing');
      } else if (failure) {
        await tx`update site_tasks set last_error = ${failure.detail.slice(0, 500)} where id = ${task.id}`;
        await escalateTx(tx, cur, failure.reason, { stage: 'fire' });
      }
    });
  }
  if (claimed.length) emitControlEvent('fleet.change', 'site');
  return claimed.length;
}

// ── merge ────────────────────────────────────────────────────────────────────

/** approved → squash-merge at the approved head sha → merged. GitHub refusing it (405 not
 *  mergeable, 409 head moved) hands it back to pr_open; anything else retries with backoff. */
export async function mergeApproved(d: FleetDeps): Promise<number> {
  const gh = d.site.github;
  if (!gh) return 0;
  const due = await controlTx(
    d.sql,
    (tx) => tx<SiteTaskDbRow[]>`
      update site_tasks set lease_until = now() + ${LEASE}::interval
      where id in (
        select id from site_tasks
        where status = 'approved' and ci = 'success'
          and (next_attempt_at is null or next_attempt_at <= now())
          and (lease_until is null or lease_until < now())
          ${scoped(tx, d, 'tenant_id')}
        order by approved_at limit 5
        for update skip locked
      )
      returning *
    `,
  );
  for (const t of due) {
    // the batch's GitHub calls can outlast one lease: each task's restarts while it's still
    // unexpired (so no other Core has taken it)
    const kept = await controlTx(
      d.sql,
      (tx) => tx`
        update site_tasks set lease_until = now() + ${LEASE}::interval
        where id = ${t.id} and status = 'approved' and lease_until > now()
          and date_trunc('milliseconds', lease_until) = ${t.lease_until}
        returning id
      `,
    );
    if (!kept.length) continue;
    let merged: { sha: string | null } | null = null;
    let err: unknown = null;
    // GitHub's own word on the head, not the webhook's: a re-run that skipped jobs can say green
    let gate: { reason: string; pending: boolean } | null = null;
    if (t.pr_number && t.head_sha) {
      try {
        gate = checksVerdict(await gh.checkRuns(t.head_sha));
        if (!gate) merged = await gh.merge(t.pr_number, t.head_sha);
      } catch (e) {
        err = e;
      }
    } else err = new GitHubError(409, 'sem PR ou sha para o merge');
    await controlTx(d.sql, async (tx) => {
      const cur = (
        await tx<SiteTaskDbRow[]>`select * from site_tasks where id = ${t.id} for update`
      )[0];
      if (!cur || cur.status !== 'approved') return;
      if (merged) {
        // the pull_request closed webhook would say the same; it finds the task merged already
        await tx`
          update site_tasks set status = 'merged', merge_sha = ${merged.sha ?? cur.head_sha},
            merged_at = now(), lease_until = null, last_error = null, attempts = 0,
            next_attempt_at = null, updated_at = now()
          where id = ${t.id}
        `;
        await taskEventTx(tx, cur, 'merged', { sha: merged.sha, by: 'core' });
        await emitAdminTx(tx, cur.tenant_id, 'billing');
      } else if (gate) {
        await tx`
          update site_tasks set status = 'pr_open', ci = ${gate.pending ? 'pending' : 'failure'},
            approved_at = null, approved_by = null, lease_until = null,
            last_error = ${gate.reason.slice(0, 500)}, updated_at = now()
          where id = ${t.id}
        `;
        await taskEventTx(tx, cur, 'merge_gate', { reason: gate.reason.slice(0, 300) });
        await emitAdminTx(tx, cur.tenant_id, 'billing');
      } else if (err instanceof GitHubError && (err.status === 405 || err.status === 409)) {
        await tx`
          update site_tasks set status = 'pr_open', approved_at = null, approved_by = null,
            lease_until = null, last_error = ${errText(err)}, updated_at = now()
          where id = ${t.id}
        `;
        await taskEventTx(tx, cur, 'merge_refused', { error: errText(err).slice(0, 300) });
        await emitAdminTx(tx, cur.tenant_id, 'billing');
      } else {
        await tx`
          update site_tasks set attempts = attempts + 1, lease_until = null,
            next_attempt_at = now() + make_interval(secs => ${backoff(cur.attempts) / 1000}),
            last_error = ${errText(err)}, updated_at = now()
          where id = ${t.id}
        `;
      }
    });
  }
  if (due.length) emitControlEvent('fleet.change', 'site');
  return due.length;
}

// ── design ───────────────────────────────────────────────────────────────────

class InvalidDesign extends Error {}

async function readDesign(d: FleetDeps, slug: string, sha: string): Promise<SiteDesign> {
  const gh = d.site.github!;
  const dir = `storefronts/${slug}`;
  const names = ((await gh.listDir(`${dir}/templates`, sha)) ?? [])
    .filter((n) => TEMPLATE_FILE_RE.test(n))
    .sort()
    .slice(0, TEMPLATES_MAX);
  const templates: Record<string, unknown> = {};
  for (const name of names) {
    const page = name.replace(/\.json$/, '').replace(/^page\./, 'page:');
    if (!PAGE_RE.test(page)) continue;
    const raw = await gh.readFile(`${dir}/templates/${name}`, sha);
    if (raw === null) continue;
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new InvalidDesign(`${name} não é JSON`);
    }
    const v = validateTemplate(input, page as never);
    if (!v.ok) throw new InvalidDesign(`${name}: ${v.errors[0] ?? 'inválido'}`);
    templates[page] = v.template;
  }
  let tokens: unknown = null;
  const rawTokens = await gh.readFile(`${dir}/tokens.json`, sha);
  if (rawTokens !== null) {
    let input: unknown;
    try {
      input = JSON.parse(rawTokens);
    } catch {
      throw new InvalidDesign('tokens.json não é JSON');
    }
    const v = validateTokens(input);
    if (!v.ok) throw new InvalidDesign(`tokens.json: ${v.errors[0] ?? 'inválido'}`);
    tokens = v.tokens;
  }
  return { templates, tokens };
}

/** merged → the storefront's templates and tokens at the merge sha, validated, kept on the task. */
export async function fetchDesigns(d: FleetDeps): Promise<number> {
  if (!d.site.github) return 0;
  const due = await controlTx(
    d.sql,
    (tx) => tx<(SiteTaskDbRow & { slug: string })[]>`
      with claimed as (
        update site_tasks set lease_until = now() + ${LEASE}::interval
        where id in (
          select id from site_tasks
          where status = 'merged' and design is null and merge_sha is not null
            and (next_attempt_at is null or next_attempt_at <= now())
            and (lease_until is null or lease_until < now())
            ${scoped(tx, d, 'tenant_id')}
          limit 5
          for update skip locked
        )
        returning *
      )
      select c.*, t.slug from claimed c join tenants t on t.id = c.tenant_id
    `,
  );
  for (const t of due) {
    let design: SiteDesign | null = null;
    let err: unknown = null;
    try {
      design = await readDesign(d, t.slug, t.merge_sha!);
    } catch (e) {
      err = e;
    }
    await controlTx(d.sql, async (tx) => {
      const cur = (
        await tx<SiteTaskDbRow[]>`select * from site_tasks where id = ${t.id} for update`
      )[0];
      if (!cur || cur.status !== 'merged' || cur.design) return;
      if (design) {
        await tx`
          update site_tasks set design = ${tx.json(design as never)}, lease_until = null,
            attempts = 0, next_attempt_at = null, last_error = null, updated_at = now()
          where id = ${t.id}
        `;
        await taskEventTx(tx, cur, 'design_read', {
          pages: Object.keys(design.templates),
          tokens: design.tokens !== null,
        });
      } else if (err instanceof InvalidDesign || cur.attempts + 1 >= DESIGN_MAX_ATTEMPTS) {
        await tx`update site_tasks set last_error = ${errText(err)} where id = ${t.id}`;
        await escalateTx(
          tx,
          cur,
          err instanceof InvalidDesign
            ? `design inválido: ${err.message}`
            : 'não consegui ler o design do GitHub',
          { stage: 'design' },
        );
      } else {
        await tx`
          update site_tasks set attempts = attempts + 1, lease_until = null,
            next_attempt_at = now() + make_interval(secs => ${backoff(cur.attempts) / 1000}),
            last_error = ${errText(err)}, updated_at = now()
          where id = ${t.id}
        `;
      }
    });
  }
  return due.length;
}

// ── deliver ──────────────────────────────────────────────────────────────────

/** The merged design lands as store data once the store's new build is deploying (the build
 *  has the sections it names); the task is delivered when that deployment is live. */
export async function deliverMerged(d: FleetDeps): Promise<number> {
  const ready = await controlTx(
    d.sql,
    (tx) => tx<{ id: string; tenant_id: string; dep_id: string; dep_status: string }[]>`
      select s.id, s.tenant_id, dp.id as dep_id, dp.status as dep_status
      from site_tasks s
        join tenants t on t.id = s.tenant_id
        join storefront_ops o on o.tenant_id = s.tenant_id and o.bundle = t.slug
        join lateral (
          select dp.id, dp.status from deployments dp join releases r on r.id = dp.release_id
          where dp.tenant_id = s.tenant_id and r.bundle = t.slug
            and dp.started_at >= s.merged_at and dp.status in ('pending', 'live')
            -- a build made and first registered after the merge: not a promote or rollback of
            -- one the store had, nor an image of an earlier main published late. Not
            -- r.commit = merge_sha: GIT_COMMIT is optional ('unknown'), and a deploy of a later
            -- main carries the merge under another commit
            and r.built_at >= s.merged_at and r.created_at >= s.merged_at
          order by dp.started_at desc limit 1
        ) dp on true
      where s.status = 'merged' and s.design is not null ${scoped(tx, d, 's.tenant_id')}
      order by s.merged_at limit 20
    `,
  );
  let delivered = 0;
  for (const r of ready) {
    try {
      const done = await withTenant(d.sql, r.tenant_id, (tx) =>
        applyAndDeliverTx(tx, r.id, r.dep_status === 'live', r.dep_id),
      );
      if (done) delivered++;
    } catch (err) {
      siteLog.warn({ err, task: r.id }, 'site delivery failed');
      await controlTx(
        d.sql,
        (tx) =>
          tx`update site_tasks set last_error = ${errText(err)}, updated_at = now() where id = ${r.id}`,
      ).catch(() => undefined);
    }
  }
  if (ready.length) emitControlEvent('fleet.change', 'site');
  return delivered;
}

async function applyAndDeliverTx(
  tx: Sql,
  taskId: string,
  live: boolean,
  deploymentId: string,
): Promise<boolean> {
  const t = (
    await tx<SiteTaskDbRow[]>`select * from site_tasks where id = ${taskId} for update`
  )[0];
  if (!t || t.status !== 'merged' || !t.design) return false;
  if (!t.design_applied_at) {
    // the store's own bundle: the design is that bundle's, whichever one the store runs now
    const bundle = (
      await tx<{ slug: string }[]>`select slug from tenants where id = ${t.tenant_id}`
    )[0]!.slug;
    const pages: string[] = [];
    for (const [page, template] of Object.entries(t.design.templates)) {
      const same = (
        await tx<{ same: boolean }[]>`
          select template = ${tx.json(template as never)}::jsonb as same
          from storefront_templates
          where tenant_id = ${t.tenant_id} and page = ${page} and bundle = ${bundle}
          order by version desc limit 1
        `
      )[0]?.same;
      if (same) continue;
      await saveTemplateTx(tx, t.tenant_id, page as never, template, 'site sob medida', { bundle });
      pages.push(page);
    }
    let tokens = false;
    if (t.design.tokens) {
      const same = (
        await tx<{ same: boolean }[]>`
          select tokens = ${tx.json(t.design.tokens as never)}::jsonb as same
          from storefront_tokens where tenant_id = ${t.tenant_id} and bundle = ${bundle}
          order by version desc limit 1
        `
      )[0]?.same;
      if (!same) {
        await saveTokensTx(tx, t.tenant_id, t.design.tokens, 'site sob medida', { bundle });
        tokens = true;
      }
    }
    await tx`update site_tasks set design_applied_at = now(), updated_at = now() where id = ${t.id}`;
    await taskEventTx(tx, t, 'design_applied', { pages, tokens, deploymentId });
    await emitAdminTx(tx, t.tenant_id, 'store');
  }
  if (!live) return false;
  await tx`
    update site_tasks set status = 'delivered', delivered_at = now(), lease_until = null,
      last_error = null, updated_at = now()
    where id = ${t.id}
  `;
  await tx`
    update site_requests set status = 'delivered', delivered_at = now(), updated_at = now()
    where id = ${t.site_request_id} and status = 'in_progress'
  `;
  await taskEventTx(tx, t, 'delivered', { deploymentId });
  const store = await storeOfTx(tx, t.tenant_id);
  await recordStaffEventTx(
    tx,
    'site.delivered',
    { storeName: store.name, slug: store.slug, taskId: t.id, kind: t.kind },
    { tenantId: t.tenant_id },
  );
  await emitAdminTx(tx, t.tenant_id, 'billing');
  return true;
}

// ── deadlines ────────────────────────────────────────────────────────────────

/** 8 hours left → site.due_soon; past due and not live → site.overdue. Each once per task. */
export async function deadlines(d: FleetDeps): Promise<void> {
  await controlTx(d.sql, async (tx) => {
    type Hit = {
      id: string;
      tenant_id: string;
      kind: 'generate' | 'revision';
      due_at: Date;
      name: string;
      slug: string;
    };
    const soon = await tx<Hit[]>`
      with due as (
        select id from site_tasks
        where status not in ('delivered', 'cancelled') and due_soon_at is null
          and due_at > now() and due_at < now() + interval '8 hours'
          ${scoped(tx, d, 'tenant_id')}
        for update skip locked
      )
      update site_tasks s set due_soon_at = now()
      from due, tenants t where s.id = due.id and t.id = s.tenant_id
      returning s.id, s.tenant_id, s.kind, s.due_at, t.name, t.slug
    `;
    for (const h of soon) {
      await taskEventTx(tx, h, 'due_soon', { dueAt: h.due_at.toISOString() });
      await recordStaffEventTx(
        tx,
        'site.due_soon',
        {
          storeName: h.name,
          slug: h.slug,
          taskId: h.id,
          kind: h.kind,
          dueAt: h.due_at.toISOString(),
        },
        { tenantId: h.tenant_id, dedupeKey: `site.due_soon:${h.id}` },
      );
    }
    const late = await tx<Hit[]>`
      with due as (
        select id from site_tasks
        where status not in ('delivered', 'cancelled') and overdue_at is null
          and due_at <= now()
          ${scoped(tx, d, 'tenant_id')}
        for update skip locked
      )
      update site_tasks s set overdue_at = now(), due_soon_at = coalesce(s.due_soon_at, now())
      from due, tenants t where s.id = due.id and t.id = s.tenant_id
      returning s.id, s.tenant_id, s.kind, s.due_at, t.name, t.slug
    `;
    for (const h of late) {
      await taskEventTx(tx, h, 'overdue', { dueAt: h.due_at.toISOString() });
      await recordStaffEventTx(
        tx,
        'site.overdue',
        {
          storeName: h.name,
          slug: h.slug,
          taskId: h.id,
          kind: h.kind,
          dueAt: h.due_at.toISOString(),
        },
        { tenantId: h.tenant_id, dedupeKey: `site.overdue:${h.id}` },
      );
    }
  });
}

/** Daily, with the fleet's history prune. */
export async function pruneGithubDeliveriesTx(tx: Sql) {
  await tx`delete from github_deliveries where received_at < now() - interval '30 days'`;
}
