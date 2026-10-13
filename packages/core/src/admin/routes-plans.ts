import { needsChoices } from '../modules/party.ts';
import { plansOfferedTx, type PlanLine, type PlanRow } from '../modules/shopper-plans.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import { audit } from './audit.ts';
import type { AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';

// Cardápio › Planos (0127): the store's weekly baskets, who has each, and the weeks placed. A
// subscriber is the shopper's own: the store pauses, resumes or ends it, never edits it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PLANS = 20;
const MAX_LINES = 20;

interface PlanIn {
  name: string;
  description: string | null;
  weekday: number | null;
  leadDays: number;
  items: PlanLine[];
  active: boolean;
}

const bad = (msg: string, field: string, extra: Record<string, unknown> = {}): never => {
  throw new HttpError(422, 'BAD_REQUEST', msg, { field, ...extra });
};
const intIn = (v: unknown, field: string, lo: number, hi: number) =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
    ? (v as number)
    : bad(`${field} must be ${lo}..${hi}`, field);

export function parsePlan(b: Record<string, unknown>): PlanIn {
  const name =
    typeof b.name === 'string' && b.name.trim().length >= 1 && b.name.trim().length <= 60
      ? b.name.trim()
      : bad('name: 1..60 characters', 'name');
  const description =
    b.description == null || (typeof b.description === 'string' && !b.description.trim())
      ? null
      : typeof b.description === 'string' && b.description.trim().length <= 200
        ? b.description.trim()
        : bad('description: up to 200 characters', 'description');
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > MAX_LINES)
    bad(`1..${MAX_LINES} items`, 'items');
  const seen = new Set<string>();
  const items = (b.items as unknown[]).map((raw, i) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    if (typeof it.productId !== 'string' || !UUID_RE.test(it.productId))
      bad('bad product id', 'items', { index: i });
    if (seen.has(it.productId as string)) bad('a product appears once', 'items', { index: i });
    seen.add(it.productId as string);
    return { productId: it.productId as string, qty: intIn(it.qty, 'qty', 1, 99) };
  });
  return {
    name,
    description,
    weekday: b.weekday == null ? null : intIn(b.weekday, 'weekday', 0, 6),
    leadDays: b.leadDays === undefined ? 2 : intIn(b.leadDays, 'leadDays', 1, 6),
    items,
    active: b.active === undefined ? true : b.active === true,
  };
}

async function checkProductsTx(tx: Sql, tenantId: string, items: PlanLine[]) {
  // products are checked against the store here: the items are jsonb, nothing references them
  const ids = items.map((i) => i.productId);
  const found = await tx<{ id: string; needs: boolean }[]>`
    select p.id, ${needsChoices(tx)} as needs from products p
    where p.tenant_id = ${tenantId} and p.id = any(${ids}::uuid[]) and p.status <> 'archived'`;
  const missing = ids.find((x) => !found.some((f) => f.id === x));
  if (missing)
    throw new HttpError(422, 'BAD_REQUEST', 'a product is not in this store', {
      field: 'items',
      productId: missing,
    });
  const asks = found.find((f) => f.needs);
  if (asks)
    throw new HttpError(
      422,
      'PRODUCT_NEEDS_CHOICES',
      'a product with required options or a kit to fill can’t be in a plan',
      { field: 'items', productId: asks.id },
    );
}

interface SubView {
  id: string;
  planId: string;
  name: string;
  phone: string;
  state: 'pending' | 'active' | 'paused' | 'cancelled';
  mode: string;
  method: string;
  weekday: number;
  nextOn: string | null;
  lastError: string | null;
  createdAt: string;
  weeks: number;
  lastOrder: { id: string; number: number; day: string } | null;
}

