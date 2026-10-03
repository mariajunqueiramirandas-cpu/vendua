import { defineTool, s, ToolError, type Json } from '@vendua/agent-runtime';
import { loadCartView, repriceLines, type CartView } from '../../../modules/cart.ts';
import { getProductById, getProductsById } from '../../../modules/catalog.ts';
import { createSacolaLinkTx } from '../../../modules/cart-share.ts';
import type { CheckoutInput } from '../../../modules/checkout.ts';
import { ordersByPhone } from '../../../modules/customer.ts';
import { loadOrderView } from '../../../modules/orders.ts';
import { preparePayment } from '../../../modules/payments/store-payments.ts';
import { placeOrderTx } from '../../../modules/place-order.ts';
import type { Sql } from '../../../platform/db.ts';
import { claimTx, HttpError } from '../../../platform/http.ts';
import {
  brl,
  linkCard,
  orderCard,
  pixCard,
  productCard,
  summaryCard,
  PAYMENT_LABEL,
} from '../../../vendedor/cards.ts';
import { vendedorDeps } from '../../../vendedor/deps.ts';
import { cartHash, readAnswer, unusualOrder, type CheckoutDraft } from '../../../vendedor/gate.ts';
import { loadAgent } from '../../../vendedor/settings.ts';
import type { SummaryRef, Thread } from '../../../vendedor/threads.ts';
import { handoffTx } from './handoff.ts';
import {
  briefText,
  cartBrief,
  core,
  ensureCart,
  isTest,
  pack,
  productIdOf,
  thread,
  viewCart,
  type Ctx,
} from './shared.ts';

/** Rolls a savepoint back on purpose: a dry run of the real checkout. */
class DryRun extends Error {
  constructor(readonly result: unknown) {
    super('dry run');
  }
}

type Savepointable = { savepoint: <T>(fn: (sp: Sql) => Promise<T>) => Promise<T> };

function checkoutInput(t: Thread, cart: CartView): CheckoutInput {
  const d = cart.delivery;
  const c: CheckoutDraft = t.checkout;
  const delivery: CheckoutInput['delivery'] = { mode: d?.mode ?? 'pickup' };
  if (d?.mode === 'delivery')
    for (const k of [
      'neighborhood',
      'address',
      'street',
      'number',
      'complement',
      'reference',
      'cep',
    ] as const)
      if (d[k]) (delivery as Record<string, unknown>)[k] = d[k];
  if (d?.lat != null && d.lng != null) {
    delivery.lat = d.lat;
    delivery.lng = d.lng;
  }
  return {
    customer: {
      name: c.name ?? 'Cliente',
      // a test thread's dry run never creates an order; a foreign number keeps its '+'
      phone: t.phone ?? c.phone ?? (t.channel === 'test' ? '11900000000' : ''),
    },
    delivery,
    payment: {
      method: c.payment?.method ?? 'pix',
      ...(c.payment?.method === 'cash' && c.payment.changeForCents
        ? { changeForCents: c.payment.changeForCents }
        : {}),
    },
    ...(c.notes ? { notes: c.notes } : {}),
    ...(c.scheduledFor ? { scheduledFor: c.scheduledFor } : {}),
  };
}

/** A personal coupon the phone already holds (a loyalty reward): the best one, applied first. */
async function bestOwnCoupon(ctx: Ctx, t: Thread, cartId: string): Promise<void> {
  if (t.channel !== 'whatsapp' || !t.phone || t.phone.startsWith('+')) return;
  const codes = await ctx.tx<{ code: string }[]>`
    select c.code from coupons c
    where c.tenant_id = ${ctx.tenantId} and c.phone = ${t.phone} and c.active
      and (c.ends_at is null or c.ends_at > now())
      and not exists (select 1 from coupon_redemptions r where r.coupon_id = c.id)
    order by c.created_at desc limit 5`;
  if (!codes.length) return;
  const sp = ctx.tx as unknown as Savepointable;
  let best: { code: string; cents: number } | null = null;
  for (const { code } of codes) {
    try {
      await sp.savepoint(async (tx) => {
        const { applyCouponTx } = await import('../../../modules/cart-ops.ts');
        const view = await applyCouponTx(tx, ctx.tenantId, cartId, code, t.phone, t.phone);
        throw new DryRun(view.coupon?.applies ? view.totals.discountCents : 0);
      });
    } catch (e) {
      if (!(e instanceof DryRun)) continue;
      const cents = Number(e.result);
      if (cents > 0 && (!best || cents > best.cents)) best = { code, cents };
    }
  }
  if (best) {
    const { applyCouponTx } = await import('../../../modules/cart-ops.ts');
    await applyCouponTx(ctx.tx, ctx.tenantId, cartId, best.code, t.phone, t.phone);
  }
}

