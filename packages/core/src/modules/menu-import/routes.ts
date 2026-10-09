// /admin/v1/imports (docs/menu-import.md §4.4): paste a link, read it in the background, preview,
// apply once. Managers and owners; the Pagamentos section is the owner's, as PATCH /payments is.

import type { Sql } from '../../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../../platform/http.ts';
import { oneOf, roleAtLeast, type AdminDeps, type Merchant } from '../../admin/context.ts';
import { handlers } from '../../admin/handlers.ts';
import { emitAdminTx } from '../../admin/live.ts';
import { recognise } from './adapters/index.ts';
import { applyImport, type ApplyOptions, type ApplyResult } from './apply.ts';
import { SECTIONS, type ImportCounts, type Lost, type MenuImportV1, type Section } from './doc.ts';
import { kickImports } from './jobs.ts';

const PER_HOUR = 5;

interface ImportRow {
  id: string;
  /** null while a custom domain waits to be placed (custom-domain.ts) */
  platform: string | null;
  source_url: string;
  status: 'reading' | 'ready' | 'failed' | 'applying' | 'applied' | 'expired';
  error_code: string | null;
  doc: MenuImportV1 | null;
  counts: ImportCounts | null;
  mode: 'add' | 'replace' | null;
  sections: Section[] | null;
  result: ApplyResult | null;
  images_total: number;
  images_done: number;
  created_at: string;
  read_at: string | null;
  applied_at: string | null;
  finished_at: string | null;
}

/** "43360004000193" → "4336••••••0193": a manager sees which key, not the key. */
function maskKey(key: string) {
  if (key.length <= 6) return '••••';
  return `${key.slice(0, 4)}${'•'.repeat(Math.min(10, key.length - 8))}${key.slice(-4)}`;
}

/** The preview: what the merchant confirms. Source thumbnails are the platform's CDN links. */
function preview(doc: MenuImportV1, seePix: boolean) {
  const p = doc.payments;
  return {
    store: doc.store,
    hours: doc.hours ?? [],
    operations: doc.operations ?? {},
    zones: (doc.zones ?? []).map((z) => ({
      name: z.name,
      kind: z.kind,
      feeCents: z.feeCents,
      feePerKmCents: z.feePerKmCents ?? 0,
      neighborhoods: z.neighborhoods?.length ?? 0,
      maxDistanceKm: z.maxDistanceKm ?? null,
      etaMin: z.etaMin ?? null,
      etaMax: z.etaMax ?? null,
      freeDeliveryOverCents: z.freeDeliveryOverCents ?? null,
    })),
    payments: p
      ? {
          methods: p.methods,
          adjustments: p.adjustments ?? {},
          pix: p.pix
            ? {
                type: p.pix.type,
                key: seePix ? p.pix.key : maskKey(p.pix.key),
                beneficiary: p.pix.beneficiary,
                city: p.pix.city ?? null,
              }
            : null,
        }
      : null,
    categories: doc.categories.map((c) => ({
      name: c.name,
      description: c.description ?? null,
      products: c.products.map((pr) => ({
        name: pr.name,
        description: pr.description ?? null,
        priceCents: pr.priceCents,
        compareAtPriceCents: pr.compareAtPriceCents ?? null,
        status: pr.status,
        stockQuantity: pr.stockQuantity ?? null,
        tags: pr.tags,
        image: pr.images[0] ?? null,
        photos: pr.images.length,
        optionGroups: pr.optionGroups.map((g) => ({
          name: g.name,
          min: g.min,
          max: g.max,
          options: g.options.length,
        })),
        scheduled: !!pr.availability,
      })),
    })),
  };
}

export async function importView(tx: Sql, tenantId: string, r: ImportRow, seePix: boolean) {
  // a re-hosted cover narrower than a phone hero looks soft: suggest a better one (§7)
  const cover =
    r.status === 'applied'
      ? (
          await tx<{ width: number | null }[]>`
            select o.width from menu_import_images i join media_objects o on o.id = i.media_id
            where i.tenant_id = ${tenantId} and i.import_id = ${r.id} and i.kind = 'cover' and i.status = 'done'
          `
        )[0]
      : undefined;
  const failed =
    r.status === 'applied'
      ? await tx<{ kind: string; subject: string | null; error: string | null }[]>`
          select kind, subject, error from menu_import_images
          where tenant_id = ${tenantId} and import_id = ${r.id} and status = 'failed'
          order by created_at, sort limit 100
        `
      : [];
  const lost: Lost[] = [
    ...(r.doc?.lost ?? []),
    ...failed.map((f): Lost =>
      f.kind === 'product' || f.kind === 'option'
        ? { scope: 'product', ...(f.subject ? { subject: f.subject } : {}), code: 'photo_failed' }
        : { scope: 'store', code: f.kind === 'logo' ? 'logo_failed' : 'cover_failed' },
    ),
    ...(cover?.width && cover.width < 1000
      ? [{ scope: 'store' as const, code: 'cover_small', detail: String(cover.width) }]
      : []),
  ];
  return {
    id: r.id,
    platform: r.platform,
    sourceUrl: r.source_url,
    status: r.status,
    errorCode: r.error_code,
    createdAt: r.created_at,
    readAt: r.read_at,
    appliedAt: r.applied_at,
    counts: r.counts,
    preview: r.doc && r.status !== 'expired' ? preview(r.doc, seePix) : null,
    lost,
    mode: r.mode,
    sections: r.sections,
    result: r.result,
    images: {
      total: r.images_total,
      done: r.images_done,
      failed: failed.length,
      finished: r.images_total === 0 ? r.status === 'applied' : !!r.finished_at,
    },
  };
}