async function view(tx: Sql, tenantId: string) {
  const [plans, subs, offered, asks] = await Promise.all([
    tx<(PlanRow & { live: number })[]>`
      select p.id, p.name, p.description, p.weekday, p.lead_days, p.items, p.active, p.sort,
             (select count(*)::int from plan_subscriptions s
              where s.plan_id = p.id and s.state in ('active', 'pending')) as live
      from shopper_plans p where p.tenant_id = ${tenantId}
      order by p.sort, p.created_at`,
    tx<SubView[]>`
      select s.id, s.plan_id as "planId", s.name, s.phone, s.state,
             s.delivery ->> 'mode' as mode, s.payment ->> 'method' as method, s.weekday,
             s.next_on::text as "nextOn", s.last_error as "lastError",
             s.created_at as "createdAt",
             (select count(*)::int from plan_cycles c
              where c.subscription_id = s.id and c.state = 'placed') as weeks,
             (select json_build_object('id', o.id, 'number', o.number, 'day', c.day)
              from plan_cycles c join orders o on o.tenant_id = c.tenant_id and o.id = c.order_id
              where c.subscription_id = s.id order by c.day desc limit 1) as "lastOrder"
      from plan_subscriptions s
      where s.tenant_id = ${tenantId}
        and (s.state <> 'cancelled' or s.cancelled_at > now() - interval '30 days')
      order by (s.state = 'cancelled'), s.next_on nulls last, s.created_at desc
      limit 300`,
    plansOfferedTx(tx, tenantId),
    tx<{ id: string }[]>`
      select p.id from products p
      where p.tenant_id = ${tenantId} and p.status <> 'archived' and ${needsChoices(tx)}`,
  ]);
  return {
    // without the store's WhatsApp no plan is offered: the shopper would never hear of a week
    offered,
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      weekday: p.weekday,
      leadDays: p.lead_days,
      items: p.items,
      active: p.active,
      subscribers: p.live,
    })),
    subscriptions: subs,
    // what the picker leaves out: a plan's lines are plain ones
    needsChoices: asks.map((r) => r.id),
  };
}