async function averageTicket(ctx: Ctx): Promise<number | null> {
  const [r] = await ctx.tx<{ avg: number | null }[]>`
    select avg(total_cents)::int as avg from orders
    where tenant_id = ${ctx.tenantId} and state <> 'cancelled' and placed_at > now() - interval '90 days'`;
  return r?.avg ?? null;
}

export const sendSummaryTool = defineTool<Record<string, never>, Sql>({
  name: 'send_summary',
  description:
    'Quando nada falta: a loja calcula e valida o pedido como no site e gera o RESUMO (itens, entrega, descontos, total). O resumo vai junto com a sua próxima resposta, em que você pergunta se pode confirmar. Qualquer mudança depois exige um resumo novo.',
  effect: 'write',
  input: s.object({}),
  run: async (ctx: Ctx) => {
    const t = await thread(ctx, { forUpdate: true });
    if (t.channel === 'web')
      throw new ToolError(
        'No site o cliente fecha pela própria sacola da página: use send_link e diga para tocar em Finalizar.',
      );
    if (!t.cartId) throw new ToolError('A sacola está vazia.');
    const cartId = await ensureCart(ctx, t);
    await bestOwnCoupon(ctx, t, cartId);
    let cart = (await viewCart(ctx, { ...t, cartId }))!;
    const brief = cartBrief(ctx, cart, { ...t, cartId });
    const blocking = brief.missing.filter(
      (m) => !m.startsWith('pedido mínimo') || cart.totals.belowMinOrder,
    );
    if (brief.empty || blocking.length)
      throw new ToolError(`Ainda falta: ${blocking.join(' · ')}. Pergunte ao cliente.`);
    if (!pack(ctx).agent.capabilities.closeOrder)
      throw new ToolError(
        'Esta loja fecha o pedido pelo site: use send_link para mandar a sacola pronta.',
      );

    // the real checkout, rolled back: closed hours, zones, minimum, stock, schedule, payment.
    // After a repricing it runs again: new prices can break the minimum, a coupon or the change.
    for (let attempt = 0; ; attempt++) {
      const input = checkoutInput(t, cart);
      try {
        await (ctx.tx as unknown as Savepointable).savepoint(async (tx) => {
          await placeOrderTx(tx, ctx.tenantId, cartId, input, ctx.now, vendedorDeps().provider, {
            provenPhone:
              t.channel === 'whatsapp' && t.phone && !t.phone.startsWith('+') ? t.phone : null,
            source: 'whatsapp_agent',
            threadId: t.id,
          });
          throw new DryRun(null);
        });
      } catch (e) {
        if (e instanceof DryRun) break;
        if (!(e instanceof HttpError && e.code === 'PRICES_CHANGED') || attempt > 0)
          return core(() => Promise.reject(e));
        const products = await getProductsById(
          ctx.tx,
          ctx.tenantId,
          cart.items.map((i) => i.productId),
        );
        await repriceLines(ctx.tx, ctx.tenantId, cart.items, products);
        cart = (await viewCart(ctx, { ...t, cartId }))!;
      }
    }

    const agent = await loadAgent(ctx.tx, ctx.tenantId);
    const total = cart.totals.totalCents;
    const above = [
      agent.settings.handoff.aboveCents,
      ...pack(ctx)
        .guards.filter((g) => g.kind === 'handoff_above')
        .map((g) => (g as { cents: number }).cents),
    ].filter((x): x is number => typeof x === 'number');
    if (above.some((c) => total > c)) {
      const h = await handoffTx(
        ctx,
        t,
        'pedido grande',
        `Pedido de ${brl(total)} montado, acima do limite da loja.`,
      );
      return {
        data: h as unknown as Json,
        content:
          'Pedido acima do valor que a loja confere pessoalmente: passei para a loja. Diga que alguém da loja confirma já já.',
      };
    }
    for (const g of pack(ctx).guards)
      if (g.kind === 'handoff_qty') {
        const n = cart.items
          .filter((i) => !g.term || i.name.toLowerCase().includes(g.term))
          .reduce((a, i) => a + i.qty, 0);
        if (n >= g.min) {
          const h = await handoffTx(
            ctx,
            t,
            'pedido grande',
            `${n} itens${g.term ? ` (${g.term})` : ''} na sacola.`,
          );
          return {
            data: h as unknown as Json,
            content:
              'Regra da loja: pedidos assim passam para a loja. Diga que alguém da loja confirma já já.',
          };
        }
      }

    const unusual = unusualOrder(cart, await averageTicket(ctx));
    const id = `r${Date.now().toString(36)}`;
    const hash = cartHash(cart, t.checkout);
    const summary: SummaryRef = {
      id,
      hash,
      totalCents: total,
      messageId: null,
      sentAt: null,
      unusual: unusual.unusual,
    };
    await ctx.tx`update shopper_threads set summary = ${ctx.tx.json(summary as never)}, stage = 'confirming',
      updated_at = now() where id = ${t.id}`;
    ctx.card(
      summaryCard(id, cart, {
        paymentMethod: t.checkout.payment?.method ?? null,
        changeForCents: t.checkout.payment?.changeForCents ?? null,
        scheduledFor: t.checkout.scheduledFor ?? null,
        unusual: unusual.reasons,
        test: isTest(t),
      }),
    );
    ctx.figure('cart.total', { value: total, text: brl(total), kind: 'money' });
    return {
      content: `Resumo ${id} pronto (total {{cart.total}}): vai junto com a sua próxima resposta. Pergunte se pode confirmar${unusual.unusual ? ' e peça um "sim" simples: o pedido é fora do comum' : ''}. Não repita os valores, o resumo já mostra.`,
      data: { summary: id, cart: cartBrief(ctx, cart, { ...t, cartId }) as unknown as Json },
    };
  },
});

