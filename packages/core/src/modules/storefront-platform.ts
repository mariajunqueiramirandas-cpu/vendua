import {
  PAGE_RE,
  findMigration,
  runMigration,
  validateTemplate,
  validateTokens,
  withRemovals,
  type PageId,
  type PageTemplate,
  type SectionCatalog,
  type StorefrontTokens,
  type TemplateMigration,
  type TemplateSet,
} from '@vendua/templates';
import { withTenant, type Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';

// Phase 1b data plane for storefronts: templates (17), tokens as store data (04),
// ring + v.js kill switch (05), build manifests, template migrations by ring.

export type Ring = 'canary' | 'early' | 'stable';
export const RINGS: readonly Ring[] = ['canary', 'early', 'stable'];

export function assertPage(page: string): PageId {
  if (!PAGE_RE.test(page)) throw new HttpError(400, 'INVALID_PAGE', `unknown page '${page}'`);
  return page as PageId;
}

// ── templates ────────────────────────────────────────────────────────────────

export async function currentTemplatesTx(tx: Sql, tenantId: string): Promise<TemplateSet> {
  const rows = await tx<{ page: string; template: PageTemplate }[]>`
    select distinct on (page) page, template
    from storefront_templates where tenant_id = ${tenantId}
    order by page, version desc
  `;
  const out: TemplateSet = {};
  for (const r of rows) out[r.page as PageId] = r.template;
  return out;
}

export async function currentTemplateTx(
  tx: Sql,
  tenantId: string,
  page: PageId,
): Promise<{ version: number; template: PageTemplate } | null> {
  const rows = await tx<{ version: number; template: PageTemplate }[]>`
    select version, template from storefront_templates
    where tenant_id = ${tenantId} and page = ${page}
    order by version desc limit 1
  `;
  return rows[0] ?? null;
}

/** Writes a new version. `trackRemovals` marks merchant/staff edits: dropped
 *  types become tombstones migrations respect. Migrations and rollbacks don't. */
export async function saveTemplateTx(
  tx: Sql,
  tenantId: string,
  page: PageId,
  input: unknown,
  source: string,
  opts: { trackRemovals?: boolean; expectVersion?: number } = {},
): Promise<{ version: number; template: PageTemplate }> {
  const valid = validateTemplate(input, page);
  if (!valid.ok)
    throw new HttpError(422, 'INVALID_TEMPLATE', 'template failed validation', {
      errors: valid.errors.slice(0, 20),
    });
  // serialize writers per (tenant, page) — version numbers must not collide
  await tx`select pg_advisory_xact_lock(hashtext(${`tpl:${tenantId}:${page}`}))`;
  const cur = await currentTemplateTx(tx, tenantId, page);
  if (opts.expectVersion !== undefined && (cur?.version ?? 0) !== opts.expectVersion)
    throw new HttpError(409, 'TEMPLATE_VERSION_CONFLICT', 'template changed since it was read', {
      current: cur?.version ?? 0,
    });
  const template = opts.trackRemovals
    ? withRemovals(cur?.template ?? null, valid.template)
    : valid.template;
  const version = (cur?.version ?? 0) + 1;
  await tx`
    insert into storefront_templates (tenant_id, page, version, template, source)
    values (${tenantId}, ${page}, ${version}, ${tx.json(template as never)}, ${source.slice(0, 120)})
  `;
  return { version, template };
}

export async function templateHistoryTx(tx: Sql, tenantId: string, page: PageId) {
  return tx<{ version: number; source: string; created_at: string }[]>`
    select version, source, created_at from storefront_templates
    where tenant_id = ${tenantId} and page = ${page}
    order by version desc limit 50
  `;
}

/** Rollback = a new version whose body is an older one (history is append-only). */
export async function rollbackTemplateTx(
  tx: Sql,
  tenantId: string,
  page: PageId,
  toVersion?: number,
): Promise<{ version: number; template: PageTemplate; restored: number }> {
  const cur = await currentTemplateTx(tx, tenantId, page);
  if (!cur) throw new HttpError(404, 'TEMPLATE_NOT_FOUND', `no template for ${page}`);
  const target = toVersion ?? cur.version - 1;
  const rows = await tx<{ template: PageTemplate }[]>`
    select template from storefront_templates
    where tenant_id = ${tenantId} and page = ${page} and version = ${target}
  `;
  if (!rows[0] || target >= cur.version)
    throw new HttpError(404, 'TEMPLATE_NOT_FOUND', `no earlier version ${target} for ${page}`);
  const saved = await saveTemplateTx(tx, tenantId, page, rows[0].template, `rollback:${target}`);
  return { ...saved, restored: target };
}

// ── tokens ───────────────────────────────────────────────────────────────────

export async function currentTokensTx(
  tx: Sql,
  tenantId: string,
): Promise<{ version: number; tokens: StorefrontTokens } | null> {
  const rows = await tx<{ version: number; tokens: StorefrontTokens }[]>`
    select version, tokens from storefront_tokens where tenant_id = ${tenantId}
    order by version desc limit 1
  `;
  return rows[0] ?? null;
}

/** A token edit is a design update: validated (incl. WCAG AA), versioned, and
 *  queued as a rebuild on the outbox — no storefront code changes. */
export async function saveTokensTx(tx: Sql, tenantId: string, input: unknown, source: string) {
  const valid = validateTokens(input);
  if (!valid.ok)
    throw new HttpError(422, 'INVALID_TOKENS', 'tokens failed validation', {
      errors: valid.errors.slice(0, 20),
    });
  await tx`select pg_advisory_xact_lock(hashtext(${`tok:${tenantId}`}))`;
  const cur = await currentTokensTx(tx, tenantId);
  const version = (cur?.version ?? 0) + 1;
  await tx`
    insert into storefront_tokens (tenant_id, version, tokens, source)
    values (${tenantId}, ${version}, ${tx.json(valid.tokens as never)}, ${source.slice(0, 120)})
  `;
  await tx`
    insert into outbox (tenant_id, topic, payload)
    values (${tenantId}, 'storefront.rebuild_requested', ${tx.json({ reason: 'tokens', version })})
  `;
  return { version, tokens: valid.tokens };
}

// ── ops: ring + loader kill switch ───────────────────────────────────────────

export interface StorefrontOps {
  ring: Ring;
  loader: { state: 'normal' | 'maintenance'; title?: string; message?: string; href?: string };
}

export async function opsTx(tx: Sql, tenantId: string): Promise<StorefrontOps> {
  const row = (
    await tx<
      {
        ring: Ring;
        loader_state: 'normal' | 'maintenance';
        loader_title: string | null;
        loader_message: string | null;
        loader_href: string | null;
      }[]
    >`select * from storefront_ops where tenant_id = ${tenantId}`
  )[0];
  if (!row) return { ring: 'stable', loader: { state: 'normal' } };
  return {
    ring: row.ring,
    loader: {
      state: row.loader_state,
      ...(row.loader_title ? { title: row.loader_title } : {}),
      ...(row.loader_message ? { message: row.loader_message } : {}),
      ...(row.loader_href ? { href: row.loader_href } : {}),
    },
  };
}

const optStr = (v: unknown, field: string, max: number): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > max)
    throw new HttpError(400, 'BAD_REQUEST', `${field} must be a string ≤ ${max} chars`);
  return v;
};

