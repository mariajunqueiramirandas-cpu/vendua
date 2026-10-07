// Writes a validated import document into one tenant, in the caller's transaction
// (docs/menu-import.md §4.4 step 4). The rows are the ones the admin writes; photos, logo and
// cover are only queued here — images.ts re-hosts them, so no source CDN URL is ever stored.

import { paletteFrom, type StorefrontTokens } from '@vendua/templates';
import type { Sql } from '../../platform/db.ts';
import { slugify, type Merchant } from '../../admin/context.ts';
import { audit } from '../../admin/audit.ts';
import { emitAdminTx } from '../../admin/live.ts';
import { loadSettings } from '../../admin/routes-store.ts';
import { readPaymentAdjustments } from '../payment-adjustments.ts';
import { normalizePixKey } from '../pix.ts';
import { instagramHandle, whatsappDigits } from '../store.ts';
import { currentTemplateTx, currentTokensTx, saveTokensTx } from '../storefront-platform.ts';
import type { ImportProduct, MenuImportV1, Section } from './doc.ts';

export interface ApplyOptions {
  mode: 'add' | 'replace';
  sections: Section[];
}

export interface ApplyResult {
  categories: { created: number; reused: number };
  products: number;
  hidden: number;
  archived: number;
  images: number;
  sections: Section[];
}