export const placeOrderTool = defineTool<Record<string, never>, Sql>({
  name: 'place_order',
  description:
    'Faz o pedido depois que o cliente respondeu SIM ao resumo mais recente. A loja confere que a sacola é a mesma do resumo; se algo mudou, mande um resumo novo.',
  effect: 'money',
  states: ['confirming'],
  input: s.object({}),
  run: async (ctx: Ctx) => {
    const t = await thread(ctx, { forUpdate: true });
    const summary = t.summary;
    if (!summary) throw new ToolError('Não há resumo aberto: use send_summary.');
    if (!summary.sentAt || !summary.messageId)
      throw new ToolError(
        'O resumo ainda não chegou ao cliente: mande-o junto com uma resposta e espere o sim.',
      );
    const [msg] = await ctx.tx<{ status: string }[]>`
      select status from shopper_messages where tenant_id = ${ctx.tenantId} and id = ${summary.messageId}`;
    if (msg?.status === 'draft')
      throw new ToolError('Ensaio: nenhum pedido é feito, só rascunhos.');
    // a yes only counts for a card WhatsApp delivered: queued or failed, the shopper never saw the total
    if (msg?.status === 'failed')
      throw new ToolError('O resumo não chegou ao cliente: mande outro com send_summary.');
    if (!msg || !['sent', 'delivered', 'read'].includes(msg.status))
      throw new ToolError(
        'O resumo ainda não chegou ao cliente. Diga que vai mandar o resumo e espere ele confirmar.',
      );
    // the shopper's answer: the latest message after the card, read deterministically
    const [answer] = await ctx.tx<{ id: string; body: string | null; transcript: string | null }[]>`
      select id, body, transcript from shopper_messages
      where tenant_id = ${ctx.tenantId} and thread_id = ${t.id} and author = 'shopper'
        and created_at > (select created_at from shopper_messages where id = ${summary.messageId})
      order by created_at desc limit 1`;
    const read = readAnswer(answer?.body ?? answer?.transcript ?? null);
    if (read === 'other')
      throw new ToolError(
        'A última mensagem do cliente depois do resumo não é um sim claro. Pergunte: "Posso confirmar? Responda sim."',
      );
    if (summary.unusual && read !== 'plain_yes')
      throw new ToolError('Pedido fora do comum: peça para o cliente responder só "sim".');
    if (!t.cartId) throw new ToolError('A sacola não existe mais.');
    const cartId = t.cartId;
    const test = isTest(t);
    const provenPhone =
      t.channel === 'whatsapp' && t.phone && !t.phone.startsWith('+') ? t.phone : null;

    type Placed =
      | { kind: 'placed'; orderId: string; number: number; totalCents: number }
      | {
          kind: 'test';
          totalCents: number;
          lines: { name: string; qty: number; options: string[] }[];
          checkout: CheckoutInput;
        }
      | { kind: 'refused'; code: string; details: Json };
    const claimed = await claimTx<Placed>(
      ctx.tx,
      ctx.tenantId,
      // per card: the same cart again (a reorder) is a new card, so a new order
      `vendedor:${t.id}:${cartId}:${summary.id}:${summary.hash}`,
      t.id,
      async () => {
        // the hash, checked after the cart row is locked: no edit can land between this and the order
        await ctx.tx`select 1 from carts where tenant_id = ${ctx.tenantId} and id = ${cartId} for update`;
        const method = t.checkout.payment?.method;
        const cart = await loadCartView(
          ctx.tx,
          ctx.tenantId,
          cartId,
          ctx.now,
          method ? { paymentMethod: method } : {},
        );
        if (cart.status !== 'open')
          return { status: 409, body: { kind: 'refused', code: 'CART_NOT_OPEN', details: null } };
        if (cartHash(cart, t.checkout) !== summary.hash)
          return { status: 409, body: { kind: 'refused', code: 'CART_CHANGED', details: null } };
        const input = checkoutInput(t, cart);
        if (test) {
          try {
            await (ctx.tx as unknown as Savepointable).savepoint(async (tx) => {
              await placeOrderTx(
                tx,
                ctx.tenantId,
                cartId,
                input,
                ctx.now,
                vendedorDeps().provider,
                {
                  provenPhone,
                  source: 'whatsapp_agent',
                  threadId: t.id,
                },
              );
              throw new DryRun(null);
            });
          } catch (e) {
            if (!(e instanceof DryRun)) throw e;
          }
          return {
            status: 200,
            body: {
              kind: 'test',
              totalCents: cart.totals.totalCents,
              lines: cart.items.map((i) => ({
                name: i.name,
                qty: i.qty,
                options: [...i.modifiers.map((m) => m.name), ...i.combo.map((c) => c.name)],
              })),
              checkout: input,
            },
          };
        }
        let orderId: string;
        try {
          orderId = await placeOrderTx(
            ctx.tx,
            ctx.tenantId,
            cartId,
            input,
            ctx.now,
            vendedorDeps().provider,
            {
              provenPhone,
              source: 'whatsapp_agent',
              threadId: t.id,
            },
          );
        } catch (e) {
          // the repriced lines commit with the refusal, as the checkout route does
          if (e instanceof HttpError && e.code === 'PRICES_CHANGED')
            return {
              status: 409,
              body: {
                kind: 'refused',
                code: 'PRICES_CHANGED',
                details: (e.details ?? null) as Json,
              },
            };
          throw e;
        }
        const [o] = await ctx.tx<{ number: number; total_cents: number }[]>`
        select number, total_cents from orders where tenant_id = ${ctx.tenantId} and id = ${orderId}`;
        // placeOrderTx recomputes fee, coupon and adjustment from live rows: never a total the shopper didn't see
        if (o!.total_cents !== summary.totalCents)
          throw new HttpError(409, 'TOTAL_CHANGED', 'the total moved since the summary');
        return {
          status: 201,
          body: { kind: 'placed', orderId, number: o!.number, totalCents: o!.total_cents },
        };
      },
    ).catch((e) => core(() => Promise.reject(e)));

    const r = claimed.body;
    if (r.kind === 'refused') {
      await ctx.tx`update shopper_threads set summary = null, stage = 'building', updated_at = now() where id = ${t.id}`;
      const why =
        r.code === 'PRICES_CHANGED'
          ? 'Um preço mudou agora há pouco.'
          : r.code === 'CART_CHANGED'
            ? 'A sacola mudou depois do resumo.'
            : 'A sacola já foi fechada.';
      return {
        content: `${why} Nada foi pedido. Mande um resumo novo (send_summary) e peça um novo sim.`,
      };
    }
    if (r.kind === 'test') {
      await ctx.tx`update shopper_threads set test_order = ${ctx.tx.json(r as never)}, summary = null, stage = 'ordered',
        updated_at = now() where id = ${t.id}`;
      ctx.figure('cart.total', { value: r.totalCents, text: brl(r.totalCents), kind: 'money' });
      return {
        content:
          'Pedido de TESTE validado como no checkout: nada vai para a cozinha. Diga ao cliente que é um pedido de teste.',
        data: { order: { id: 'test', number: 0, state: 'test' } },
      };
    }

    await ctx.tx`update shopper_threads set order_id = ${r.orderId}, summary = null, cart_id = null,
      stage = 'ordered', checkout = checkout - 'notes', updated_at = now() where id = ${t.id}`;
    await ctx.tx`update suggestion_events set outcome = 'taken', order_id = ${r.orderId}, decided_at = now()
      where tenant_id = ${ctx.tenantId} and thread_id = ${t.id} and outcome = 'offered'
        and product_id in (select product_id from order_items where order_id = ${r.orderId})`;
    await ctx.tx`update store_agent set first_sale_at = coalesce(first_sale_at, now()) where tenant_id = ${ctx.tenantId}`;
    const agent = await loadAgent(ctx.tx, ctx.tenantId);
    const method = t.checkout.payment?.method ?? 'pix';
    if (agent.settings.handoff.newCashCustomer && method === 'cash') {
      const [prior] = await ctx.tx<{ n: number }[]>`
        select count(*)::int as n from orders where tenant_id = ${ctx.tenantId} and customer_phone = ${provenPhone ?? t.checkout.phone ?? ''}
          and id <> ${r.orderId}`;
      if (!prior?.n)
        await ctx.tx`update shopper_threads set waiting_since = coalesce(waiting_since, now()),
          owner_reason = 'conferir: cliente novo pagando em dinheiro' where id = ${t.id}`;
    }
    ctx.figure('pedido.numero', { value: r.number, text: `#${r.number}`, kind: 'count' });
    ctx.figure('pedido.total', { value: r.totalCents, text: brl(r.totalCents), kind: 'money' });
    const order = await loadOrderView(ctx.tx, ctx.tenantId, r.orderId);
    let next = 'O pedido foi para a loja aceitar.';
    if (method === 'pix' || method === 'card_online') {
      if (order.payment.online) next += ' Agora chame send_pix para mandar o pagamento.';
      else if (
        method === 'pix' &&
        order.payment.pix?.copyPaste &&
        agent.settings.capabilities.sendPix
      ) {
        ctx.card(
          pixCard({
            orderNumber: r.number,
            totalCents: r.totalCents,
            copyPaste: order.payment.pix.copyPaste,
            expiresAt: null,
            timezone: pack(ctx).timezone,
          }),
        );
        next += ' O código Pix vai junto com a sua resposta; a loja confirma o pagamento.';
      }
    }
    return {
      content: `Pedido {{pedido.numero}} feito, total {{pedido.total}}. ${next} Agradeça em uma frase.`,
      data: { order: { id: r.orderId, number: r.number, state: 'placed' } },
    };
  },
});