export async function saveOpsTx(tx: Sql, tenantId: string, body: Record<string, unknown>) {
  const cur = await opsTx(tx, tenantId);
  const ring = body.ring ?? cur.ring;
  if (!RINGS.includes(ring as Ring))
    throw new HttpError(400, 'BAD_REQUEST', `ring must be one of ${RINGS.join(', ')}`);
  const loader = (body.loader ?? cur.loader) as Record<string, unknown>;
  if (typeof loader !== 'object' || loader === null)
    throw new HttpError(400, 'BAD_REQUEST', 'loader must be an object');
  const state = loader.state ?? 'normal';
  if (state !== 'normal' && state !== 'maintenance')
    throw new HttpError(400, 'BAD_REQUEST', "loader.state must be 'normal' or 'maintenance'");
  const href = optStr(loader.href, 'loader.href', 300);
  if (href && !/^(https:\/\/|\/)/.test(href))
    throw new HttpError(400, 'BAD_REQUEST', 'loader.href must be https:// or a path');
  await tx`
    insert into storefront_ops (tenant_id, ring, loader_state, loader_title, loader_message, loader_href)
    values (${tenantId}, ${ring as string}, ${state}, ${optStr(loader.title, 'loader.title', 80)},
      ${optStr(loader.message, 'loader.message', 300)}, ${href})
    on conflict (tenant_id) do update set
      ring = excluded.ring, loader_state = excluded.loader_state, loader_title = excluded.loader_title,
      loader_message = excluded.loader_message, loader_href = excluded.loader_href, updated_at = now()
  `;
  return opsTx(tx, tenantId);
}

// ── builds (artifact manifests) ──────────────────────────────────────────────

export interface RecordedBuild {
  kernelVersion: string;
  contract: number;
  sections: SectionCatalog;
  recordedAt: string;
}

