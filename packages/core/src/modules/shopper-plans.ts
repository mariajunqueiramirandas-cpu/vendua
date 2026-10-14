import type { Context } from 'hono';
import { emitAdminTx } from '../admin/live.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import { bodyJson, HttpError, sessionCartId } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { enqueueOrderNoteTx, planConfirmText } from '../store-whatsapp/messages.ts';
import { phoneVariants } from '../store-whatsapp/text.ts';
import { assertCartOpen, loadCartView } from './cart.ts';
import { importLines, type ImportReport } from './cart-share.ts';
import { getProductsById } from './catalog.ts';
import type { CheckoutInput } from './checkout.ts';
import { transitionOrder } from './orders.ts';
import { addDays, dayOfWeek, type CartPlan } from './shopper-plan-base.ts';

// Plano semanal (0127): a store's fixed basket a shopper gets every week. The first order is an
// ordinary checkout with the shopper's yes (`subscribe`); the store's WhatsApp confirms the
// number (ASSINAR) unless a customer token already proved it; each week shopper-plan-cycles.ts
// places the next order. Everything here runs on the store's WhatsApp: without it no plan is
// offered, since the shopper would never hear of the week's order.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PlanLine {
  productId: string;
  qty: number;
}

export interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  weekday: number | null;
  lead_days: number;
  items: PlanLine[];
  active: boolean;
  sort: number;
}

/** What the shopper's /planos page shows: the lines at today's prices (Core's sum). */
export interface ShopperPlan {
  id: string;
  name: string;
  description: string | null;
  /** 0 = Sunday; null = the day of the first order */
  weekday: number | null;
  lines: {
    productId: string;
    slug: string;
    name: string;
    qty: number;
    unitPriceCents: number;
    imageUrl: string | null;
  }[];
  subtotalCents: number;
}

const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** The store can text: a plan is offered only then. */
export async function plansOfferedTx(tx: Sql, tenantId: string): Promise<boolean> {
  const [r] = await tx`select 1 from store_whatsapp where tenant_id = ${tenantId} and wanted`;
  return !!r;
}

export async function shopperPlansTx(tx: Sql, tenantId: string): Promise<ShopperPlan[]> {
  if (!(await plansOfferedTx(tx, tenantId))) return [];
  const rows = await tx<(PlanRow & { tz: string | null })[]>`
    select p.id, p.name, p.description, p.weekday, p.lead_days, p.items, p.active, p.sort,
           (select hours ->> 'timezone' from store_settings s where s.tenant_id = p.tenant_id) as tz
    from shopper_plans p
    where p.tenant_id = ${tenantId} and p.active
    order by p.sort, p.created_at`;
  if (!rows.length) return [];
  const products = await getProductsById(
    tx,
    tenantId,
    rows.flatMap((r) => r.items.map((i) => i.productId)),
    { tz: rows[0]!.tz || 'America/Sao_Paulo' },
  );
  const out: ShopperPlan[] = [];
  for (const r of rows) {
    const lines = r.items.flatMap((i) => {
      const p = products.get(i.productId);
      return p && p.status !== 'archived'
        ? [
            {
              productId: p.id,
              slug: p.slug,
              name: p.name,
              qty: i.qty,
              unitPriceCents: p.basePriceCents,
              imageUrl: p.imageUrl,
            },
          ]
        : [];
    });
    // a plan whose product left the menu waits for the store to fix it
    if (lines.length !== r.items.length) continue;
    out.push({
      id: r.id,
      name: r.name,
      description: r.description,
      weekday: r.weekday,
      lines,
      subtotalCents: lines.reduce((n, l) => n + l.qty * l.unitPriceCents, 0),
    });
  }
  return out;
}

async function activePlanTx(tx: Sql, tenantId: string, planId: string): Promise<PlanRow> {
  const [p] = await tx<PlanRow[]>`
    select id, name, description, weekday, lead_days, items, active, sort from shopper_plans
    where tenant_id = ${tenantId} and id = ${planId} and active`;
  if (!p || !(await plansOfferedTx(tx, tenantId)))
    throw new HttpError(404, 'PLAN_NOT_FOUND', 'this plan is not offered');
  return p;
}