export const sendPixTool = defineTool<Record<string, never>, Sql>({
  name: 'send_pix',
  description:
    'Manda o Pix copia e cola (ou o link do cartão) do pedido desta conversa, com a validade. Também gera um código novo quando o anterior expirou.',
  effect: 'money',
  states: ['ordered'],
  input: s.object({}),
  run: async (ctx: Ctx) => {
    const t = await thread(ctx, { forUpdate: true });
    if (!t.orderId) throw new ToolError('Nenhum pedido nesta conversa.');
    const agent = await loadAgent(ctx.tx, ctx.tenantId);
    if (!agent.settings.capabilities.sendPix)
      throw new ToolError(
        'A loja manda o pagamento ela mesma. Diga que a loja envia em instantes.',
      );
    const order = await loadOrderView(ctx.tx, ctx.tenantId, t.orderId);
    if (order.payment.status === 'paid') return { content: 'O pedido já está pago.' };
    if (order.state === 'cancelled') throw new ToolError('O pedido foi cancelado.');
    const [cartRow] = await ctx.tx<
      { cart_id: string }[]
    >`select cart_id from orders where id = ${t.orderId}`;
    const [tenant] = await ctx.tx<{ id: string; slug: string; name: string }[]>`
      select id, slug, name from tenants where id = ${ctx.tenantId}`;
    const [pixCount] = await ctx.tx<{ n: number }[]>`
      select count(*)::int as n from shopper_messages
      where tenant_id = ${ctx.tenantId} and thread_id = ${t.id} and kind = 'pix'`;
    const n = pixCount?.n ?? 0;
    const d = vendedorDeps();
    if (!order.payment.online) {
      if (!order.payment.pix?.copyPaste)
        throw new ToolError('Esta loja combina o pagamento pessoalmente.');
      ctx.card(
        pixCard({
          orderNumber: order.number,
          totalCents: order.totalCents,
          copyPaste: order.payment.pix.copyPaste,
          expiresAt: null,
          timezone: pack(ctx).timezone,
        }),
      );
      return { content: 'Código Pix vai junto com a sua resposta.' };
    }
    if (!d.sql) throw new ToolError('Pagamento online indisponível agora.');
    const next = await ctx.external(
      `order:${t.orderId}:pay:${n}`,
      async () =>
        (await preparePayment(
          { sql: d.sql!, provider: d.provider!, sessionSecret: d.sessionSecret },
          tenant!,
          t.orderId!,
          cartRow!.cart_id,
          { publicOrigin: d.publicOrigin ?? pack(ctx).url, storeDomain: d.storeDomain },
          ctx.now,
        )) as unknown as Json,
    );
    const p = next as { kind: string; copyPaste?: string; expiresAt?: string | null; url?: string };
    if (p.kind === 'pix' && p.copyPaste) {
      ctx.card(
        pixCard({
          orderNumber: order.number,
          totalCents: order.totalCents,
          copyPaste: p.copyPaste,
          expiresAt: p.expiresAt ?? null,
          timezone: pack(ctx).timezone,
        }),
      );
      await ctx.tx`update shopper_threads set stage = 'paying', updated_at = now() where id = ${t.id}`;
      return {
        content: 'Código Pix (com a validade) vai junto com a sua resposta. Não repita o código.',
      };
    }
    if (p.kind === 'redirect' && p.url) {
      ctx.card(linkCard({ url: p.url, label: `Pague o pedido #${order.number} com cartão:` }));
      await ctx.tx`update shopper_threads set stage = 'paying', updated_at = now() where id = ${t.id}`;
      return { content: 'Link de pagamento vai junto com a sua resposta.' };
    }
    return { content: 'Este pedido não precisa de pagamento agora.' };
  },
});

