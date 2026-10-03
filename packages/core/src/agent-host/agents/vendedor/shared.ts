import { ToolError, type Json, type ToolContext } from '@vendua/agent-runtime';
import { loadCartView, type CartView } from '../../../modules/cart.ts';
import { createCartTx } from '../../../modules/cart-ops.ts';
import type { PaymentMethod } from '../../../modules/payment-adjustments.ts';
import { HttpError } from '../../../platform/http.ts';
import type { Sql } from '../../../platform/db.ts';
import { brl, lineText, PAYMENT_LABEL } from '../../../vendedor/cards.ts';
import { vendedorDeps } from '../../../vendedor/deps.ts';
import type { CheckoutDraft } from '../../../vendedor/gate.ts';
import type { StorePack } from '../../../vendedor/pack.ts';
import { mustThread, type Thread } from '../../../vendedor/threads.ts';

export type Ctx = ToolContext<Sql>;

export function pack(ctx: Ctx): StorePack {
  return ctx.state.context.tenant as unknown as StorePack;
}

export function thread(ctx: Ctx, opts: { forUpdate?: boolean } = {}): Promise<Thread> {
  return mustThread(ctx.tx, ctx.tenantId, ctx.subject.id, opts);
}

export function isTest(t: Thread): boolean {
  return t.channel === 'test';
}

/** The thread's open cart, created on first use. Agent carts never leave Core. */
export async function ensureCart(ctx: Ctx, t: Thread): Promise<string> {
  if (t.cartId) {
    const [c] = await ctx.tx<{ status: string }[]>`
      select status from carts where tenant_id = ${ctx.tenantId} and id = ${t.cartId} for update`;
    if (c?.status === 'open') return t.cartId;
  }
  // on the site the cart is the page's own: a finished one means the shopper starts over there
  if (t.channel === 'web')
    throw new ToolError(
      'O carrinho do site já foi finalizado. Peça para o cliente recarregar a página.',
    );
  const { cartId } = await createCartTx(ctx.tx, ctx.tenantId, vendedorDeps().sessionSecret);
  await ctx.tx`update shopper_threads set cart_id = ${cartId}, summary = null, updated_at = now()
    where id = ${t.id}`;
  return cartId;
}

export async function viewCart(ctx: Ctx, t: Thread): Promise<CartView | null> {
  if (!t.cartId) return null;
  const method = t.checkout.payment?.method;
  return loadCartView(
    ctx.tx,
    ctx.tenantId,
    t.cartId,
    ctx.now,
    method ? { paymentMethod: method } : {},
  );
}

/** A Core error the model can act on, in its words. */
export function asToolError(e: unknown): never {
  if (e instanceof HttpError)
    throw new ToolError(`${e.code}: ${e.message}`, (e.details ?? null) as Json);
  throw e;
}

export async function core<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    return asToolError(e);
  }
}

export interface CartBrief {
  lines: { alias: string; text: string; total: string }[];
  total: string | null;
  missing: string[];
  hints: string[];
  empty: boolean;
}

