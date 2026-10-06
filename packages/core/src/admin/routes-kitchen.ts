import type { Sql } from '../platform/db.ts';
import { HttpError, UUID_RE, bodyJson, uuidParam } from '../platform/http.ts';
import { transitionOrder, type OrderState } from '../modules/orders.ts';
import { requireFeature } from '../modules/billing/plans.ts';
import { audit } from './audit.ts';
import { bool, isObj, text, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { STATE_LABEL, storeTz } from './routes-orders.ts';

// Cozinha: the kitchen display. A ticket is an order the kitchen still has to make or hand over;
// the kitchen marks lines done (the first mark starts the order) and flags rushes. Accepting,
// ready and handoff stay on POST /orders/:id/transition.

type KitchenState = 'placed' | 'confirmed' | 'preparing' | 'ready';
const BOARD: string[] = ['placed', 'confirmed', 'preparing', 'ready'];
// lines are marked only while the kitchen has the order
const COOKING: string[] = ['confirmed', 'preparing'];

const MAX_ITEMS = 100;
const MAX_STATIONS = 12;
const MAX_STATION_CATEGORIES = 200;

export interface KitchenStation {
  id: string;
  name: string;
  categoryIds: string[];
}

export interface KitchenItem {
  id: string;
  name: string;
  qty: number;
  modifiers: { name: string; qty: number }[];
  combo: { slotName: string; name: string; qty: number }[];
  categoryId: string | null;
  stationId: string | null;
  doneAt: string | null;
}

export interface KitchenTicket {
  id: string;
  number: number;
  state: KitchenState;
  mode: 'pickup' | 'delivery';
  name: string;
  notes: string | null;
  scheduledFor: string | null;
  placedAt: string;
  acceptedAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  prepMinutes: number;
  rush: boolean;
  paid: boolean;
  payMethod: string;
  version: number;
  items: KitchenItem[];
}

export interface KitchenStats {
  readyToday: number;
  avgMakeSeconds: number | null;
  onTimeRate: number | null;
  readyLastHour: number;
  hourly: number[];
}

interface Settings {
  prepDefault: number;
  acceptTarget: number;
  kitchen: unknown;
}

async function settingsTx(tx: Sql, tenantId: string): Promise<Settings> {
  const [s] = await tx<{ prep: number; target: number; kitchen: unknown }[]>`
    select prep_time_minutes as prep, accept_target_minutes as target, kitchen
    from store_settings where tenant_id = ${tenantId}`;
  return { prepDefault: s?.prep ?? 30, acceptTarget: s?.target ?? 5, kitchen: s?.kitchen ?? {} };
}

function categoriesTx(tx: Sql, tenantId: string) {
  return tx<{ id: string; name: string }[]>`
    select id, name from categories where tenant_id = ${tenantId} order by sort, name`;
}

/** The stored stations; with `live`, minus categories deleted since. */
function storedStations(kitchen: unknown, live?: Set<string>): KitchenStation[] {
  const list = isObj(kitchen) && Array.isArray(kitchen.stations) ? kitchen.stations : [];
  return list.filter(isObj).map((s) => ({
    id: String(s.id),
    name: String(s.name),
    categoryIds: (Array.isArray(s.categoryIds) ? s.categoryIds : []).filter(
      (c): c is string => typeof c === 'string' && (!live || live.has(c)),
    ),
  }));
}

// a confirmed event's promise, when the step carried one
const prepOf = (tx: Sql, alias: string) => tx`
  case when jsonb_typeof(${tx(alias)}.meta -> 'prepMinutes') = 'number'
    then (${tx(alias)}.meta ->> 'prepMinutes')::float8 end`;

const prepOr = (prep: number | null, fallback: number) =>
  prep !== null && Number.isFinite(prep) && prep > 0 ? Math.round(prep) : fallback;

type TicketRow = Omit<
  KitchenTicket,
  'acceptedAt' | 'startedAt' | 'readyAt' | 'prepMinutes' | 'version' | 'items'
> & { rev: number };

async function ticketsTx(
  tx: Sql,
  tenantId: string,
  prepDefault: number,
  stations: KitchenStation[],
  which: { tz: string } | { ids: string[] },
): Promise<KitchenTicket[]> {
  const rows = await tx<TicketRow[]>`
    select o.id, o.number, o.state, o.delivery ->> 'mode' as mode,
           coalesce(split_part(trim(o.customer ->> 'name'), ' ', 1), '') as name,
           o.notes, o.scheduled_for::text as "scheduledFor", o.placed_at as "placedAt",
           coalesce(k.rush, false) as rush,
           coalesce(o.payment ->> 'status' in ('paid', 'partially_refunded'), false) as paid,
           coalesce(o.payment ->> 'method', '') as "payMethod", o.rev
    from orders o
    left join kitchen_tickets k on k.tenant_id = o.tenant_id and k.order_id = o.id
    where o.tenant_id = ${tenantId}
      ${
        'ids' in which
          ? tx`and o.id = any(${which.ids})`
          : tx`and o.state = any(${BOARD})
               and (o.scheduled_for is null or o.scheduled_for <= (now() at time zone ${which.tz})::date)`
      }
    order by o.placed_at
    limit 200`;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  // the tickets' events and items go out together
  const [events, items] = await Promise.all([
    tx<
      {
        orderId: string;
        n: number;
        acceptedAt: string | null;
        startedAt: string | null;
        readyAt: string | null;
        prep: number | null;
      }[]
    >`
    select e.order_id as "orderId", count(*)::int as n,
           min(e.at) filter (where e.to_state = 'confirmed') as "acceptedAt",
           min(e.at) filter (where e.to_state = 'preparing') as "startedAt",
           min(e.at) filter (where e.to_state = 'ready') as "readyAt",
           (array_agg(${prepOf(tx, 'e')} order by e.at, e.id)
              filter (where e.to_state = 'confirmed'))[1] as prep
    from order_events e
    where e.tenant_id = ${tenantId} and e.order_id = any(${ids})
    group by e.order_id`,
    tx<
      {
        id: string;
        orderId: string;
        name: string;
        qty: number;
        modifiers: { name: string; qty?: number }[];
        combo: { slotName: string; name: string; qty: number }[];
        categoryId: string | null;
        doneAt: string | null;
      }[]
    >`
    select i.id, i.order_id as "orderId", i.name, i.qty, i.modifiers, i.combo,
           p.category_id as "categoryId", km.done_at as "doneAt"
    from order_items i
    left join products p on p.tenant_id = i.tenant_id and p.id = i.product_id
    left join kitchen_marks km on km.tenant_id = i.tenant_id and km.order_item_id = i.id
    where i.tenant_id = ${tenantId} and i.order_id = any(${ids})
    order by i.sort, i.id`,
  ]);
  const eventsBy = new Map(events.map((e) => [e.orderId, e]));
  const stationOf = new Map<string, string>();
  for (const s of stations) for (const c of s.categoryIds) stationOf.set(c, s.id);
  const itemsBy = new Map<string, KitchenItem[]>();
  for (const i of items) {
    let list = itemsBy.get(i.orderId);
    if (!list) itemsBy.set(i.orderId, (list = []));
    list.push({
      id: i.id,
      name: i.name,
      qty: i.qty,
      modifiers: (i.modifiers ?? []).map((m) => ({ name: m.name, qty: m.qty ?? 1 })),
      combo: (i.combo ?? []).map((c) => ({ slotName: c.slotName, name: c.name, qty: c.qty })),
      categoryId: i.categoryId,
      stationId: (i.categoryId && stationOf.get(i.categoryId)) || null,
      doneAt: i.doneAt,
    });
  }

  return rows.map(({ rev, ...o }) => {
    const e = eventsBy.get(o.id);
    return {
      ...o,
      acceptedAt: e?.acceptedAt ?? null,
      startedAt: e?.startedAt ?? null,
      readyAt: e?.readyAt ?? null,
      prepMinutes: prepOr(e?.prep ?? null, prepDefault),
      version: (e?.n ?? 0) + rev,
      items: itemsBy.get(o.id) ?? [],
    };
  });
}

async function ticketTx(tx: Sql, tenantId: string, id: string): Promise<KitchenTicket> {
  const s = await settingsTx(tx, tenantId);
  const [t] = await ticketsTx(tx, tenantId, s.prepDefault, storedStations(s.kitchen), {
    ids: [id],
  });
  if (!t) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
  return t;
}

async function statsTx(
  tx: Sql,
  tenantId: string,
  tz: string,
  prepDefault: number,
): Promise<KitchenStats> {
  const day0 = tx`(date_trunc('day', now() at time zone ${tz}) at time zone ${tz})`;
  const rows = await tx<
    {
      hour: number;
      today: boolean;
      lastHour: boolean;
      makeSeconds: number | null;
      prep: number | null;
      scheduled: boolean;
    }[]
  >`
    with r as (
      select e.order_id, min(e.at) as at
      from order_events e
      where e.tenant_id = ${tenantId} and e.to_state = 'ready'
        and e.at >= least(${day0}, now() - interval '1 hour')
      group by e.order_id
    )
    select extract(hour from r.at at time zone ${tz})::int as hour,
           r.at >= ${day0} as today,
           r.at >= now() - interval '1 hour' as "lastHour",
           extract(epoch from r.at - c.at)::float8 as "makeSeconds",
           c.prep, o.scheduled_for is not null as scheduled
    from r
    join orders o on o.tenant_id = ${tenantId} and o.id = r.order_id
    left join lateral (
      select ce.at, ${prepOf(tx, 'ce')} as prep
      from order_events ce
      where ce.tenant_id = ${tenantId} and ce.order_id = r.order_id and ce.to_state = 'confirmed'
      order by ce.at, ce.id
      limit 1
    ) c on true`;
  const hourly = Array.from({ length: 24 }, () => 0);
  let readyToday = 0;
  let readyLastHour = 0;
  let made = 0;
  let makeSum = 0;
  let onTime = 0;
  for (const r of rows) {
    if (r.lastHour) readyLastHour++;
    if (!r.today) continue;
    readyToday++;
    hourly[r.hour] = (hourly[r.hour] ?? 0) + 1;
    // an encomenda was accepted days before it was made: its wait says nothing about the kitchen
    if (r.scheduled || r.makeSeconds === null) continue;
    made++;
    makeSum += r.makeSeconds;
    if (r.makeSeconds <= prepOr(r.prep, prepDefault) * 60) onTime++;
  }
  return {
    readyToday,
    avgMakeSeconds: made ? Math.round(makeSum / made) : null,
    onTimeRate: made ? onTime / made : null,
    readyLastHour,
    hourly,
  };
}

async function lockOrder(tx: Sql, tenantId: string, id: string) {
  const [o] = await tx<{ number: number; state: OrderState }[]>`
    select number, state from orders where tenant_id = ${tenantId} and id = ${id} for update`;
  if (!o) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
  return o;
}

const closed = (state: OrderState) =>
  new HttpError(409, 'KITCHEN_CLOSED', `the kitchen can't change a ${state} order`, { state });

function itemIds(v: unknown): string[] {
  if (
    !Array.isArray(v) ||
    v.length === 0 ||
    v.length > MAX_ITEMS ||
    v.some((x) => typeof x !== 'string' || !UUID_RE.test(x))
  )
    throw new HttpError(422, 'BAD_REQUEST', `items must list 1–${MAX_ITEMS} item ids`, {
      field: 'items',
    });
  return [...new Set((v as string[]).map((x) => x.toLowerCase()))];
}

const bad = (field: string, message: string, extra: Record<string, unknown> = {}) =>
  new HttpError(422, 'BAD_REQUEST', message, { field, ...extra });

function stationsInput(v: unknown, live: Set<string>): KitchenStation[] {
  if (!Array.isArray(v) || v.length > MAX_STATIONS)
    throw bad('stations', `stations must list at most ${MAX_STATIONS}`);
  const ids = new Set<string>();
  const names = new Set<string>();
  const taken = new Set<string>();
  return v.map((raw) => {
    if (!isObj(raw)) throw bad('stations', 'each station needs a name and categories');
    const name = text(raw.name, 'name', 40, 1);
    const folded = name.toLocaleLowerCase('pt-BR');
    if (names.has(folded)) throw bad('name', `two stations are named ${name}`);
    names.add(folded);
    const cats = raw.categoryIds;
    if (
      !Array.isArray(cats) ||
      cats.length > MAX_STATION_CATEGORIES ||
      cats.some((x) => typeof x !== 'string' || !UUID_RE.test(x))
    )
      throw bad('categoryIds', `categoryIds must list at most ${MAX_STATION_CATEGORIES} ids`);
    const categoryIds = [...new Set((cats as string[]).map((x) => x.toLowerCase()))];
    for (const c of categoryIds) {
      if (!live.has(c)) throw bad('categoryIds', 'category not found', { categoryId: c });
      if (taken.has(c))
        throw bad('stations', 'a category goes to one station only', { categoryId: c });
      taken.add(c);
    }
    let id = typeof raw.id === 'string' && UUID_RE.test(raw.id) ? raw.id.toLowerCase() : '';
    if (!id || ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    return { id, name, categoryIds };
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function mountKitchen(d: AdminDeps) {
  const { admin } = d;
  const { read, write, named } = handlers(d);

  admin.get(
    '/kitchen',
    named('kitchen').read('attendant', async (tx, t) => {
      // independent reads in one batch (the plan gate rejects the whole of it), then the
      // tickets and the stats, which need the settings, in another
      const [, tz, s, categories] = await Promise.all([
        requireFeature(tx, t.id, 'kds'),
        storeTz(tx, t.id),
        settingsTx(tx, t.id),
        categoriesTx(tx, t.id),
      ]);
      const stations = storedStations(s.kitchen, new Set(categories.map((c) => c.id)));
      const [tickets, stats] = await Promise.all([
        ticketsTx(tx, t.id, s.prepDefault, stations, { tz }),
        statsTx(tx, t.id, tz, s.prepDefault),
      ]);
      return {
        tickets,
        stations,
        categories,
        stats,
        prepDefaultMinutes: s.prepDefault,
        acceptTargetMinutes: s.acceptTarget,
        now: new Date().toISOString(),
      };
    }),
  );

  admin.post(
    '/kitchen/orders/:id/items',
    write('attendant', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'kds');
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c, 8 * 1024);
      const items = itemIds(body.items);
      const done = bool(body.done, 'done');
      const order = await lockOrder(tx, t.id, id);
      if (!COOKING.includes(order.state)) throw closed(order.state);
      const own = await tx`
        select id from order_items
        where tenant_id = ${t.id} and order_id = ${id} and id = any(${items})`;
      if (own.length !== items.length)
        throw new HttpError(404, 'ITEM_NOT_FOUND', 'item not found on this order');
      const changed = done
        ? (
            await tx`
              insert into kitchen_marks (order_item_id, tenant_id, order_id, done_by)
              select i.id, i.tenant_id, i.order_id, ${m.userId} from order_items i
              where i.tenant_id = ${t.id} and i.order_id = ${id} and i.id = any(${items})
              on conflict (order_item_id) do nothing`
          ).count
        : (
            await tx`
              delete from kitchen_marks
              where tenant_id = ${t.id} and order_id = ${id} and order_item_id = any(${items})`
          ).count;
      // the first line made is the kitchen starting the order
      if (done && order.state === 'confirmed') {
        const meta = { by: m.name, source: 'cozinha' };
        await transitionOrder(tx, t.id, id, 'preparing', 'merchant', meta);
        await audit(tx, t.id, m, {
          action: 'order.preparing',
          entity: 'order',
          entityId: id,
          summary: `pedido #${order.number}: ${STATE_LABEL.confirmed} → ${STATE_LABEL.preparing}`,
          before: { state: order.state },
          after: { state: 'preparing', ...meta },
        });
      }
      if (changed > 0) {
        await audit(tx, t.id, m, {
          action: 'kitchen.items',
          entity: 'order',
          entityId: id,
          summary: `pedido #${order.number}: ${
            done
              ? plural(changed, 'item feito', 'itens feitos')
              : plural(changed, 'item desmarcado', 'itens desmarcados')
          }`,
          after: { done, items },
        });
        await emitAdminTx(tx, t.id, 'kitchen', id);
      }
      return { status: 200, body: { ticket: await ticketTx(tx, t.id, id) } };
    }),
  );

  admin.post(
    '/kitchen/orders/:id/rush',
    write('attendant', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'kds');
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c, 1024);
      const rush = bool(body.rush, 'rush');
      const order = await lockOrder(tx, t.id, id);
      if (!BOARD.includes(order.state)) throw closed(order.state);
      const [prev] = await tx<{ rush: boolean }[]>`
        select rush from kitchen_tickets where tenant_id = ${t.id} and order_id = ${id}`;
      if ((prev?.rush ?? false) !== rush) {
        await tx`
          insert into kitchen_tickets (order_id, tenant_id, rush) values (${id}, ${t.id}, ${rush})
          on conflict (order_id) do update set rush = excluded.rush, updated_at = now()`;
        await audit(tx, t.id, m, {
          action: 'kitchen.rush',
          entity: 'order',
          entityId: id,
          summary: `pedido #${order.number}: ${rush ? 'prioridade' : 'sem prioridade'}`,
          before: { rush: !rush },
          after: { rush },
        });
        await emitAdminTx(tx, t.id, 'kitchen', id);
      }
      return { status: 200, body: { ticket: await ticketTx(tx, t.id, id) } };
    }),
  );

  admin.put(
    '/kitchen/stations',
    write('manager', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'kds');
      const body = await bodyJson(c, 128 * 1024);
      const live = new Set((await categoriesTx(tx, t.id)).map((x) => x.id));
      const stations = stationsInput(body.stations, live);
      await tx`insert into store_settings (tenant_id) values (${t.id}) on conflict do nothing`;
      const [row] = await tx<{ kitchen: unknown }[]>`
        select kitchen from store_settings where tenant_id = ${t.id} for update`;
      if (!row) throw new HttpError(404, 'STORE_NOT_FOUND', 'store settings not found');
      await tx`
        update store_settings set kitchen = kitchen || ${tx.json({ stations } as never)}
        where tenant_id = ${t.id}`;
      await audit(tx, t.id, m, {
        action: 'kitchen.stations',
        entity: 'kitchen',
        summary: stations.length
          ? `organizou a cozinha em ${plural(stations.length, 'estação', 'estações')}`
          : 'tirou as estações da cozinha',
        before: { stations: storedStations(row.kitchen, live) },
        after: { stations },
      });
      await emitAdminTx(tx, t.id, 'kitchen', 'stations');
      return { status: 200, body: { stations } };
    }),
  );
}
