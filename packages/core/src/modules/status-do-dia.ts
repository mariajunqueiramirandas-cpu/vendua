import { brl } from './discord/format.ts';
import { getProductsById, storeTimezone } from './catalog.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { storeOrigin } from '../platform/store-origin.ts';

// Status do dia S1 (docs/features/status-do-dia.md, 0124): each day, at the hour the owner
// picked, Core prepares the store's WhatsApp Status — up to three products available now, each
// with its price from the catalog and a link carrying the post's `ref` — and the owner posts it
// from the phone with the share sheet. Nothing goes over the store's WhatsApp transport (ADR 0026).
// The images are drawn in the admin from strings Core gives; every number comes from here.

export const STATUS_PICKS = 3;
const CAPTION_MAX = 300;
const REF_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export interface StatusPlan {
  enabled: boolean;
  /** HH:MM, the store's time */
  postAt: string;
  /** 0 = Sunday */
  days: number[];
  mode: 'auto' | 'pinned';
  picks: string[];
  /** the owner's words; null = Core's default */
  caption: string | null;
}

const DEFAULT_PLAN: StatusPlan = {
  enabled: false,
  postAt: '10:30',
  days: [0, 1, 2, 3, 4, 5, 6],
  mode: 'auto',
  picks: [],
  caption: null,
};

export async function statusPlanTx(tx: Sql, tenantId: string): Promise<StatusPlan> {
  const [r] = await tx<
    {
      enabled: boolean;
      post_at: string;
      days: number[];
      mode: 'auto' | 'pinned';
      picks: string[];
      caption: string | null;
    }[]
  >`select enabled, to_char(post_at, 'HH24:MI') as post_at, days, mode, picks, caption
    from status_plans where tenant_id = ${tenantId}`;
  if (!r) return DEFAULT_PLAN;
  return {
    enabled: r.enabled,
    postAt: r.post_at,
    days: r.days,
    mode: r.mode,
    picks: r.picks,
    caption: r.caption,
  };
}

/** The plan's editable fields, validated; unknown or malformed → 422 with the field. */
export function parsePlanPatch(body: Record<string, unknown>): Partial<StatusPlan> {
  const out: Partial<StatusPlan> = {};
  const bad = (field: string, msg: string) => {
    throw new HttpError(422, 'BAD_REQUEST', msg, { field });
  };
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') bad('enabled', 'enabled must be a boolean');
    out.enabled = body.enabled as boolean;
  }
  if (body.postAt !== undefined) {
    if (typeof body.postAt !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.postAt))
      bad('postAt', 'postAt must be HH:MM');
    out.postAt = body.postAt as string;
  }
  if (body.days !== undefined) {
    const d = body.days;
    if (
      !Array.isArray(d) ||
      d.length > 7 ||
      !d.every((x) => Number.isInteger(x) && x >= 0 && x <= 6)
    )
      bad('days', 'days must be weekdays 0–6');
    out.days = [...new Set(d as number[])].sort();
  }
  if (body.mode !== undefined) {
    if (body.mode !== 'auto' && body.mode !== 'pinned')
      bad('mode', "mode must be 'auto' or 'pinned'");
    out.mode = body.mode as 'auto' | 'pinned';
  }
  if (body.picks !== undefined) {
    const p = body.picks;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      !Array.isArray(p) ||
      p.length > STATUS_PICKS ||
      !p.every((x) => typeof x === 'string' && UUID.test(x))
    )
      bad('picks', `picks must be up to ${STATUS_PICKS} product ids`);
    out.picks = [...new Set(p as string[])];
  }
  if (body.caption !== undefined) {
    if (body.caption !== null && typeof body.caption !== 'string')
      bad('caption', 'caption must be a string or null');
    const c = typeof body.caption === 'string' ? body.caption.trim() : '';
    if (c.length > CAPTION_MAX) bad('caption', `caption is at most ${CAPTION_MAX} characters`);
    out.caption = c || null;
  }
  return out;
}

export async function savePlanTx(tx: Sql, tenantId: string, patch: Partial<StatusPlan>) {
  const p = { ...(await statusPlanTx(tx, tenantId)), ...patch };
  await tx`
    insert into status_plans (tenant_id, enabled, post_at, days, mode, picks, caption, updated_at)
    values (${tenantId}, ${p.enabled}, ${p.postAt}::time, ${p.days}::int[], ${p.mode},
            ${p.picks}::uuid[], ${p.caption}, now())
    on conflict (tenant_id) do update set enabled = excluded.enabled, post_at = excluded.post_at,
      days = excluded.days, mode = excluded.mode, picks = excluded.picks,
      caption = excluded.caption, updated_at = now()`;
  return p;
}

const refCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
};

/**
 * Today's products, available right now. Pinned picks first (when the plan pins them), then the
 * catalog ranked by what sells on this weekday over the last 28 days, products not posted in the
 * last 3 days and with a photo ahead.
 */
export async function pickProductsTx(
  tx: Sql,
  tenantId: string,
  now: Date,
  plan: StatusPlan,
): Promise<string[]> {
  const tz = await storeTimezone(tx, tenantId);
  const ranked = await tx<{ id: string }[]>`
    select p.id from products p
    left join lateral (
      select coalesce(sum(i.qty) filter (
               where extract(dow from o.placed_at at time zone ${tz})
                   = extract(dow from ${now}::timestamptz at time zone ${tz})), 0) as same_day,
             coalesce(sum(i.qty), 0) as all_qty
      from order_items i join orders o on o.id = i.order_id
      where i.tenant_id = ${tenantId} and i.product_id = p.id
        and o.placed_at > ${now}::timestamptz - interval '28 days'
        and o.state not in ('cancelled', 'refunded')
    ) s on true
    where p.tenant_id = ${tenantId} and p.status = 'active'
    order by
      exists (select 1 from status_posts sp where sp.tenant_id = ${tenantId}
                and p.id = any(sp.product_ids)
                and sp.day > (${now}::timestamptz at time zone ${tz})::date - 3),
      not exists (select 1 from product_media m where m.product_id = p.id),
      s.same_day desc, s.all_qty desc, p.sort, p.name
    limit 24`;
  const wanted = [
    ...(plan.mode === 'pinned' ? plan.picks : []),
    ...ranked.map((r) => r.id).filter((id) => !(plan.mode === 'pinned' && plan.picks.includes(id))),
  ];
  const detail = await getProductsById(tx, tenantId, wanted, { tz });
  // orderable now: not sold out, inside its schedule (getProductsById reads both into status)
  return wanted.filter((id) => detail.get(id)?.status === 'active').slice(0, STATUS_PICKS);
}

function joinNames(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : (names[0] ?? '');
}

/** The caption the owner pastes: their words (or Core's), then the post's link. */
export function statusCaption(words: string | null, names: string[], url: string): string {
  const text = words?.trim() || `Hoje tem ${joinNames(names)} 😋 Peça pelo link:`;
  return `${text.slice(0, CAPTION_MAX)} ${url}`;
}

/** Today's post in the store's day, prepared now if it isn't yet. null = nothing to post. */
export async function prepareTodayTx(
  tx: Sql,
  tenant: { id: string; slug: string },
  storeDomain: string,
  now = new Date(),
): Promise<string | null> {
  const tz = await storeTimezone(tx, tenant.id);
  const [d] = await tx<{ day: string }[]>`
    select ((${now}::timestamptz at time zone ${tz})::date)::text as day`;
  const day = d!.day;
  const [have] = await tx<{ id: string }[]>`
    select id from status_posts where tenant_id = ${tenant.id} and day = ${day}::date`;
  if (have) return have.id;
  const plan = await statusPlanTx(tx, tenant.id);
  const ids = await pickProductsTx(tx, tenant.id, now, plan);
  if (!ids.length) return null;
  const detail = await getProductsById(tx, tenant.id, ids, { tz });
  const ref = refCode();
  const origin = await storeOrigin(tx, tenant, storeDomain);
  const caption = statusCaption(
    plan.caption,
    ids.map((id) => detail.get(id)!.name),
    `${origin}/?ref=${ref}`,
  );
  const [row] = await tx<{ id: string }[]>`
    insert into status_posts (tenant_id, day, product_ids, ref_code, caption)
    values (${tenant.id}, ${day}::date, ${ids}::uuid[], ${ref}, ${caption})
    on conflict (tenant_id, day) do nothing
    returning id`;
  if (row) return row.id;
  const [other] = await tx<{ id: string }[]>`
    select id from status_posts where tenant_id = ${tenant.id} and day = ${day}::date`;
  return other?.id ?? null;
}

/** The product route the store's build recorded, else the Kernel's default. */
async function productPathTx(tx: Sql, tenantId: string): Promise<string> {
  const [r] = await tx<{ path: string | null }[]>`
    select manifest -> 'paths' ->> 'product' as path from storefront_builds
    where tenant_id = ${tenantId} order by recorded_at desc limit 1`;
  const recorded = r?.path;
  return recorded && /^\/[\w/-]*:slug[\w/-]*$/.test(recorded) ? recorded : '/produto/:slug';
}