export async function loadImport(tx: Sql, tenantId: string, id: string): Promise<ImportRow> {
  const row = (
    await tx<ImportRow[]>`select * from menu_imports where tenant_id = ${tenantId} and id = ${id}`
  )[0];
  if (!row) throw new HttpError(404, 'IMPORT_NOT_FOUND', 'import not found');
  return row;
}

type Actor = { userId: string | null; name: string };

/** A pasted link → a `reading` row the job picks up; refusals are stable 4xx. */
export async function startImportTx(
  tx: Sql,
  tenantId: string,
  createdBy: string | null,
  body: Record<string, unknown>,
): Promise<{ id: string; platform: string | null }> {
  if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > 500)
    throw new HttpError(422, 'BAD_REQUEST', 'paste the link to your store', { field: 'url' });
  const r = recognise(body.url);
  if (r.kind === 'invalid')
    throw new HttpError(422, 'BAD_REQUEST', 'that does not look like a link', { field: 'url' });
  if (r.kind === 'blocked')
    throw new HttpError(422, 'IMPORT_BLOCKED', 'this platform does not let us read its menus', {
      platform: r.platform,
    });
  if (r.kind === 'unsupported')
    throw new HttpError(422, 'IMPORT_UNSUPPORTED', 'we cannot read menus from this link yet', {
      platform: r.platform,
    });
  // one in flight per store, a handful an hour
  await tx`select pg_advisory_xact_lock(hashtext(${`menu-import:${tenantId}`}))`;
  const reading = (
    await tx<{ id: string }[]>`
      select id from menu_imports where tenant_id = ${tenantId} and status = 'reading' limit 1
    `
  )[0];
  if (reading)
    throw new HttpError(409, 'IMPORT_IN_PROGRESS', 'an import is already being read', {
      id: reading.id,
    });
  const recent = (
    await tx<{ n: number }[]>`
      select count(*)::int as n from menu_imports
      where tenant_id = ${tenantId} and created_at > now() - interval '1 hour'
    `
  )[0]!.n;
  if (recent >= PER_HOUR)
    throw new HttpError(429, 'IMPORT_RATE_LIMITED', 'too many imports in the last hour');
  // a custom domain is read as a host; the job places it on a platform first
  const platform = r.kind === 'ok' ? r.adapter.platform : null;
  const row = (
    await tx<{ id: string }[]>`
      insert into menu_imports (tenant_id, created_by, platform, source_url, source_ref)
      values (${tenantId}, ${createdBy}, ${platform}, ${r.url.href.slice(0, 500)},
        ${r.kind === 'ok' ? r.ref : r.host})
      returning id
    `
  )[0]!;
  await emitAdminTx(tx, tenantId, 'import', row.id);
  // the job starts it once this commits; the tick picks it up regardless
  setTimeout(kickImports, 50);
  return { id: row.id, platform };
}

/** The apply body: mode + sections. Pagamentos only for whoever may change payments. */
export function parseApply(body: Record<string, unknown>, mayPayments: boolean): ApplyOptions {
  const mode = oneOf(body.mode ?? 'add', 'mode', ['add', 'replace'] as const);
  if (!Array.isArray(body.sections) || body.sections.length > SECTIONS.length)
    throw new HttpError(422, 'BAD_REQUEST', 'sections must be a list', { field: 'sections' });
  const sections = [...new Set(body.sections.map((s, i) => oneOf(s, `sections[${i}]`, SECTIONS)))];
  if (sections.includes('payments') && !mayPayments)
    throw new HttpError(403, 'FORBIDDEN', 'only the owner changes payments', { need: 'owner' });
  return { mode, sections };
}