/** The session's cart becomes the plan: its lines, and the plan its checkout offers. */
export async function buildPlanCartTx(
  tx: Sql,
  tenantId: string,
  cartId: string,
  planId: string,
): Promise<ImportReport> {
  const plan = await activePlanTx(tx, tenantId, planId);
  await tx`delete from cart_items where tenant_id = ${tenantId} and cart_id = ${cartId}`;
  const report = await importLines(tx, tenantId, cartId, plan.items);
  await tx`update carts set plan_id = ${plan.id}, party = null, updated_at = now()
           where tenant_id = ${tenantId} and id = ${cartId}`;
  return report;
}

// ── checkout ──────────────────────────────────────────────────────────────────

export interface PlanToSubscribe {
  plan: CartPlan;
  phone: string;
  scheduledFor: string;
}

/**
 * Checkout, before anything is written: the shopper said yes to the cart's plan. A plan's week
 * is an encomenda delivered or picked up on the first order's weekday, to a phone the store
 * texts.
 */
export async function planToSubscribeTx(
  tx: Sql,
  tenantId: string,
  plan: CartPlan,
  body: CheckoutInput,
  phone: string | null,
  scheduledFor: string | null,
): Promise<PlanToSubscribe> {
  if (!phone || !/^\d{10,11}$/.test(phone))
    throw new HttpError(422, 'INVALID_CUSTOMER', 'a plan needs a phone number', {
      field: 'customer.phone',
    });
  if (body.delivery.mode === 'dine_in' || body.payment.method === 'tab')
    throw new HttpError(422, 'PLAN_NOT_ALLOWED', 'a plan is delivered or picked up', {
      field: 'delivery.mode',
    });
  if (!scheduledFor)
    throw new HttpError(422, 'SCHEDULE_REQUIRED', 'a plan starts on a date', {
      field: 'scheduledFor',
    });
  if (!(await plansOfferedTx(tx, tenantId)))
    throw new HttpError(404, 'PLAN_NOT_FOUND', 'this plan is not offered');
  return { plan, phone, scheduledFor };
}

/** After the first order is written: the subscription, and the store's message under it. */
export async function subscribeTx(
  tx: Sql,
  tenantId: string,
  s: PlanToSubscribe,
  orderId: string,
  body: CheckoutInput,
  /** a customer token vouched for this phone: no ASSINAR needed */
  proven: boolean,
): Promise<string | null> {
  const d = body.delivery;
  const delivery = {
    mode: d.mode,
    ...(d.neighborhood ? { neighborhood: d.neighborhood } : {}),
    ...(d.address ? { address: d.address } : {}),
    ...(d.street ? { street: d.street } : {}),
    ...(d.number ? { number: d.number } : {}),
    ...(d.complement ? { complement: d.complement } : {}),
    ...(d.reference ? { reference: d.reference } : {}),
    ...(d.cep ? { cep: d.cep } : {}),
    ...(typeof d.lat === 'number' && typeof d.lng === 'number' ? { lat: d.lat, lng: d.lng } : {}),
  };
  const weekday = dayOfWeek(s.scheduledFor);
  const nextOn = addDays(s.scheduledFor, 7);
  const active = proven;
  // a number that already has this plan keeps the one it has; one still waiting for ASSINAR
  // takes the latest checkout (a phone typed by someone else can't hold the owner's plan)
  const [row] = await tx<{ id: string }[]>`
    insert into plan_subscriptions (tenant_id, plan_id, phone, name, delivery, payment, notes,
                                    state, weekday, next_on, first_order_id, confirmed_at)
    values (${tenantId}, ${s.plan.id}, ${s.phone}, ${body.customer.name.trim().slice(0, 200)},
            ${tx.json(delivery)}, ${tx.json({ method: body.payment.method })},
            ${body.notes?.trim().slice(0, 500) || null},
            ${active ? 'active' : 'pending'}, ${weekday}, ${nextOn}, ${orderId},
            ${active ? new Date() : null})
    on conflict (tenant_id, plan_id, phone) where state <> 'cancelled' do update set
      name = excluded.name, delivery = excluded.delivery, payment = excluded.payment,
      notes = excluded.notes, state = excluded.state, weekday = excluded.weekday,
      next_on = excluded.next_on, first_order_id = excluded.first_order_id,
      confirmed_at = excluded.confirmed_at, created_at = now()
    where plan_subscriptions.state = 'pending'
    returning id`;
  if (!row) return null;
  await emitAdminTx(tx, tenantId, 'catalog', 'plans');
  await enqueueOrderNoteTx(tx, tenantId, orderId, 'plan_confirm', (o) =>
    planConfirmText(o, { name: s.plan.name, weekday, nextOn, active }),
  );
  return row.id;
}