export const myOrdersTool = defineTool<Record<string, never>, Sql>({
  name: 'my_orders',
  description:
    'Os pedidos recentes deste cliente nesta loja (número, status, total, itens). Só os dele.',
  effect: 'read',
  input: s.object({}),
  run: async (ctx: Ctx) => {
    const t = await thread(ctx);
    if (!t.phone || t.phone.startsWith('+'))
      return { content: 'Sem o número do cliente não dá para ver pedidos anteriores.' };
    const orders = await ordersByPhone(ctx.tx, ctx.tenantId, t.phone, 5);
    if (!orders.length) return { content: 'Este cliente ainda não pediu aqui.' };
    return {
      content: orders
        .map((o) => {
          ctx.figure(`pedido${o.number}.total`, {
            value: o.totalCents,
            text: brl(o.totalCents),
            kind: 'money',
          });
          return `#${o.number} · ${o.state} · {{pedido${o.number}.total}} · ${o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}`;
        })
        .join('\n'),
    };
  },
});

const STATE_WORD: Record<string, string> = {
  placed: 'recebido, aguardando a loja aceitar',
  confirmed: 'aceito',
  preparing: 'em preparo',
  ready: 'pronto',
  out_for_delivery: 'saiu para entrega',
  delivered: 'entregue',
  cancelled: 'cancelado',
  refunded: 'estornado',
};