/** CARRINHO and FALTA (sales-agent.md §4.6): what makes small models reliable. */
export function cartBrief(ctx: Ctx, cart: CartView | null, t: Thread): CartBrief {
  if (!cart || !cart.items.length)
    return { lines: [], total: null, missing: ['itens'], hints: [], empty: true };
  const lines = cart.items.map((i) => ({
    alias: ctx.alias('line', i.id),
    text: lineText(i),
    total: brl(i.lineTotalCents),
  }));
  const tt = cart.totals;
  ctx.figure('cart.subtotal', {
    value: tt.subtotalCents,
    text: brl(tt.subtotalCents),
    kind: 'money',
  });
  ctx.figure('cart.total', { value: tt.totalCents, text: brl(tt.totalCents), kind: 'money' });
  if (cart.delivery?.mode === 'delivery')
    ctx.figure('cart.fee', {
      value: tt.deliveryFeeCents,
      text: tt.deliveryFeeCents ? brl(tt.deliveryFeeCents) : 'grátis',
      kind: 'money',
    });
  if (tt.discountCents)
    ctx.figure('cart.discount', {
      value: tt.discountCents,
      text: brl(tt.discountCents),
      kind: 'money',
    });
  if (tt.paymentAdjustmentCents)
    ctx.figure('cart.adjustment', {
      value: tt.paymentAdjustmentCents,
      text: brl(Math.abs(tt.paymentAdjustmentCents)),
      kind: 'money',
    });
  for (const [n, i] of cart.items.entries()) {
    const a = lines[n]!.alias;
    ctx.figure(`${a}.total`, {
      value: i.lineTotalCents,
      text: brl(i.lineTotalCents),
      kind: 'money',
    });
    ctx.figure(`${a}.item`, { value: i.productId, text: lineText(i), kind: 'product' });
  }
  const missing: string[] = [];
  const hints: string[] = [];
  const d = cart.delivery;
  if (!d) missing.push('entrega ou retirada');
  else if (d.mode === 'delivery' && !d.zoneId) missing.push('endereço de entrega dentro da área');
  if (!t.checkout.payment) missing.push('forma de pagamento');
  if (!t.checkout.name) missing.push('nome para o pedido');
  if (!t.phone && !t.checkout.phone && t.channel !== 'test')
    missing.push('telefone (o WhatsApp não mostrou o número)');
  if (cart.schedule.required && !t.checkout.scheduledFor)
    missing.push(`data da encomenda (a partir de ${cart.schedule.dates[0] ?? '—'})`);
  if (tt.belowMinOrder) {
    ctx.figure('cart.min_remaining', {
      value: tt.remainingMinOrderCents,
      text: brl(tt.remainingMinOrderCents),
      kind: 'money',
    });
    missing.push('pedido mínimo: faltam {{cart.min_remaining}}');
  }
  if (tt.freeDeliveryRemainingCents && tt.freeDeliveryRemainingCents > 0) {
    ctx.figure('cart.free_delivery_remaining', {
      value: tt.freeDeliveryRemainingCents,
      text: brl(tt.freeDeliveryRemainingCents),
      kind: 'money',
    });
    hints.push('faltam {{cart.free_delivery_remaining}} para a entrega grátis');
  }
  if (cart.coupon && !cart.coupon.applies)
    hints.push(`cupom ${cart.coupon.code} não vale ainda (${cart.coupon.reason ?? 'condição'})`);
  return { lines, total: brl(tt.totalCents), missing, hints, empty: false };
}

export function briefText(b: CartBrief): string {
  if (b.empty) return 'Sacola vazia.';
  return [
    `Sacola: ${b.lines.map((l) => `[${l.alias}] ${l.text} = {{${l.alias}.total}}`).join(' · ')}`,
    'Total: {{cart.total}}',
    b.missing.length
      ? `Falta: ${b.missing.join(' · ')}`
      : 'Nada falta: mande o resumo (send_summary).',
    ...b.hints,
  ].join('\n');
}

export async function saveCheckout(
  ctx: Ctx,
  t: Thread,
  patch: Partial<CheckoutDraft>,
): Promise<CheckoutDraft> {
  const next = { ...t.checkout, ...patch };
  await ctx.tx`update shopper_threads set checkout = ${ctx.tx.json(next as never)}, summary = null,
    updated_at = now() where id = ${t.id}`;
  return next;
}

export const paymentLabel = (m: PaymentMethod) => PAYMENT_LABEL[m];

/** The product behind a slug from the pack or an alias a tool handed out. */
export async function productIdOf(ctx: Ctx, ref: string): Promise<string> {
  const r = ref.trim();
  if (/^p\d+$/i.test(r)) return ctx.resolve(r, 'product');
  const [row] = await ctx.tx<{ id: string }[]>`
    select id from products where tenant_id = ${ctx.tenantId} and slug = ${r.toLowerCase()} and status <> 'archived'`;
  if (!row)
    throw new ToolError(`Produto desconhecido: ${r}. Use o código do cardápio ou search_catalog.`);
  return row.id;
}