// ── the shopper's words on the store's WhatsApp ──────────────────────────────

interface SubRow {
  id: string;
  plan_name: string;
  next_on: string | null;
  state: string;
}

/**
 * The week's order the plan already placed, while the store hasn't taken it and nothing was
 * paid: cancelled as the shopper's own. One taken or paid stays, and the answer says so.
 */
async function dropOpenCycleTx(
  tx: Sql,
  tenantId: string,
  subscriptionId: string,
): Promise<{ cancelled: number[]; kept: number[] }> {
  const rows = await tx<{ order_id: string; number: number; open: boolean; day: string }[]>`
    select c.order_id, o.number, c.day::text as day,
           (o.state = 'placed' and coalesce(o.payment ->> 'status', 'pending') = 'pending') as open
    from plan_cycles c join orders o on o.tenant_id = c.tenant_id and o.id = c.order_id
    where c.tenant_id = ${tenantId} and c.subscription_id = ${subscriptionId}
      and c.state = 'placed' and o.state not in ('cancelled', 'refunded', 'delivered')
      and o.scheduled_for >= current_date - 1
    order by c.day`;
  const out = { cancelled: [] as number[], kept: [] as number[] };
  for (const r of rows) {
    if (!r.open) {
      out.kept.push(r.number);
      continue;
    }
    await transitionOrder(tx, tenantId, r.order_id, 'cancelled', 'customer', {
      via: 'plan',
      reason: 'o cliente pulou a semana do plano',
    });
    await tx`update plan_cycles set state = 'skipped', reason = 'shopper'
             where tenant_id = ${tenantId} and subscription_id = ${subscriptionId} and day = ${r.day}`;
    out.cancelled.push(r.number);
  }
  return out;
}

/**
 * ASSINAR / PULAR / CANCELAR PLANO from a number the store texted. Returns the store's answer,
 * or null when the number has no plan the word applies to (the store's conversation goes on).
 */
