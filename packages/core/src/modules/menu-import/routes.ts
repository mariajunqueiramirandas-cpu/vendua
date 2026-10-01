// /admin/v1/imports (docs/menu-import.md §4.4): paste a link, read it in the background, preview,
// apply once. Managers and owners; the Pagamentos section is the owner's, as PATCH /payments is.

import type { Sql } from '../../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../../platform/http.ts';
import { oneOf, roleAtLeast, type AdminDeps, type Merchant } from '../../admin/context.ts';
import { handlers } from '../../admin/handlers.ts';
import { emitAdminTx } from '../../admin/live.ts';
import { recognise } from './adapters/index.ts';
import { applyImport, type ApplyResult } from './apply.ts';
import { SECTIONS, type ImportCounts, type Lost, type MenuImportV1, type Section } from './doc.ts';
import { kickImports } from './jobs.ts';

const PER_HOUR = 5;

interface ImportRow {
  id: string;
  platform: string;
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
function preview(doc: MenuImportV1, m: Merchant) {
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
                key: roleAtLeast(m.role, 'owner') ? p.pix.key : maskKey(p.pix.key),
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

async function view(tx: Sql, tenantId: string, r: ImportRow, m: Merchant) {
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
    preview: r.doc && r.status !== 'expired' ? preview(r.doc, m) : null,
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

async function load(tx: Sql, tenantId: string, id: string): Promise<ImportRow> {
  const row = (
    await tx<ImportRow[]>`select * from menu_imports where tenant_id = ${tenantId} and id = ${id}`
  )[0];
  if (!row) throw new HttpError(404, 'IMPORT_NOT_FOUND', 'import not found');
  return row;
}

export function mountImports(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  admin.post(
    '/imports',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c, 4 * 1024);
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
      await tx`select pg_advisory_xact_lock(hashtext(${`menu-import:${t.id}`}))`;
      const reading = (
        await tx<{ id: string }[]>`
          select id from menu_imports where tenant_id = ${t.id} and status = 'reading' limit 1
        `
      )[0];
      if (reading)
        throw new HttpError(409, 'IMPORT_IN_PROGRESS', 'an import is already being read', {
          id: reading.id,
        });
      const recent = (
        await tx<{ n: number }[]>`
          select count(*)::int as n from menu_imports
          where tenant_id = ${t.id} and created_at > now() - interval '1 hour'
        `
      )[0]!.n;
      if (recent >= PER_HOUR)
        throw new HttpError(429, 'IMPORT_RATE_LIMITED', 'too many imports in the last hour');
      const row = (
        await tx<{ id: string }[]>`
          insert into menu_imports (tenant_id, created_by, platform, source_url, source_ref)
          values (${t.id}, ${m.userId}, ${r.adapter.platform}, ${r.url.href.slice(0, 500)}, ${r.ref})
          returning id
        `
      )[0]!;
      await emitAdminTx(tx, t.id, 'import', row.id);
      // the job starts it once this commits; the tick picks it up regardless
      setTimeout(kickImports, 50);
      return { status: 202, body: { id: row.id, platform: r.adapter.platform } };
    }),
  );

  admin.get(
    '/imports',
    read('manager', async (tx, t, m) => {
      const rows = await tx<ImportRow[]>`
        select * from menu_imports where tenant_id = ${t.id} order by created_at desc limit 5
      `;
      return {
        imports: await Promise.all(
          rows.map(async (r) => {
            const v = await view(tx, t.id, r, m);
            // the list is for "pick up where you left off": counts, not whole previews
            return { ...v, preview: null };
          }),
        ),
      };
    }),
  );

  admin.get(
    '/imports/:id',
    read('manager', async (tx, t, m, c) =>
      view(tx, t.id, await load(tx, t.id, uuidParam(c, 'id')), m),
    ),
  );

  admin.post(
    '/imports/:id/apply',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c, 4 * 1024);
      const mode = oneOf(body.mode ?? 'add', 'mode', ['add', 'replace'] as const);
      if (!Array.isArray(body.sections) || body.sections.length > SECTIONS.length)
        throw new HttpError(422, 'BAD_REQUEST', 'sections must be a list', { field: 'sections' });
      const sections = [
        ...new Set(body.sections.map((s, i) => oneOf(s, `sections[${i}]`, SECTIONS))),
      ];
      if (sections.includes('payments') && !roleAtLeast(m.role, 'owner'))
        throw new HttpError(403, 'FORBIDDEN', 'only the owner changes payments', {
          need: 'owner',
        });
      // the guarded transition: a double tap applies once, a second apply is a 409
      const row = (
        await tx<ImportRow[]>`
          update menu_imports set status = 'applying'
          where tenant_id = ${t.id} and id = ${id} and status = 'ready'
          returning *
        `
      )[0];
      if (!row) {
        const cur = await load(tx, t.id, id);
        throw new HttpError(409, 'IMPORT_NOT_READY', `this import is ${cur.status}`, {
          status: cur.status,
        });
      }
      if (!row.doc) throw new HttpError(409, 'IMPORT_NOT_READY', 'this import expired');
      const result = await applyImport(tx, t.id, m, id, row.doc, { mode, sections });
      const done = (
        await tx<ImportRow[]>`
          update menu_imports set status = 'applied', mode = ${mode}, sections = ${tx.json(sections)},
            result = ${tx.json(result as never)}, images_total = ${result.images}, images_done = 0,
            applied_at = now(), finished_at = ${result.images ? null : tx`now()`}
          where tenant_id = ${t.id} and id = ${id}
          returning *
        `
      )[0]!;
      await emitAdminTx(tx, t.id, 'import', id);
      if (result.images) setTimeout(kickImports, 50);
      return { status: 200, body: await view(tx, t.id, done, m) };
    }),
  );

  admin.post(
    '/imports/:id/discard',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const row = (
        await tx<ImportRow[]>`
          update menu_imports set status = 'expired', doc = null, lease_until = null
          where tenant_id = ${t.id} and id = ${id} and status in ('reading', 'ready', 'failed')
          returning *
        `
      )[0];
      if (!row) {
        const cur = await load(tx, t.id, id);
        if (cur.status !== 'expired')
          throw new HttpError(409, 'IMPORT_NOT_READY', `this import is ${cur.status}`, {
            status: cur.status,
          });
        return { status: 200, body: await view(tx, t.id, cur, m) };
      }
      await emitAdminTx(tx, t.id, 'import', id);
      return { status: 200, body: await view(tx, t.id, row, m) };
    }),
  );
}
