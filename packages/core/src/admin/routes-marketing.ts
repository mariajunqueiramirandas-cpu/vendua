import type { Sql } from '../platform/db.ts';
import { requireFeature } from '../modules/billing/plans.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import {
  COUPON_CODE_RE,
  couponLabel,
  mintCouponTx,
  normalizeCode,
  type CouponRow,
} from '../modules/coupons.ts';
import { readLoyalty, type StoredLoyalty } from '../modules/customer.ts';
import { audit } from './audit.ts';
import { bool, int, isObj, oneOf, optInt, optText, text, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { loadSettings } from './routes-store.ts';
import { storeOrigin } from '../platform/store-origin.ts';

async function couponsView(tx: Sql, tenantId: string) {
  const rows = await tx<
    ({ kind: CouponRow['kind']; value: number; label: string | null } & Record<string, unknown>)[]
  >`
    select c.id, c.code, c.kind, c.value, c.label, c.min_subtotal_cents as "minSubtotalCents",
           c.max_discount_cents as "maxDiscountCents", c.starts_at as "startsAt", c.ends_at as "endsAt",
           c.max_redemptions as "maxRedemptions", c.per_phone_limit as "perPhoneLimit",
           c.first_order_only as "firstOrderOnly", c.active, c.source, c.created_at as "createdAt",
           coalesce(r.n, 0)::int as redemptions, coalesce(r.revenue, 0)::int as "revenueCents",
           coalesce(r.discount, 0)::int as "discountCents"
    from coupons c
    left join (
      select r.coupon_id, count(*) as n, sum(o.total_cents) as revenue, sum(r.discount_cents) as discount
      from coupon_redemptions r join orders o on o.id = r.order_id
      where r.tenant_id = ${tenantId} and o.state not in ('cancelled', 'refunded')
      group by r.coupon_id
    ) r on r.coupon_id = c.id
    where c.tenant_id = ${tenantId} and c.source <> 'loyalty' and c.archived_at is null
    order by c.active desc, c.created_at desc
    limit 200
  `;
  // `label` is the merchant's own words (null = none); displayLabel is what the shopper reads
  return rows.map((r) => ({ ...r, displayLabel: couponLabel(r) }));
}

/** like coupons: reward.label is the merchant's (or null), reward.displayLabel what shoppers read */
function loyaltyView(p: StoredLoyalty | null) {
  return p && { ...p, reward: { ...p.reward, displayLabel: couponLabel(p.reward) } };
}

function date(v: unknown, name: string): Date | null {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(text(v, name, 40));
  if (Number.isNaN(d.getTime()))
    throw new HttpError(422, 'BAD_REQUEST', `${name} must be a date`, { field: name });
  return d;
}

export function mountMarketing(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  admin.get(
    '/marketing',
    read('manager', async (tx, t) => {
      const s = await loadSettings(tx, t.id);
      const loyalty = loyaltyView(readLoyalty(s.loyalty));
      const loyaltyStats = (
        await tx<{ issued: number; redeemed: number }[]>`
          select count(*)::int as issued,
                 count(*) filter (where exists (
                   select 1 from coupon_redemptions r join orders o on o.id = r.order_id
                   where r.coupon_id = c.id and o.state <> 'cancelled'))::int as redeemed
          from coupons c where c.tenant_id = ${t.id} and c.source = 'loyalty'
        `
      )[0]!;
      const waitlist = await tx`
        select p.id as "productId", p.name, p.status, p.stock_quantity as "stockQuantity",
               (select url from product_media m where m.product_id = p.id order by sort limit 1) as "imageUrl",
               count(*)::int as waiting,
               json_agg(json_build_object('contact', n.contact, 'since', n.created_at) order by n.created_at) as contacts
        from notify_requests n join products p on p.id = n.product_id
        where n.tenant_id = ${t.id} and n.subject = 'product' and n.notified_at is null
          and p.deleted_at is null
        group by p.id order by waiting desc limit 50
      `;
      return {
        coupons: await couponsView(tx, t.id),
        loyalty: { program: loyalty, ...loyaltyStats },
        waitlist,
        announcement: s.promo ?? null,
      };
    }),
  );

  admin.post(
    '/coupons',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      const code = normalizeCode(text(body.code, 'code', 32, 3));
      if (!COUPON_CODE_RE.test(code))
        throw new HttpError(422, 'BAD_REQUEST', 'use 3–32 letters, numbers, _ or -', {
          field: 'code',
        });
      const kind = oneOf(body.kind, 'kind', ['percent', 'fixed', 'free_delivery'] as const);
      const value =
        kind === 'free_delivery'
          ? 0
          : int(body.value, 'value', 1, kind === 'percent' ? 100 : 10_000_000);
      const startsAt = date(body.startsAt, 'startsAt');
      const endsAt = date(body.endsAt, 'endsAt');
      if (startsAt && endsAt && endsAt <= startsAt)
        throw new HttpError(422, 'BAD_REQUEST', 'the end is before the start', { field: 'endsAt' });
      await assertCodeFree(tx, t.id, code);
      const row = await mintCouponTx(
        tx,
        t.id,
        {
          code,
          kind,
          value,
          label: optText(body.label, 'label', 120) ?? null,
          minSubtotalCents: optInt(body.minSubtotalCents, 'minSubtotalCents', 0, 10_000_000) ?? 0,
          maxDiscountCents:
            optInt(body.maxDiscountCents, 'maxDiscountCents', 1, 10_000_000) ?? null,
          startsAt,
          endsAt,
          maxRedemptions: optInt(body.maxRedemptions, 'maxRedemptions', 1, 1_000_000) ?? null,
          perPhoneLimit: optInt(body.perPhoneLimit, 'perPhoneLimit', 1, 1000) ?? null,
          firstOrderOnly: body.firstOrderOnly === true,
        },
        'merchant',
      );
      await audit(tx, t.id, m, {
        action: 'coupon.create',
        entity: 'coupon',
        entityId: row.id,
        summary: `criou o cupom ${code}`,
        after: body,
      });
      await emitAdminTx(tx, t.id, 'marketing');
      return { status: 201, body: { coupons: await couponsView(tx, t.id) } };
    }),
  );

  admin.patch(
    '/coupons/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c);
      const set: Record<string, unknown> = {};
      // "desfazer" after apagar: archived: false brings it back as it was (active as sent)
      const restoring = body.archived !== undefined && !bool(body.archived, 'archived');
      if (body.archived === true) throw new HttpError(422, 'BAD_REQUEST', 'use DELETE to archive');
      if (restoring) set.archived_at = null;
      if (body.active !== undefined) set.active = bool(body.active, 'active');
      if (body.label !== undefined) set.label = optText(body.label, 'label', 120) ?? null;
      if (body.endsAt !== undefined) set.ends_at = date(body.endsAt, 'endsAt');
      if (body.maxRedemptions !== undefined)
        set.max_redemptions = optInt(body.maxRedemptions, 'maxRedemptions', 1, 1_000_000) ?? null;
      if (!Object.keys(set).length) throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
      const cur = (
        await tx<{ starts_at: Date | null; archived: boolean }[]>`
          select starts_at, archived_at is not null as archived from coupons
          where tenant_id = ${t.id} and id = ${id} and source <> 'loyalty' for update
        `
      )[0];
      if (!cur || (cur.archived && !restoring))
        throw new HttpError(404, 'COUPON_NOT_FOUND', 'coupon not found');
      if (set.ends_at && cur.starts_at && (set.ends_at as Date) <= cur.starts_at)
        throw new HttpError(422, 'BAD_REQUEST', 'the end is before the start', { field: 'endsAt' });
      const row = (
        await tx<{ code: string }[]>`
          update coupons set ${tx(set as never)} where tenant_id = ${t.id} and id = ${id}
          returning code
        `
      )[0]!;
      await audit(tx, t.id, m, {
        action: restoring ? 'coupon.restore' : 'coupon.update',
        entity: 'coupon',
        entityId: id,
        summary: restoring
          ? `recuperou o cupom ${row.code}`
          : set.active === false
            ? `desativou o cupom ${row.code}`
            : set.active === true
              ? `reativou o cupom ${row.code}`
              : `alterou o cupom ${row.code}`,
        after: body,
      });
      await emitAdminTx(tx, t.id, 'marketing');
      return { status: 200, body: { coupons: await couponsView(tx, t.id) } };
    }),
  );

  // "apagar": archived, so its redemptions (and the reports on them) stay; PATCH archived: false undoes it
  admin.delete(
    '/coupons/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const row = (
        await tx<{ code: string }[]>`
          update coupons set archived_at = now(), active = false
          where tenant_id = ${t.id} and id = ${id} and source <> 'loyalty' and archived_at is null
          returning code
        `
      )[0];
      if (!row) throw new HttpError(404, 'COUPON_NOT_FOUND', 'coupon not found');
      await audit(tx, t.id, m, {
        action: 'coupon.archive',
        entity: 'coupon',
        entityId: id,
        summary: `apagou o cupom ${row.code}`,
      });
      await emitAdminTx(tx, t.id, 'marketing');
      return { status: 200, body: { coupons: await couponsView(tx, t.id) } };
    }),
  );

  // a copy with every rule and a new code; dates already past are left off
  admin.post(
    '/coupons/:id/clone',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c);
      const code = normalizeCode(text(body.code, 'code', 32, 3));
      if (!COUPON_CODE_RE.test(code))
        throw new HttpError(422, 'BAD_REQUEST', 'use 3–32 letters, numbers, _ or -', {
          field: 'code',
        });
      const src = (
        await tx<(CouponRow & { created_at: Date })[]>`
          select id, code, kind, value, label, min_subtotal_cents, max_discount_cents, starts_at, ends_at,
                 max_redemptions, per_phone_limit, first_order_only, phone, source, active, created_at
          from coupons
          where tenant_id = ${t.id} and id = ${id} and source <> 'loyalty' and archived_at is null
        `
      )[0];
      if (!src) throw new HttpError(404, 'COUPON_NOT_FOUND', 'coupon not found');
      // a personal coupon is one shopper's; a copy would hand it to everyone
      if (src.phone)
        throw new HttpError(409, 'COUPON_PERSONAL', 'a personal coupon cannot be copied');
      await assertCodeFree(tx, t.id, code);
      const now = Date.now();
      const future = (d: string | Date | null) => (d && new Date(d).getTime() > now ? d : null);
      const row = await mintCouponTx(
        tx,
        t.id,
        {
          code,
          kind: src.kind,
          value: src.value,
          label: src.label,
          minSubtotalCents: src.min_subtotal_cents,
          maxDiscountCents: src.max_discount_cents,
          startsAt: future(src.starts_at),
          endsAt: future(src.ends_at),
          maxRedemptions: src.max_redemptions,
          perPhoneLimit: src.per_phone_limit,
          firstOrderOnly: src.first_order_only,
        },
        'merchant',
      );
      await audit(tx, t.id, m, {
        action: 'coupon.clone',
        entity: 'coupon',
        entityId: row.id,
        summary: `copiou o cupom ${src.code} como ${row.code}`,
      });
      await emitAdminTx(tx, t.id, 'marketing');
      return {
        status: 201,
        body: { coupon: { id: row.id, code: row.code }, coupons: await couponsView(tx, t.id) },
      };
    }),
  );

  admin.put(
    '/loyalty',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      await loadSettings(tx, t.id);
      const program = body.program === null ? null : readLoyalty(body.program);
      if (body.program !== null && !program)
        throw new HttpError(422, 'BAD_REQUEST', 'the card needs 2–50 stamps and a reward', {
          field: 'program',
        });
      // switching it off is always allowed: a plan without loyalty only blocks turning it on
      if (program) await requireFeature(tx, t.id, 'loyalty');
      await tx`update store_settings set loyalty = ${program ? tx.json(program as never) : null} where tenant_id = ${t.id}`;
      await audit(tx, t.id, m, {
        action: program ? 'loyalty.update' : 'loyalty.off',
        entity: 'loyalty',
        summary: program
          ? `configurou o cartão fidelidade (${program.stampsRequired} selos)`
          : 'desligou o cartão fidelidade',
        after: program,
      });
      await emitAdminTx(tx, t.id, 'marketing');
      return { status: 200, body: { program: loyaltyView(program) } };
    }),
  );

  // the merchant messages them from WhatsApp, then clears the list here
  admin.post(
    '/waitlist/:productId/notified',
    write('manager', async (tx, t, m, c) => {
      const productId = uuidParam(c, 'productId');
      const rows = await tx`
        update notify_requests set notified_at = now()
        where tenant_id = ${t.id} and subject = 'product' and product_id = ${productId} and notified_at is null
        returning id
      `;
      await audit(tx, t.id, m, {
        action: 'waitlist.notified',
        entity: 'product',
        entityId: productId,
        summary: `avisou ${rows.length} pessoas da lista de espera`,
      });
      await emitAdminTx(tx, t.id, 'marketing');
      return { status: 200, body: { notified: rows.length } };
    }),
  );

  admin.put(
    '/announcement',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      await loadSettings(tx, t.id);
      let promo: { title: string; body?: string } | null = null;
      if (body.announcement !== null) {
        const a = isObj(body.announcement) ? body.announcement : {};
        promo = { title: text(a.title, 'title', 80, 2) };
        const b = optText(a.body, 'body', 200);
        if (b) promo.body = b;
      }
      await tx`update store_settings set promo = ${promo ? tx.json(promo) : null} where tenant_id = ${t.id}`;
      await audit(tx, t.id, m, {
        action: promo ? 'announcement.set' : 'announcement.off',
        entity: 'store',
        summary: promo ? `publicou o aviso "${promo.title}"` : 'tirou o aviso da loja',
        after: promo,
      });
      await emitAdminTx(tx, t.id, 'marketing');
      return { status: 200, body: { announcement: promo } };
    }),
  );

  // links to share: the store, and each product at the path the store's build records
  admin.get(
    '/share',
    read('attendant', async (tx, t) => {
      const base = await storeOrigin(tx, t, d.storeDomain);
      const recorded = (
        await tx<{ path: string | null }[]>`
          select manifest -> 'paths' ->> 'product' as path from storefront_builds
          where tenant_id = ${t.id} order by recorded_at desc limit 1
        `
      )[0]?.path;
      // the Kernel's default route unless the store's build recorded its own
      const pattern =
        recorded && /^\/[\w/-]*:slug[\w/-]*$/.test(recorded) ? recorded : '/produto/:slug';
      const products = await tx<
        { id: string; slug: string; name: string; priceCents: number; imageUrl: string | null }[]
      >`
        select p.id, p.slug, p.name, p.base_price_cents as "priceCents",
               (select url from product_media m where m.product_id = p.id order by sort limit 1) as "imageUrl"
        from products p where p.tenant_id = ${t.id} and p.status <> 'archived'
        order by p.sort, p.name limit 300
      `;
      return {
        store: { name: t.name, url: base },
        products: products.map((p) => ({
          ...p,
          url: base + pattern.replace(':slug', encodeURIComponent(p.slug)),
        })),
      };
    }),
  );
}

/** An apagado coupon keeps its code (its orders name it): say so instead of "already exists". */
async function assertCodeFree(tx: Sql, tenantId: string, code: string) {
  const held = (
    await tx<{ archived: boolean }[]>`
      select archived_at is not null as archived from coupons where tenant_id = ${tenantId} and code = ${code}
    `
  )[0];
  if (held?.archived)
    throw new HttpError(409, 'COUPON_ARCHIVED', `${code} belongs to a deleted coupon`, {
      field: 'code',
    });
}