export async function recordBuildTx(tx: Sql, tenantId: string, manifest: unknown) {
  const m = manifest as Record<string, unknown> | null;
  if (
    !m ||
    typeof m.kernel !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(m.kernel) ||
    typeof m.contract !== 'number' ||
    new TextEncoder().encode(JSON.stringify(m)).length > 64 * 1024
  )
    throw new HttpError(422, 'INVALID_MANIFEST', 'manifest needs kernel (x.y.z) + contract, ≤64KB');
  await tx`
    insert into storefront_builds (tenant_id, kernel_version, contract, manifest)
    values (${tenantId}, ${m.kernel}, ${m.contract}, ${tx.json(m as never)})
  `;
}

export async function latestBuildTx(tx: Sql, tenantId: string): Promise<RecordedBuild | null> {
  const row = (
    await tx<
      {
        kernel_version: string;
        contract: number;
        manifest: { sections?: SectionCatalog };
        recorded_at: string;
      }[]
    >`
      select kernel_version, contract, manifest, recorded_at from storefront_builds
      where tenant_id = ${tenantId} order by recorded_at desc limit 1
    `
  )[0];
  if (!row) return null;
  return {
    kernelVersion: row.kernel_version,
    contract: row.contract,
    sections: row.manifest.sections ?? {},
    recordedAt: row.recorded_at,
  };
}

// ── template migrations ──────────────────────────────────────────────────────

export interface MigrationReportRow {
  tenant: string;
  ring: Ring;
  page: string;
  status: 'applied' | 'skipped' | 'conflict';
  reason?: string;
  fromVersion?: number;
  toVersion?: number;
}

/** Dry run reports what would change; a real run writes a new template version
 *  per applied page (so rollback is just "restore the previous version"). */
export async function runTemplateMigration(
  sql: Sql,
  migration: string | TemplateMigration,
  opts: { dry: boolean; ring?: Ring; tenants?: string[] },
): Promise<MigrationReportRow[]> {
  const m = typeof migration === 'string' ? findMigration(migration) : migration;
  if (!m)
    throw new HttpError(404, 'MIGRATION_NOT_FOUND', `no template migration '${String(migration)}'`);
  const tenants = await sql<{ id: string; slug: string }[]>`
    select id, slug from tenants where status = 'active' order by slug
  `;
  const report: MigrationReportRow[] = [];
  for (const t of tenants) {
    if (opts.tenants && !opts.tenants.includes(t.slug)) continue;
    await withTenant(sql, t.id, async (tx) => {
      const ops = await opsTx(tx, t.id);
      if (opts.ring && ops.ring !== opts.ring) return;
      const build = await latestBuildTx(tx, t.id);
      for (const page of m.pages) {
        // a real run locks the page first so a concurrent edit can't slip between read and write
        if (!opts.dry) await tx`select pg_advisory_xact_lock(hashtext(${`tpl:${t.id}:${page}`}))`;
        const cur = await currentTemplateTx(tx, t.id, page);
        if (!cur) {
          report.push({
            tenant: t.slug,
            ring: ops.ring,
            page,
            status: 'skipped',
            reason: 'no template',
          });
          continue;
        }
        const out = runMigration(m, cur.template, {
          kernelVersion: build?.kernelVersion,
          sections: build?.sections,
        });
        const row: MigrationReportRow = {
          tenant: t.slug,
          ring: ops.ring,
          page,
          status: out.status,
          fromVersion: cur.version,
          ...(out.status !== 'applied' ? { reason: out.reason } : {}),
        };
        if (out.status === 'applied' && !opts.dry) {
          const saved = await saveTemplateTx(tx, t.id, page, out.template, `migration:${m.id}`);
          row.toVersion = saved.version;
        }
        if (!opts.dry)
          await tx`
            insert into template_migration_runs (tenant_id, migration_id, page, status, reason, from_version, to_version)
            values (${t.id}, ${m.id}, ${page}, ${out.status}, ${row.reason ?? null}, ${cur.version}, ${row.toVersion ?? null})
          `;
        report.push(row);
      }
    });
  }
  return report;
}

/** Rolls back every page a migration applied for the given stores — only where
 *  the migration's version is still current (a later edit wins over the undo). */