export async function statusViewTx(
  tx: Sql,
  tenant: { id: string; slug: string; name: string },
  storeDomain: string,
) {
  const tz = await storeTimezone(tx, tenant.id);
  const [plan, posts, origin, path] = await Promise.all([
    statusPlanTx(tx, tenant.id),
    tx<
      {
        id: string;
        day: string;
        product_ids: string[];
        ref_code: string;
        caption: string;
        state: 'ready' | 'shared' | 'skipped';
        orders: number;
        revenue: number;
        today: boolean;
      }[]
    >`
      select sp.id, sp.day::text as day, sp.product_ids, sp.ref_code, sp.caption, sp.state,
             count(o.id)::int as orders, coalesce(sum(o.total_cents), 0)::int as revenue,
             sp.day = (now() at time zone ${tz})::date as today
      from status_posts sp
      left join orders o on o.tenant_id = sp.tenant_id and o.ref = sp.ref_code
        and o.state not in ('cancelled', 'refunded')
      where sp.tenant_id = ${tenant.id} and sp.day > (now() at time zone ${tz})::date - 14
      group by sp.id order by sp.day desc`,
    storeOrigin(tx, tenant, storeDomain),
    productPathTx(tx, tenant.id),
  ]);
  const today = posts.find((p) => p.today) ?? null;
  const detail = today
    ? await getProductsById(tx, tenant.id, today.product_ids, { tz })
    : new Map();
  return {
    plan,
    store: { name: tenant.name, url: origin },
    today: today
      ? {
          id: today.id,
          day: today.day,
          state: today.state,
          caption: today.caption,
          ref: today.ref_code,
          orders: today.orders,
          revenueCents: today.revenue,
          products: today.product_ids.flatMap((id) => {
            const p = detail.get(id);
            if (!p) return [];
            return [
              {
                id,
                name: p.name,
                priceLabel: brl(p.basePriceCents),
                compareAtLabel: p.compareAtPriceCents ? brl(p.compareAtPriceCents) : null,
                imageUrl: p.imageUrl,
                available: p.status === 'active',
                url: `${origin}${path.replace(':slug', encodeURIComponent(p.slug))}?ref=${today.ref_code}`,
              },
            ];
          }),
        }
      : null,
    recent: posts
      .filter((p) => !p.today)
      .map((p) => ({
        id: p.id,
        day: p.day,
        state: p.state,
        orders: p.orders,
        revenueCents: p.revenue,
      })),
  };
}

export type StatusView = Awaited<ReturnType<typeof statusViewTx>>;

/** Due now in the store's time: enabled, today one of its days, past its hour, nothing yet. */
export async function statusDueTx(tx: Sql, tenantId: string, now: Date): Promise<boolean> {
  const [r] = await tx<{ due: boolean }[]>`
    with tz as (
      select coalesce((select hours ->> 'timezone' from store_settings where tenant_id = ${tenantId}),
                      'America/Sao_Paulo') as z
    )
    select exists (
      select 1 from status_plans sp, tz
      where sp.tenant_id = ${tenantId} and sp.enabled
        and extract(dow from ${now}::timestamptz at time zone tz.z)::int = any(sp.days)
        and (${now}::timestamptz at time zone tz.z)::time >= sp.post_at
        and not exists (select 1 from status_posts p where p.tenant_id = ${tenantId}
                          and p.day = (${now}::timestamptz at time zone tz.z)::date)
    ) as due`;
  return !!r?.due;
}

/** The admin sweep, once a minute per store: prepare today's post when it's due. Returns it so
 *  the sweep can push "pronto"; null when nothing was prepared now. */
export async function statusDayPass(
  sql: Sql,
  tenantId: string,
  now = new Date(),
): Promise<{ id: string; products: number } | null> {
  return withTenant(sql, tenantId, async (tx) => {
    if (!(await statusDueTx(tx, tenantId, now))) return null;
    const [t] = await tx<{ slug: string }[]>`select slug from tenants where id = ${tenantId}`;
    const id = await prepareTodayTx(
      tx,
      { id: tenantId, slug: t!.slug },
      process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br',
      now,
    );
    if (!id) return null;
    const [p] = await tx<{ n: number }[]>`
      select cardinality(product_ids) as n from status_posts where id = ${id}`;
    return { id, products: p?.n ?? 0 };
  });
}