export const orderStatusTool = defineTool<{ number?: number | undefined }, Sql>({
  name: 'order_status',
  description:
    'Status ao vivo de um pedido deste cliente (o desta conversa, ou pelo número) e a previsão da loja. Diz se está atrasado.',
  effect: 'write',
  input: s.object({ number: s.int({ min: 1, max: 10_000_000 }).optional() }),
  run: async (ctx: Ctx, input) => {
    const t = await thread(ctx);
    const [o] = await ctx.tx<
      {
        id: string;
        number: number;
        state: string;
        total_cents: number;
        payment: { method: string; status: string };
        delivery: { promisedTo?: string | null };
        placed_at: Date;
      }[]
    >`select id, number, state, total_cents, payment, delivery, placed_at from orders
      where tenant_id = ${ctx.tenantId}
        and (${input.number ?? null}::int is not null and number = ${input.number ?? null}::int
             and customer_phone = ${t.phone ?? '-'}
          or ${input.number ?? null}::int is null and id = ${t.orderId ?? null}::uuid)
      limit 1`;
    if (!o) throw new ToolError('Pedido não encontrado para este cliente.');
    ctx.figure('pedido.numero', { value: o.number, text: `#${o.number}`, kind: 'count' });
    ctx.figure('pedido.status', {
      value: o.state,
      text: STATE_WORD[o.state] ?? o.state,
      kind: 'text',
    });
    const promised = o.delivery?.promisedTo ? new Date(o.delivery.promisedTo) : null;
    const late =
      !!promised && promised < ctx.now && !['delivered', 'cancelled', 'refunded'].includes(o.state);
    if (promised)
      ctx.figure('pedido.previsao', {
        value: promised.toISOString(),
        text: new Intl.DateTimeFormat('pt-BR', {
          timeZone: pack(ctx).timezone,
          hour: '2-digit',
          minute: '2-digit',
        }).format(promised),
        kind: 'time',
      });
    ctx.card(
      orderCard({
        number: o.number,
        state: o.state,
        totalCents: o.total_cents,
        payment: PAYMENT_LABEL[o.payment.method as keyof typeof PAYMENT_LABEL] ?? null,
        paymentUrl: null,
      }),
    );
    if (late) {
      const agent = await loadAgent(ctx.tx, ctx.tenantId);
      if (agent.settings.handoff.complaint) {
        const h = await handoffTx(
          ctx,
          await thread(ctx, { forUpdate: true }),
          'atraso',
          `Pedido #${o.number} passou da previsão.`,
        );
        return {
          data: h as unknown as Json,
          content:
            'Pedido {{pedido.numero}} está atrasado: passei para a loja. Peça desculpas e diga que a loja responde já.',
        };
      }
    }
    return {
      content: `Pedido {{pedido.numero}}: {{pedido.status}}${promised ? ', previsão {{pedido.previsao}}' : ''}. O cartão do pedido vai junto.`,
    };
  },
});

