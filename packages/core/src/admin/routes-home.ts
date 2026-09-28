import { roleAtLeast, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { storeTz } from './routes-orders.ts';
import { loadSettings, statusOf } from './routes-store.ts';

// Início in one read: the living header, "precisa de você", the setup checklist
// and the live feed. Everything is scoped to the store's local day.

export function mountHome(d: AdminDeps) {
  const { admin } = d;
  const { read } = handlers(d);

  admin.get(
    '/home',
    read('attendant', async (tx, t, m) => {
      const tz = await storeTz(tx, t.id);
      const s = await loadSettings(tx, t.id);
      const st = statusOf(s);
      const today = (
        await tx<
          {
            salesCents: number;
            orders: number;
            lastWeekSalesCents: number;
            lastWeekOrders: number;
          }[]
        >`
          with bounds as (
            select (date_trunc('day', now() at time zone ${tz}) at time zone ${tz}) as day_start,
                   now() - (date_trunc('day', now() at time zone ${tz}) at time zone ${tz}) as elapsed
          )
          select
            coalesce(sum(total_cents) filter (where placed_at >= b.day_start), 0)::int as "salesCents",
            count(*) filter (where placed_at >= b.day_start)::int as orders,
            -- same weekday last week, up to the same time of day: a fair "vs."
            coalesce(sum(total_cents) filter (
              where placed_at >= b.day_start - interval '7 days' and placed_at < b.day_start - interval '7 days' + b.elapsed
            ), 0)::int as "lastWeekSalesCents",
            count(*) filter (
              where placed_at >= b.day_start - interval '7 days' and placed_at < b.day_start - interval '7 days' + b.elapsed
            )::int as "lastWeekOrders"
          from bounds b left join orders o on o.tenant_id = ${t.id} and o.state not in ('cancelled', 'refunded')
            and o.placed_at >= b.day_start - interval '7 days'
          group by b.day_start, b.elapsed
        `
      )[0] ?? { salesCents: 0, orders: 0, lastWeekSalesCents: 0, lastWeekOrders: 0 };
      const spark = await tx<{ date: string; salesCents: number }[]>`
        select d::date::text as date,
               coalesce(sum(o.total_cents), 0)::int as "salesCents"
        from generate_series((now() at time zone ${tz})::date - 6, (now() at time zone ${tz})::date, interval '1 day') d
        left join orders o on o.tenant_id = ${t.id} and o.state not in ('cancelled', 'refunded')
          and (o.placed_at at time zone ${tz})::date = d::date
        group by d order by d
      `;
      const waiting = (
        await tx<{ n: number; late: number; oldest: string | null }[]>`
          select count(*)::int as n,
                 count(*) filter (where placed_at < now() - make_interval(mins => ${s.accept_target_minutes ?? 5}))::int as late,
                 min(placed_at) as oldest
          from orders where tenant_id = ${t.id} and state = 'placed'
            and (scheduled_for is null or scheduled_for <= (now() at time zone ${tz})::date)
        `
      )[0]!;
      const inProgress = (
        await tx<{ n: number }[]>`
          select count(*)::int as n from orders
          where tenant_id = ${t.id} and state in ('confirmed', 'preparing', 'ready', 'out_for_delivery')
        `
      )[0]!.n;

      const attention: {
        kind: string;
        count: number;
        title: string;
        detail?: string;
        href: string;
        productId?: string;
      }[] = [];
      if (waiting.n > 0)
        attention.push({
          kind: 'orders_waiting',
          count: waiting.n,
          title:
            waiting.n === 1 ? '1 pedido esperando você' : `${waiting.n} pedidos esperando você`,
          ...(waiting.late ? { detail: `${waiting.late} passou do tempo de aceite` } : {}),
          href: '/pedidos',
        });
      if (st.status !== 'open' && inProgress > 0)
        attention.push({
          kind: 'closed_with_orders',
          count: inProgress,
          title: `A loja está ${st.status === 'paused' ? 'pausada' : 'fechada'} com pedidos em andamento`,
          href: '/pedidos',
        });
      if (roleAtLeast(m.role, 'manager')) {
        const pendingPix = (
          await tx<{ n: number }[]>`
            select count(*)::int as n from orders
            where tenant_id = ${t.id} and payment ->> 'method' = 'pix' and payment ->> 'status' = 'pending'
              and state not in ('cancelled', 'refunded') and placed_at > now() - interval '3 days'
          `
        )[0]!.n;
        if (pendingPix)
          attention.push({
            kind: 'pix_to_confirm',
            count: pendingPix,
            title: pendingPix === 1 ? '1 Pix para conferir' : `${pendingPix} Pix para conferir`,
            detail: 'Confira no seu banco e marque como pago',
            href: '/pagamentos',
          });
        const low = await tx<{ id: string; name: string; stock: number }[]>`
          select id, name, stock_quantity as stock from products
          where tenant_id = ${t.id} and status = 'active' and stock_quantity is not null
            and (stock_quantity = 0 or (low_stock_threshold is not null and stock_quantity <= low_stock_threshold))
          order by stock_quantity limit 5
        `;
        for (const p of low)
          attention.push({
            kind: 'low_stock',
            count: p.stock,
            title: p.stock === 0 ? `${p.name} acabou` : `${p.name}: só ${p.stock} no estoque`,
            href: `/cardapio/produto/${p.id}`,
            productId: p.id,
          });
        const wl = await tx<{ id: string; name: string; n: number }[]>`
          select p.id, p.name, count(*)::int as n from notify_requests n join products p on p.id = n.product_id
          where n.tenant_id = ${t.id} and n.subject = 'product' and n.notified_at is null
          group by p.id order by n desc limit 3
        `;
        for (const w of wl)
          attention.push({
            kind: 'waitlist',
            count: w.n,
            title: `${w.n} ${w.n === 1 ? 'pessoa quer' : 'pessoas querem'} ${w.name}`,
            detail: 'Avise quando voltar',
            href: '/marketing',
            productId: w.id,
          });
      }

      const counts = (
        await tx<{ products: number; withPhoto: number; zones: number; orders: number }[]>`
          select
            (select count(*) from products where tenant_id = ${t.id} and status <> 'archived')::int as products,
            (select count(distinct p.id) from products p join product_media pm on pm.product_id = p.id
              where p.tenant_id = ${t.id} and p.status <> 'archived')::int as "withPhoto",
            (select count(*) from delivery_zones where tenant_id = ${t.id} and active)::int as zones,
            (select count(*) from orders where tenant_id = ${t.id})::int as orders
        `
      )[0]!;
      const checklist = [
        {
          id: 'profile',
          label: 'Logo e WhatsApp da loja',
          done: !!s.logo_url && !!s.whatsapp,
          href: '/loja#perfil',
        },
        {
          id: 'hours',
          label: 'Horário de funcionamento',
          done: (s.hours?.windows?.length ?? 0) > 0,
          href: '/loja#horarios',
        },
        {
          id: 'delivery',
          label: 'Entrega ou retirada',
          done:
            (s.delivery_enabled && counts.zones > 0) || (s.pickup_enabled && !s.delivery_enabled),
          href: '/loja#entrega',
        },
        { id: 'pix', label: 'Chave Pix para receber', done: !!s.pix_key, href: '/pagamentos' },
        {
          id: 'menu',
          label: '3 produtos com foto',
          done: counts.withPhoto >= 3,
          href: '/cardapio',
        },
        {
          id: 'first_order',
          label: 'Primeiro pedido',
          done: counts.orders > 0,
          href: '/marketing#compartilhar',
        },
      ];

      const feed = await tx`
        select e.at, e.to_state as "to", e.from_state as "from", e.actor, o.id as "orderId", o.number,
               o.customer ->> 'name' as name, o.total_cents as "totalCents"
        from order_events e join orders o on o.id = e.order_id
        where e.tenant_id = ${t.id} and e.at > now() - interval '24 hours'
        order by e.at desc limit 12
      `;
      const live = (
        await tx<{ visitors: number; carts: number }[]>`
          select count(distinct session_id) filter (where name in ('page_view', 'product_view'))::int as visitors,
                 count(distinct session_id) filter (where name = 'add_to_cart')::int as carts
          from analytics_events where tenant_id = ${t.id} and at > now() - interval '30 minutes'
        `
      )[0]!;
      const best = await tx`
        select i.product_id as "productId", (array_agg(i.name))[1] as name, sum(i.qty)::int as qty,
               (select url from product_media m where m.product_id = i.product_id order by sort limit 1) as "imageUrl"
        from order_items i join orders o on o.id = i.order_id
        where o.tenant_id = ${t.id} and o.state not in ('cancelled', 'refunded')
          and o.placed_at >= (date_trunc('day', now() at time zone ${tz}) at time zone ${tz})
        group by i.product_id order by qty desc limit 3
      `;
      const busiest =
        (
          await tx<{ hour: number; orders: number }[]>`
          select extract(hour from placed_at at time zone ${tz})::int as hour, count(*)::int as orders
          from orders where tenant_id = ${t.id} and state not in ('cancelled', 'refunded')
            and placed_at >= (date_trunc('day', now() at time zone ${tz}) at time zone ${tz})
          group by 1 order by 2 desc limit 1
        `
        )[0] ?? null;

      return {
        greetingName: m.name.split(' ')[0],
        timezone: tz,
        status: { status: st.status, resumesAt: st.resumesAt ?? null, override: s.status_override },
        hours: s.hours,
        specialDays: s.special_days ?? [],
        today: {
          ...today,
          avgTicketCents: today.orders ? Math.round(today.salesCents / today.orders) : 0,
        },
        spark,
        waiting,
        inProgress,
        attention: attention.slice(0, 6),
        checklist,
        totalOrders: counts.orders,
        feed,
        live,
        best,
        busiest,
      };
    }),
  );
}