/** What a store without its own token rows wears: storefronts/_template/vendua.config.ts. */
export const TEMPLATE_TOKENS: StorefrontTokens = {
  color: {
    bg: '#F7F4EA',
    surface: '#FFFDF8',
    text: '#123C32',
    muted: '#4F6A5E',
    accent: '#123C32',
    onAccent: '#FFFDF8',
    danger: '#B3261E',
    success: '#1F7A4D',
  },
  font: {
    display: '"Space Grotesk Variable", system-ui, sans-serif',
    body: '"Figtree Variable", system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  radius: { sm: '10px', md: '16px', lg: '24px' },
  space: { scale: ['4px', '8px', '12px', '16px', '24px', '32px', '48px'] },
  motion: { duration: '180ms', easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
};

const PLATFORM_LABEL: Record<string, string> = {
  instadelivery: 'Instadelivery',
  cardapioweb: 'Cardápio Web',
  olaclick: 'OlaClick',
  deliverydireto: 'Delivery Direto',
  takeat: 'Takeat',
  saipos: 'Saipos',
  goomer: 'Goomer',
};

const CHUNK = 400;

/** Multi-row insert in chunks (Postgres caps a statement at 65 535 parameters). */
async function insertMany<R>(
  tx: Sql,
  table: string,
  rows: Record<string, unknown>[],
  returning: string[],
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    out.push(
      ...((await tx`
        insert into ${tx(table)} ${tx(part as never)} returning ${tx(returning)}
      `) as unknown as R[]),
    );
  }
  return out;
}

/** Same rule as the admin's uniqueSlug, against everything taken so far in this import. */
function slugger(taken: Set<string>) {
  return (base: string) => {
    const root = slugify(base).slice(0, 50);
    let slug = root;
    if (taken.has(slug)) {
      slug = '';
      for (let i = 2; i < 1000 && !slug; i++) if (!taken.has(`${root}-${i}`)) slug = `${root}-${i}`;
      if (!slug) slug = `${root}-${crypto.randomUUID().slice(0, 6)}`;
    }
    taken.add(slug);
    return slug;
  };
}

interface Queued {
  kind: 'product' | 'option' | 'logo' | 'cover';
  product_id: string | null;
  modifier_id: string | null;
  sort: number;
  subject: string | null;
  source_url: string;
  /** logo/cover: what it replaces, so a merchant's own upload meanwhile wins */
  replaces: string | null;
}

export async function applyImport(
  tx: Sql,
  tenantId: string,
  actor: Pick<Merchant, 'name'> & { userId: string | null },
  importId: string,
  doc: MenuImportV1,
  opts: ApplyOptions,
): Promise<ApplyResult> {
  const settings = await loadSettings(tx, tenantId);
  const queue: Queued[] = [];
  let archived = 0;

  if (opts.mode === 'replace') {
    // orders keep pointing at the old products, so they're archived, never deleted
    archived = (
      await tx`
        update products set status = 'archived', sold_out_until = null
        where tenant_id = ${tenantId} and status <> 'archived'
        returning id
      `
    ).length;
  }

  // ── categories: same name receives the products; new ones sort after, in source order
  const existing = await tx<{ id: string; name: string; description: string | null }[]>`
    select id, name, description from categories where tenant_id = ${tenantId}
  `;
  const byName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c]));
  const catSlug = slugger(
    new Set(
      (await tx<{ slug: string }[]>`select slug from categories where tenant_id = ${tenantId}`).map(
        (r) => r.slug,
      ),
    ),
  );
  let catSort =
    (
      await tx<{ max: number | null }[]>`
        select max(sort) as max from categories where tenant_id = ${tenantId}
      `
    )[0]!.max ?? -1;
  const catIds: string[] = [];
  let created = 0;
  let reused = 0;
  for (const c of doc.categories) {
    const hit = byName.get(c.name.trim().toLowerCase());
    if (hit) {
      reused++;
      catIds.push(hit.id);
      if (c.description && !hit.description)
        await tx`update categories set description = ${c.description} where id = ${hit.id} and tenant_id = ${tenantId}`;
      continue;
    }
    const row = (
      await tx<{ id: string }[]>`
        insert into categories (tenant_id, slug, name, description, sort)
        values (${tenantId}, ${catSlug(c.name)}, ${c.name}, ${c.description ?? null}, ${++catSort})
        returning id
      `
    )[0]!;
    created++;
    catIds.push(row.id);
    byName.set(c.name.trim().toLowerCase(), { id: row.id, name: c.name, description: null });
  }

  // ── products, option groups and options, batched per category
  const prodSlug = slugger(
    new Set(
      (await tx<{ slug: string }[]>`select slug from products where tenant_id = ${tenantId}`).map(
        (r) => r.slug,
      ),
    ),
  );
  const sorts = new Map(
    (
      await tx<{ category_id: string; max: number }[]>`
        select category_id, max(sort) as max from products where tenant_id = ${tenantId} group by category_id
      `
    ).map((r) => [r.category_id, r.max]),
  );
  const idByRef = new Map<string, string>();
  const kits: { id: string; p: ImportProduct }[] = [];
  let products = 0;
  let hidden = 0;

  for (const [ci, c] of doc.categories.entries()) {
    const categoryId = catIds[ci]!;
    if (!c.products.length) continue;
    let sort = sorts.get(categoryId) ?? -1;
    const slugs = c.products.map((p) => prodSlug(p.name));
    const rows = c.products.map((p, i) => ({
      tenant_id: tenantId,
      category_id: categoryId,
      slug: slugs[i]!,
      name: p.name,
      description: p.description ?? null,
      base_price_cents: p.priceCents,
      compare_at_price_cents: p.compareAtPriceCents ?? null,
      status: p.status,
      kind: 'simple',
      tags: tx.json(p.tags),
      stock_quantity: p.stockQuantity ?? null,
      availability_schedule: p.availability ? tx.json(p.availability as never) : null,
      promo_schedule: p.promoSchedule ? tx.json(p.promoSchedule as never) : null,
      requires_preorder: !!p.requiresPreorder,
      sort: ++sort,
    }));
    const inserted = await insertMany<{ id: string; slug: string }>(tx, 'products', rows, [
      'id',
      'slug',
    ]);
    const idBySlug = new Map(inserted.map((r) => [r.slug, r.id]));
    const ids = slugs.map((s) => idBySlug.get(s)!);
    products += ids.length;

    const groupRows: Record<string, unknown>[] = [];
    for (const [pi, p] of c.products.entries()) {
      const id = ids[pi]!;
      if (p.ref) idByRef.set(p.ref, id);
      if (p.status === 'archived') hidden++;
      if (p.kit) kits.push({ id, p });
      p.images.forEach((url, i) =>
        queue.push({
          kind: 'product',
          product_id: id,
          modifier_id: null,
          sort: i,
          subject: p.name,
          source_url: url,
          replaces: null,
        }),
      );
      p.optionGroups.forEach((g, gi) =>
        groupRows.push({
          tenant_id: tenantId,
          product_id: id,
          name: g.name,
          required: g.min > 0,
          min_select: g.min,
          max_select: g.max,
          pricing_rule: g.pricingRule ?? 'sum',
          sort: gi,
        }),
      );
    }
    if (!groupRows.length) continue;
    const groups = await insertMany<{ id: string; product_id: string; sort: number }>(
      tx,
      'modifier_groups',
      groupRows,
      ['id', 'product_id', 'sort'],
    );
    const groupId = new Map(groups.map((g) => [`${g.product_id}:${g.sort}`, g.id]));
    const optionRows: Record<string, unknown>[] = [];
    const optionImages: { key: string; url: string; subject: string }[] = [];
    for (const [pi, p] of c.products.entries())
      for (const [gi, g] of p.optionGroups.entries()) {
        const gid = groupId.get(`${ids[pi]}:${gi}`)!;
        g.options.forEach((o, oi) => {
          optionRows.push({
            tenant_id: tenantId,
            group_id: gid,
            name: o.name,
            price_delta_cents: o.priceDeltaCents,
            status: o.soldOut ? 'sold_out' : 'active',
            max_qty: o.maxQty ?? 1,
            description: o.description ?? null,
            sort: oi,
          });
          if (o.imageUrl)
            optionImages.push({ key: `${gid}:${oi}`, url: o.imageUrl, subject: o.name });
        });
      }
    const options = await insertMany<{ id: string; group_id: string; sort: number }>(
      tx,
      'modifiers',
      optionRows,
      ['id', 'group_id', 'sort'],
    );
    const optionId = new Map(options.map((o) => [`${o.group_id}:${o.sort}`, o.id]));
    for (const img of optionImages)
      queue.push({
        kind: 'option',
        product_id: null,
        modifier_id: optionId.get(img.key)!,
        sort: 0,
        subject: img.subject,
        source_url: img.url,
        replaces: null,
      });
  }

  // ── kits last: their slots point at products created above
  for (const { id, p } of kits) {
    for (const [si, slot] of p.kit!.slots.entries()) {
      const slotId = (
        await tx<{ id: string }[]>`
          insert into combo_slots (tenant_id, product_id, name, min_select, max_select, qty_per_item, sort)
          values (${tenantId}, ${id}, ${slot.name}, ${slot.min}, ${slot.max}, ${slot.qtyPerItem ?? 1}, ${si})
          returning id
        `
      )[0]!.id;
      const items = slot.items
        .map((it, ii) => ({
          tenant_id: tenantId,
          slot_id: slotId,
          product_id: idByRef.get(it.ref),
          price_delta_cents: it.priceDeltaCents ?? 0,
          sort: ii,
        }))
        .filter((it) => it.product_id && it.product_id !== id);
      if (items.length)
        await tx`insert into combo_slot_items ${tx(items as never)} on conflict (slot_id, product_id) do nothing`;
    }
    await tx`update products set kind = 'combo' where tenant_id = ${tenantId} and id = ${id}`;
  }

  // ── settings: only the sections the merchant ticked are replaced
  const sections = [...new Set(opts.sections)];
  const set: Record<string, unknown> = {};
  const s = doc.store;
  if (sections.includes('profile')) {
    if (s.name) await tx`update tenants set name = ${s.name} where id = ${tenantId}`;
    if (s.tagline) set.tagline = s.tagline;
    // a document saved before 0072 carries the national number and an @handle
    const whatsapp = whatsappDigits(s.whatsapp);
    if (whatsapp) set.whatsapp = whatsapp;
    const instagram = instagramHandle(s.instagram);
    if (instagram) set.instagram = instagram;
    if (s.address) set.address = s.address;
    if (s.city) set.city = s.city;
    if (s.coords) {
      set.latitude = s.coords.lat;
      set.longitude = s.coords.lng;
    }
    if (s.announcement) set.promo = tx.json(s.announcement);
    if (s.logoUrl)
      queue.push({
        kind: 'logo',
        product_id: null,
        modifier_id: null,
        sort: 0,
        subject: null,
        source_url: s.logoUrl,
        replaces: settings.logo_url ?? null,
      });
    // the cover fills the default home hero; a storefront with its own hero keeps its photo
    const home = s.coverUrl ? await currentTemplateTx(tx, tenantId, 'home') : null;
    const hero = home?.template.sections.find((x) => x.type === 'store:menu-hero');
    if (s.coverUrl && hero)
      queue.push({
        kind: 'cover',
        product_id: null,
        modifier_id: null,
        sort: 0,
        subject: null,
        source_url: s.coverUrl,
        replaces: typeof hero.settings?.cover === 'string' ? hero.settings.cover : null,
      });
    if (s.brandColor) {
      const base = (await currentTokensTx(tx, tenantId))?.tokens ?? TEMPLATE_TOKENS;
      await saveTokensTx(tx, tenantId, paletteFrom(s.brandColor, base), `import:${importId}`);
    }
  }
  if (sections.includes('hours') && doc.hours?.length)
    set.hours = tx.json({
      timezone: settings.hours?.timezone ?? 'America/Sao_Paulo',
      windows: doc.hours,
    } as never);
  if (sections.includes('delivery')) {
    const o = doc.operations ?? {};
    if (o.minOrderCents !== undefined) set.min_order_cents = o.minOrderCents;
    if (o.prepTimeMinutes !== undefined) set.prep_time_minutes = o.prepTimeMinutes;
    const pickup = o.pickup ?? settings.pickup_enabled;
    const delivery = o.delivery ?? settings.delivery_enabled;
    if (pickup || delivery) {
      set.pickup_enabled = pickup;
      set.delivery_enabled = delivery;
    }
    if (doc.zones?.length) {
      await tx`delete from delivery_zones where tenant_id = ${tenantId}`;
      for (const z of doc.zones)
        await tx`
          insert into delivery_zones (tenant_id, name, kind, neighborhoods, polygon, fee_cents, min_order_cents,
            eta_min_minutes, eta_max_minutes, max_distance_km, fee_per_km_cents, free_delivery_over_cents)
          values (${tenantId}, ${z.name}, ${z.kind}, ${tx.json(z.neighborhoods ?? [])},
            ${z.kind === 'polygon' ? tx.json(z.polygon ?? []) : null}, ${z.feeCents}, ${z.minOrderCents ?? 0},
            ${z.etaMin ?? 30}, ${z.etaMax ?? Math.max(60, z.etaMin ?? 0)}, ${z.maxDistanceKm ?? null},
            ${z.feePerKmCents ?? 0}, ${z.freeDeliveryOverCents ?? null})
        `;
    }
  }
  if (sections.includes('payments') && doc.payments) {
    const p = doc.payments;
    // card_online needs Mercado Pago connected first — the merchant turns it on in Pagamentos
    const methods = p.methods.filter((m) => m !== 'card_online');
    if (methods.length) set.payment_methods = tx.json(methods);
    if (p.adjustments)
      set.payment_adjustments = tx.json(readPaymentAdjustments(p.adjustments) as never);
    const key = p.pix ? normalizePixKey(p.pix.key, p.pix.type) : null;
    if (p.pix && key && p.pix.beneficiary.length >= 2) {
      set.pix_key = key;
      set.pix_key_type = p.pix.type;
      set.pix_beneficiary = p.pix.beneficiary;
      set.pix_city = p.pix.city ?? null;
    }
  }
  if (Object.keys(set).length)
    await tx`update store_settings set ${tx(set as never)} where tenant_id = ${tenantId}`;

  if (queue.length)
    await insertMany(
      tx,
      'menu_import_images',
      queue.map((q) => ({ tenant_id: tenantId, import_id: importId, ...q })),
      ['id'],
    );

  const label = PLATFORM_LABEL[doc.source.platform] ?? doc.source.platform;
  await audit(tx, tenantId, actor, {
    action: 'menu.import',
    entity: 'import',
    entityId: importId,
    summary: `importou o cardápio do ${label}: ${products} produto${products === 1 ? '' : 's'}${
      archived ? `, arquivou ${archived}` : ''
    }`,
    after: { mode: opts.mode, sections, products, categories: created, archived },
  });
  await emitAdminTx(tx, tenantId, 'catalog');
  if (sections.length) await emitAdminTx(tx, tenantId, 'store');
  return {
    categories: { created, reused },
    products,
    hidden,
    archived,
    images: queue.length,
    sections,
  };
}