export const sendLinkTool = defineTool<Record<string, never>, Sql>({
  name: 'send_link',
  description:
    'Manda um link que abre o site da loja com esta sacola já montada (vale por 1 hora, uma vez). Use quando a loja fecha pedidos pelo site ou o cliente preferir.',
  effect: 'write',
  input: s.object({}),
  run: async (ctx: Ctx) => {
    const t = await thread(ctx, { forUpdate: true });
    const p = pack(ctx);
    if (t.channel === 'web') {
      ctx.card(linkCard({ url: `${p.url}/sacola`, label: 'Sua sacola, é só finalizar:' }));
      return { content: 'O link da sacola desta página vai junto com a sua resposta.' };
    }
    if (!t.cartId) {
      ctx.card(linkCard({ url: p.url, label: `Cardápio da ${p.storeName}:` }));
      return { content: 'Link do cardápio vai junto com a sua resposta.' };
    }
    const cartId = await ensureCart(ctx, t);
    const link = await core(() => createSacolaLinkTx(ctx.tx, ctx.tenantId, cartId, t.id, 60));
    ctx.card(
      linkCard({ url: `${p.url}/?cart=${link.code}`, label: 'Sua sacola pronta, é só finalizar:' }),
    );
    return { content: 'Link da sacola vai junto com a sua resposta.' };
  },
});

export const sendCardTool = defineTool<{ product: string }, Sql>({
  name: 'send_card',
  description: 'Mostra ao cliente o cartão de um produto (nome, preço e descrição da loja).',
  effect: 'write',
  input: s.object({ product: s.string({ min: 1, max: 80 }) }),
  run: async (ctx: Ctx, input) => {
    const id = await productIdOf(ctx, input.product);
    // the live projection get_product uses: promotions, schedules and stock already applied
    const p = await getProductById(ctx.tx, ctx.tenantId, id);
    if (!p) throw new ToolError('Produto não encontrado.');
    ctx.card(
      productCard({
        name: p.name,
        priceCents: p.basePriceCents,
        fromPriceCents: p.fromPriceCents,
        description: p.description,
        status: p.status,
      }),
    );
    return { content: 'O cartão vai junto com a sua resposta.' };
  },
});