/** ready → applying → applied in the caller's tx: a double tap applies once, a second is a 409. */
export async function applyImportTx(
  tx: Sql,
  tenantId: string,
  actor: Actor,
  id: string,
  opts: ApplyOptions,
  seePix: boolean,
) {
  // one apply per store at a time; slugs and "same name" categories read a snapshot
  await tx`select pg_advisory_xact_lock(hashtext(${`menu-import:${tenantId}`}))`;
  const row = (
    await tx<ImportRow[]>`
      update menu_imports set status = 'applying'
      where tenant_id = ${tenantId} and id = ${id} and status = 'ready'
      returning *
    `
  )[0];
  if (!row) {
    const cur = await loadImport(tx, tenantId, id);
    throw new HttpError(409, 'IMPORT_NOT_READY', `this import is ${cur.status}`, {
      status: cur.status,
    });
  }
  if (!row.doc) throw new HttpError(409, 'IMPORT_NOT_READY', 'this import expired');
  // replace archives the live menu: a read that came back empty would leave the store with nothing
  if (
    opts.mode === 'replace' &&
    !row.doc.categories.some((c) => c.products.some((p) => p.status !== 'archived'))
  )
    throw new HttpError(422, 'IMPORT_EMPTY', 'nothing to import: the menu read has no products');
  const result = await applyImport(tx, tenantId, actor, id, row.doc, opts);
  // another preview of the old store would apply the same menu twice
  await tx`
    update menu_imports set status = 'expired', doc = null
    where tenant_id = ${tenantId} and status = 'ready' and id <> ${id}
  `;
  const done = (
    await tx<ImportRow[]>`
      update menu_imports set status = 'applied', mode = ${opts.mode}, sections = ${tx.json(opts.sections)},
        result = ${tx.json(result as never)}, images_total = ${result.images}, images_done = 0,
        applied_at = now(), finished_at = ${result.images ? null : tx`now()`}
      where tenant_id = ${tenantId} and id = ${id}
      returning *
    `
  )[0]!;
  await emitAdminTx(tx, tenantId, 'import', id);
  if (result.images) setTimeout(kickImports, 50);
  return importView(tx, tenantId, done, seePix);
}

/** Cancels a read or drops a preview; an expired one answers as it is. */
export async function discardImportTx(tx: Sql, tenantId: string, id: string, seePix: boolean) {
  const row = (
    await tx<ImportRow[]>`
      update menu_imports set status = 'expired', doc = null, lease_until = null
      where tenant_id = ${tenantId} and id = ${id} and status in ('reading', 'ready', 'failed')
      returning *
    `
  )[0];
  if (!row) {
    const cur = await loadImport(tx, tenantId, id);
    if (cur.status !== 'expired')
      throw new HttpError(409, 'IMPORT_NOT_READY', `this import is ${cur.status}`, {
        status: cur.status,
      });
    return importView(tx, tenantId, cur, seePix);
  }
  await emitAdminTx(tx, tenantId, 'import', id);
  return importView(tx, tenantId, row, seePix);
}

/** The last five, for "pick up where you left off": counts, not whole previews. */
export async function listImportsTx(tx: Sql, tenantId: string, seePix: boolean) {
  const rows = await tx<ImportRow[]>`
    select * from menu_imports where tenant_id = ${tenantId} order by created_at desc limit 5
  `;
  return Promise.all(
    rows.map(async (r) => ({ ...(await importView(tx, tenantId, r, seePix)), preview: null })),
  );
}

export function mountImports(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);
  const owner = (m: Merchant) => roleAtLeast(m.role, 'owner');

  admin.post(
    '/imports',
    write('manager', async (tx, t, m, c) => ({
      status: 202,
      body: await startImportTx(tx, t.id, m.userId, await bodyJson(c, 4 * 1024)),
    })),
  );

  admin.get(
    '/imports',
    read('manager', async (tx, t, m) => ({ imports: await listImportsTx(tx, t.id, owner(m)) })),
  );

  admin.get(
    '/imports/:id',
    read('manager', async (tx, t, m, c) =>
      importView(tx, t.id, await loadImport(tx, t.id, uuidParam(c, 'id')), owner(m)),
    ),
  );

  admin.post(
    '/imports/:id/apply',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const opts = parseApply(await bodyJson(c, 4 * 1024), owner(m));
      return { status: 200, body: await applyImportTx(tx, t.id, m, id, opts, owner(m)) };
    }),
  );

  admin.post(
    '/imports/:id/discard',
    write('manager', async (tx, t, m, c) => ({
      status: 200,
      body: await discardImportTx(tx, t.id, uuidParam(c, 'id'), owner(m)),
    })),
  );
}