export async function rollbackTemplateMigration(
  sql: Sql,
  migrationId: string,
  opts: { ring?: Ring; tenants?: string[] },
): Promise<MigrationReportRow[]> {
  const tenants = await sql<{ id: string; slug: string }[]>`
    select id, slug from tenants where status = 'active' order by slug
  `;
  const report: MigrationReportRow[] = [];
  for (const t of tenants) {
    if (opts.tenants && !opts.tenants.includes(t.slug)) continue;
    await withTenant(sql, t.id, async (tx) => {
      const ops = await opsTx(tx, t.id);
      if (opts.ring && ops.ring !== opts.ring) return;
      const runs = await tx<{ page: string; to_version: number; from_version: number }[]>`
        select distinct on (page) page, to_version, from_version from template_migration_runs
        where tenant_id = ${t.id} and migration_id = ${migrationId} and status = 'applied'
        order by page, created_at desc
      `;
      for (const r of runs) {
        const cur = await currentTemplateTx(tx, t.id, r.page as PageId);
        if (!cur || cur.version !== r.to_version) {
          report.push({
            tenant: t.slug,
            ring: ops.ring,
            page: r.page,
            status: 'skipped',
            reason: 'template changed after the migration — leaving it',
          });
          continue;
        }
        const saved = await rollbackTemplateTx(tx, t.id, r.page as PageId, r.from_version);
        await tx`
          insert into template_migration_runs (tenant_id, migration_id, page, status, from_version, to_version)
          values (${t.id}, ${migrationId}, ${r.page}, 'rolled_back', ${r.to_version}, ${saved.version})
        `;
        report.push({
          tenant: t.slug,
          ring: ops.ring,
          page: r.page,
          status: 'applied',
          reason: `rolled back to v${r.from_version}`,
          fromVersion: r.to_version,
          toVersion: saved.version,
        });
      }
    });
  }
  return report;
}

// ── notify-me ────────────────────────────────────────────────────────────────

export async function subscribeNotifyTx(
  tx: Sql,
  tenantId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: { subscribed: true } }> {
  const subject = body.subject;
  if (subject !== 'store' && subject !== 'product')
    throw new HttpError(400, 'INVALID_NOTIFY', "subject must be 'store' or 'product'");
  const contact = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : '';
  if (contact.length < 10 || contact.length > 13)
    throw new HttpError(400, 'INVALID_NOTIFY', 'phone must have 10–13 digits');
  let productId: string | null = null;
  if (subject === 'product') {
    if (typeof body.productId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.productId))
      throw new HttpError(400, 'INVALID_NOTIFY', 'productId required for product subscriptions');
    const hit =
      await tx`select 1 from products where tenant_id = ${tenantId} and id = ${body.productId}`;
    if (!hit[0]) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'product not found');
    productId = body.productId;
  }
  await tx`
    insert into notify_requests (tenant_id, subject, product_id, channel, contact)
    values (${tenantId}, ${subject}, ${productId}, 'whatsapp', ${contact})
    on conflict do nothing
  `;
  return { status: 201, body: { subscribed: true } };
}

// ── analytics beacon ─────────────────────────────────────────────────────────

const EVENT_NAME = /^(custom\.[a-z0-9_.]{1,48}|[a-z][a-z_]{2,31})$/;
export const PLATFORM_EVENTS = new Set([
  'page_view',
  'product_view',
  'add_to_cart',
  'cart_open',
  'checkout_start',
  'checkout_step',
  'payment_submit',
  'order_failed',
  'notice_shown',
  'notice_action',
  'notify_me',
  'slot_error',
  'section_unknown',
]);

/** Lossy by design — invalid events are dropped, never fail the batch. */
export async function ingestEventsTx(tx: Sql, tenantId: string, body: unknown): Promise<number> {
  const b = body as { sessionId?: unknown; events?: unknown } | null;
  const sessionId = typeof b?.sessionId === 'string' ? b.sessionId : '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(sessionId))
    throw new HttpError(400, 'BAD_REQUEST', 'sessionId must be 8–64 url-safe chars');
  if (!Array.isArray(b?.events) || b.events.length > 50)
    throw new HttpError(400, 'BAD_REQUEST', 'events must be an array of ≤ 50');
  const now = Date.now();
  const rows: { name: string; at: Date; props: Record<string, unknown> }[] = [];
  for (const e of b.events as unknown[]) {
    const ev = e as { name?: unknown; at?: unknown; props?: unknown };
    if (typeof ev?.name !== 'string' || !EVENT_NAME.test(ev.name)) continue;
    // `order_placed` is Core's own, authoritative event — clients can't emit it
    if (!ev.name.startsWith('custom.') && !PLATFORM_EVENTS.has(ev.name)) continue;
    const at = typeof ev.at === 'number' && Math.abs(now - ev.at) < 86_400_000 ? ev.at : now;
    const props =
      ev.props && typeof ev.props === 'object' && !Array.isArray(ev.props) ? ev.props : {};
    if (JSON.stringify(props).length > 2048) continue;
    rows.push({ name: ev.name, at: new Date(at), props: props as Record<string, unknown> });
  }
  for (const r of rows)
    await tx`
      insert into analytics_events (tenant_id, name, at, session_id, props)
      values (${tenantId}, ${r.name}, ${r.at}, ${sessionId}, ${tx.json(r.props as never)})
    `;
  return rows.length;
}