export async function planKeywordTx(
  tx: Sql,
  tenantId: string,
  phone: string,
  kw: 'plan_yes' | 'plan_skip' | 'plan_stop',
): Promise<string | null> {
  const variants = phoneVariants(phone);
  if (kw === 'plan_yes') {
    const subs = await tx<SubRow[]>`
      update plan_subscriptions s set state = 'active', confirmed_at = now()
      from shopper_plans p
      where s.tenant_id = ${tenantId} and p.id = s.plan_id and s.phone = any(${variants}::text[])
        and s.state = 'pending'
      returning s.id, p.name as plan_name, s.next_on::text as next_on, s.state`;
    if (!subs.length) return null;
    await emitAdminTx(tx, tenantId, 'catalog', 'plans');
    return subs
      .map(
        (s) =>
          `Plano "${s.plan_name}" confirmado ✅${s.next_on ? ` A próxima entrega é ${ddmm(s.next_on)}, e a loja avisa aqui antes.` : ''}`,
      )
      .concat('Para pular uma semana, responda PULAR. Para encerrar, responda CANCELAR PLANO.')
      .join('\n\n');
  }
  const subs = await tx<SubRow[]>`
    select s.id, p.name as plan_name, s.next_on::text as next_on, s.state
    from plan_subscriptions s join shopper_plans p on p.id = s.plan_id
    where s.tenant_id = ${tenantId} and s.phone = any(${variants}::text[])
      and s.state ${kw === 'plan_skip' ? tx`= 'active'` : tx`<> 'cancelled'`}
    order by s.created_at
    for update of s`;
  if (!subs.length) return null;
  const said: string[] = [];
  for (const s of subs) {
    const { cancelled, kept } = await dropOpenCycleTx(tx, tenantId, s.id);
    const keptWords = kept.length
      ? ` O pedido #${kept.join(', #')} já está com a loja; para mudar, é só responder aqui.`
      : '';
    if (kw === 'plan_stop') {
      await tx`update plan_subscriptions set state = 'cancelled', cancelled_at = now(),
                 cancelled_by = 'shopper', next_on = null
               where tenant_id = ${tenantId} and id = ${s.id}`;
      said.push(
        `Plano "${s.plan_name}" encerrado: nenhum pedido novo será feito.${cancelled.length ? ` O pedido #${cancelled.join(', #')} desta semana foi cancelado.` : ''}${keptWords}`,
      );
      continue;
    }
    if (cancelled.length) {
      said.push(
        `Pronto: o pedido #${cancelled.join(', #')} do plano "${s.plan_name}" foi cancelado.${s.next_on ? ` A próxima entrega é ${ddmm(s.next_on)}.` : ''}`,
      );
      continue;
    }
    if (!s.next_on) continue;
    // nothing placed for the coming date yet: that date is skipped before it is
    await tx`
      insert into plan_cycles (tenant_id, subscription_id, day, state, reason)
      values (${tenantId}, ${s.id}, ${s.next_on}, 'skipped', 'shopper')
      on conflict do nothing`;
    const next = addDays(s.next_on, 7);
    await tx`update plan_subscriptions set next_on = ${next} where tenant_id = ${tenantId} and id = ${s.id}`;
    said.push(
      `Pronto: sem entrega do plano "${s.plan_name}" em ${ddmm(s.next_on)}. A próxima é ${ddmm(next)}.${keptWords}`,
    );
  }
  await emitAdminTx(tx, tenantId, 'catalog', 'plans');
  return said.length ? said.join('\n\n') : null;
}

// ── routes ────────────────────────────────────────────────────────────────────

type Handler = (c: Context) => Promise<Response>;

/**
 * Shopper side: `GET /storefront/v1/plans` (what the store offers) and
 * `POST /checkout/v1/cart/plan` (the session's cart becomes the plan).
 */
export function mountShopperPlans(d: {
  storefront: { get: (p: string, h: Handler) => unknown };
  checkout: { post: (p: string, h: Handler) => unknown };
  sql: Sql;
  sessionSecret: string;
  idempotency: (
    sql: Sql,
    run: (c: Context, tx: Sql) => Promise<{ status: number; body: unknown }>,
  ) => Handler;
}) {
  d.storefront.get('/plans', async (c) => {
    const tenant = c.get('tenant') as Tenant;
    const plans = await withTenant(d.sql, tenant.id, (tx) => shopperPlansTx(tx, tenant.id));
    c.header('cache-control', 'no-store');
    return c.json({ plans });
  });
  d.checkout.post(
    '/cart/plan',
    d.idempotency(d.sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const cartId = await sessionCartId(c, d.sessionSecret);
      const body = await bodyJson(c, 1024);
      if (typeof body.planId !== 'string' || !UUID_RE.test(body.planId))
        throw new HttpError(422, 'BAD_REQUEST', 'planId is a plan id', { field: 'planId' });
      await assertCartOpen(tx, tenant.id, cartId);
      const report = await buildPlanCartTx(tx, tenant.id, cartId, body.planId);
      return { status: 200, body: { cart: await loadCartView(tx, tenant.id, cartId), report } };
    }),
  );
}
