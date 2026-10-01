// Re-hosts an import's photos, logo and cover (docs/menu-import.md §4.4 step 5): downloaded from
// the adapter's image hosts only, re-encoded by the admin's own pipeline (WebP + variants, no
// metadata), stored as media_objects, then pointed at. A source CDN URL is never stored: it dies
// when the merchant cancels the old plan.

import { withTenant, type Sql } from '../../platform/db.ts';
import { processImage } from '../../admin/media.ts';
import { emitAdminTx } from '../../admin/live.ts';
import { currentTemplateTx, saveTemplateTx } from '../storefront-platform.ts';
import { adapterFor } from './adapters/index.ts';
import { fetchImage, ImportFailure } from './http.ts';

export interface ImageJob {
  id: string;
  tenant_id: string;
  import_id: string;
  kind: 'product' | 'option' | 'logo' | 'cover';
  product_id: string | null;
  modifier_id: string | null;
  sort: number;
  subject: string | null;
  source_url: string;
  replaces: string | null;
  attempts: number;
}

export const IMAGE_ATTEMPTS = 3;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** The home template with the hero's cover set; null when there's no hero, 'kept' when the
 *  merchant changed the cover after the import. */
async function withCover(tx: Sql, tenantId: string, url: string, replaces: string | null) {
  const cur = await currentTemplateTx(tx, tenantId, 'home');
  const sections = cur?.template.sections ?? [];
  const hero = sections.findIndex((s) => s.type === 'store:menu-hero');
  if (!cur || hero < 0) return null;
  const now = sections[hero]!.settings?.cover;
  if ((typeof now === 'string' ? now : null) !== replaces) return 'kept' as const;
  return {
    ...cur.template,
    sections: sections.map((s, i) =>
      i === hero ? { ...s, settings: { ...(s.settings ?? {}), cover: url } } : s,
    ),
  };
}

/** Marks the job done or failed and moves the import's progress, in the caller's tx. */
async function finishTx(
  tx: Sql,
  job: ImageJob,
  outcome: { mediaId: string } | { error: string } | { kept: true },
): Promise<boolean> {
  const moved = (
    await tx`
      update menu_import_images
      set status = ${'error' in outcome ? 'failed' : 'done'},
          media_id = ${'mediaId' in outcome ? outcome.mediaId : null},
          error = ${'error' in outcome ? outcome.error.slice(0, 200) : 'kept' in outcome ? 'kept the store’s own' : null},
          lease_until = null
      where id = ${job.id} and tenant_id = ${job.tenant_id} and status = 'pending'
      returning id
    `
  ).length;
  if (!moved) return false;
  await tx`
    update menu_imports set
      images_done = least(images_total, images_done + 1),
      finished_at = case when images_done + 1 >= images_total then now() else finished_at end
    where id = ${job.import_id} and tenant_id = ${job.tenant_id}
  `;
  await emitAdminTx(tx, job.tenant_id, 'import', job.import_id);
  return true;
}

const fail = (sql: Sql, job: ImageJob, error: string) =>
  withTenant(sql, job.tenant_id, (tx) => finishTx(tx, job, { error }));

/**
 * One queued image, end to end. Retries a transient failure (timeout, a 429) up to
 * IMAGE_ATTEMPTS; anything else marks it failed and the product keeps its figure fallback.
 */
export async function runImageJob(sql: Sql, job: ImageJob, fetcher?: Fetch): Promise<void> {
  const platform = await withTenant(
    sql,
    job.tenant_id,
    async (tx) =>
      (
        await tx<{ platform: string; created_by: string | null }[]>`
          select platform, created_by from menu_imports where id = ${job.import_id} and tenant_id = ${job.tenant_id}
        `
      )[0],
  );
  const adapter = platform ? adapterFor(platform.platform) : null;
  if (!adapter) {
    await fail(sql, job, 'no adapter');
    return;
  }

  let img: Awaited<ReturnType<typeof processImage>>;
  try {
    const got = await fetchImage(
      job.source_url,
      adapter.hosts.images,
      fetcher ? { fetch: fetcher } : {},
    );
    img = await processImage(got.bytes);
  } catch (e) {
    const code = e instanceof ImportFailure ? e.code : 'UNREADABLE';
    const transient = code === 'TIMEOUT' || (code === 'BLOCKED' && /429|503/.test(String(e)));
    if (transient && job.attempts < IMAGE_ATTEMPTS) {
      // let the lease lapse; the next claim retries it
      return;
    }
    await fail(sql, job, e instanceof ImportFailure ? `${e.code}: ${e.message}` : 'not an image');
    return;
  }

  await withTenant(sql, job.tenant_id, async (tx) => {
    const still = (
      await tx`select 1 from menu_import_images where id = ${job.id} and status = 'pending' for update`
    ).length;
    if (!still) return;
    const id = crypto.randomUUID();
    const url = `/v1/media/${job.tenant_id}/${id}.webp`;
    const cover =
      job.kind === 'cover' ? await withCover(tx, job.tenant_id, url, job.replaces) : null;
    if (job.kind === 'cover' && !cover) {
      await finishTx(tx, job, { error: 'the home page has no cover to fill' });
      return;
    }
    // the merchant set their own logo or cover after importing: theirs stays
    const logoNow =
      job.kind === 'logo'
        ? ((
            await tx<{ logo_url: string | null }[]>`
              select logo_url from store_settings where tenant_id = ${job.tenant_id}
            `
          )[0]?.logo_url ?? null)
        : null;
    if (cover === 'kept' || (job.kind === 'logo' && logoNow !== job.replaces)) {
      await finishTx(tx, job, { kept: true });
      return;
    }
    await tx`
      insert into media_objects (id, tenant_id, mime, bytes, width, height, created_by)
      values (${id}, ${job.tenant_id}, 'image/webp', ${img.bytes}, ${img.width}, ${img.height}, ${platform!.created_by})
    `;
    for (const v of img.variants)
      await tx`
        insert into media_variants (tenant_id, media_id, width, mime, bytes)
        values (${job.tenant_id}, ${id}, ${v.width}, 'image/webp', ${v.bytes})
      `;
    if (job.kind === 'product' && job.product_id) {
      await tx`
        insert into product_media (tenant_id, product_id, url, alt, width, height, sort)
        select ${job.tenant_id}, id, ${url}, ${job.subject?.slice(0, 200) ?? null}, ${img.width}, ${img.height}, ${job.sort}
        from products where tenant_id = ${job.tenant_id} and id = ${job.product_id}
      `;
      await emitAdminTx(tx, job.tenant_id, 'catalog', job.product_id);
    } else if (job.kind === 'option' && job.modifier_id) {
      await tx`update modifiers set image_url = ${url} where tenant_id = ${job.tenant_id} and id = ${job.modifier_id}`;
      await emitAdminTx(tx, job.tenant_id, 'catalog');
    } else if (job.kind === 'logo') {
      await tx`update store_settings set logo_url = ${url} where tenant_id = ${job.tenant_id}`;
      await emitAdminTx(tx, job.tenant_id, 'store');
    } else if (cover) {
      await saveTemplateTx(tx, job.tenant_id, 'home', cover, `import:${job.import_id}`);
      await emitAdminTx(tx, job.tenant_id, 'appearance');
    }
    await finishTx(tx, job, { mediaId: id });
  });
}