export function mountShopperPlansAdmin(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  admin.get(
    '/plans',
    read('attendant', (tx, t) => view(tx, t.id)),
  );

  admin.post(
    '/plans',
    write('manager', async (tx, t, m, c) => {
      const p = parsePlan(await bodyJson(c, 16 * 1024));
      await checkProductsTx(tx, t.id, p.items);
      const [n] = await tx<{ n: number }[]>`
        select count(*)::int as n from shopper_plans where tenant_id = ${t.id}`;
      if ((n?.n ?? 0) >= MAX_PLANS)
        throw new HttpError(409, 'LIMIT_REACHED', `up to ${MAX_PLANS} plans`);
      const [row] = await tx<{ id: string }[]>`
        insert into shopper_plans (tenant_id, name, description, weekday, lead_days, items, active, sort)
        values (${t.id}, ${p.name}, ${p.description}, ${p.weekday}, ${p.leadDays},
                ${tx.json(p.items as never)}, ${p.active}, ${n?.n ?? 0})
        returning id`;
      await audit(tx, t.id, m, {
        action: 'plan.create',
        entity: 'shopper_plan',
        entityId: row!.id,
        summary: `criou o plano “${p.name}”`,
      });
      await emitAdminTx(tx, t.id, 'catalog', 'plans');
      return { status: 201, body: { id: row!.id, ...(await view(tx, t.id)) } };
    }),
  );

  admin.put(
    '/plans/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const p = parsePlan(await bodyJson(c, 16 * 1024));
      await checkProductsTx(tx, t.id, p.items);
      // a plan's lines change for the weeks still to come; the ones placed are orders already
      const [row] = await tx`
        update shopper_plans set name = ${p.name}, description = ${p.description},
          weekday = ${p.weekday}, lead_days = ${p.leadDays}, items = ${tx.json(p.items as never)},
          active = ${p.active}
        where tenant_id = ${t.id} and id = ${id} returning id`;
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'plan not found');
      await audit(tx, t.id, m, {
        action: 'plan.update',
        entity: 'shopper_plan',
        entityId: id,
        summary: `mudou o plano “${p.name}”`,
      });
      await emitAdminTx(tx, t.id, 'catalog', 'plans');
      return { status: 200, body: await view(tx, t.id) };
    }),
  );

  admin.delete(
    '/plans/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const [has] = await tx`
        select 1 from plan_subscriptions where tenant_id = ${t.id} and plan_id = ${id} limit 1`;
      if (has)
        throw new HttpError(
          409,
          'PLAN_HAS_SUBSCRIBERS',
          'a plan someone subscribed to is paused, not deleted',
        );
      const [gone] = await tx<{ name: string }[]>`
        delete from shopper_plans where tenant_id = ${t.id} and id = ${id} returning name`;
      if (!gone) throw new HttpError(404, 'NOT_FOUND', 'plan not found');
      await audit(tx, t.id, m, {
        action: 'plan.delete',
        entity: 'shopper_plan',
        entityId: id,
        summary: `apagou o plano “${gone.name}”`,
      });
      await emitAdminTx(tx, t.id, 'catalog', 'plans');
      return { status: 200, body: await view(tx, t.id) };
    }),
  );

  // pause | resume | cancel one subscriber. Resuming sets the next date on the plan's weekday
  // from today, past the plan's lead.
  admin.post(
    '/plans/subscriptions/:id/:action',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const action = c.req.param('action');
      if (action !== 'pause' && action !== 'resume' && action !== 'cancel')
        throw new HttpError(404, 'NOT_FOUND', 'unknown action');
      const [s] = await tx<{ state: string; phone: string; weekday: number; lead: number }[]>`
        select s.state, s.phone, s.weekday, p.lead_days as lead
        from plan_subscriptions s join shopper_plans p on p.id = s.plan_id
        where s.tenant_id = ${t.id} and s.id = ${id} for update of s`;
      if (!s) throw new HttpError(404, 'NOT_FOUND', 'subscription not found');
      if (s.state === 'cancelled')
        throw new HttpError(409, 'SUBSCRIPTION_CANCELLED', 'this plan was ended');
      if (action === 'pause') {
        if (s.state !== 'active')
          throw new HttpError(409, 'INVALID_STATE', 'only an active plan pauses');
        await tx`update plan_subscriptions set state = 'paused', next_on = null
                 where tenant_id = ${t.id} and id = ${id}`;
      } else if (action === 'resume') {
        if (s.state !== 'paused')
          throw new HttpError(409, 'INVALID_STATE', 'only a paused plan resumes');
        // the first date on its weekday that the plan's lead still reaches
        await tx`
          update plan_subscriptions set state = 'active', last_error = null,
            next_on = d.day
          from (
            select (local.today + p.lead
                    + ((${s.weekday} - extract(dow from local.today + p.lead)::int + 7) % 7))::date as day
            from (select (now() at time zone coalesce(
                    (select hours ->> 'timezone' from store_settings where tenant_id = ${t.id}),
                    'America/Sao_Paulo'))::date as today) local,
                 (select ${s.lead}::int as lead) p
          ) d
          where tenant_id = ${t.id} and id = ${id}`;
      } else {
        await tx`update plan_subscriptions set state = 'cancelled', cancelled_at = now(),
                   cancelled_by = 'store', next_on = null
                 where tenant_id = ${t.id} and id = ${id}`;
      }
      await audit(tx, t.id, m, {
        action: `plan.subscription.${action}`,
        entity: 'plan_subscription',
        entityId: id,
        summary: `${action === 'pause' ? 'pausou' : action === 'resume' ? 'retomou' : 'encerrou'} o plano do número final ${s.phone.slice(-4)}`,
      });
      await emitAdminTx(tx, t.id, 'catalog', 'plans');
      return { status: 200, body: await view(tx, t.id) };
    }),
  );
}
