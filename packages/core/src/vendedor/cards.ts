import type { Card, Json } from '@vendua/agent-runtime';
import type { CartView, PricedItem } from '../modules/cart.ts';
import type { PaymentMethod } from '../modules/payment-adjustments.ts';

// Cards are Core's words (sales-agent.md §4.7): the summary is a receipt "calculado pela loja",
// the Pix code goes alone so it copies in one tap. The model never writes them; the verifier
// exempts them.

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** `R$ 12,90` with a regular space, as the verifier and WhatsApp read it. */
export const brl = (cents: number) => BRL.format(cents / 100).replace(/ /g, ' ');

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  card_online: 'cartão pelo link',
  card_on_delivery: 'cartão na entrega',
  cash: 'dinheiro',
  meal_voucher: 'vale-refeição na entrega',
};

export function lineText(i: PricedItem): string {
  const opts = [
    ...i.modifiers.map((m) => (m.qty > 1 ? `${m.qty}× ${m.name}` : m.name)),
    ...i.combo.map((c) => (c.qty > 1 ? `${c.qty}× ${c.name}` : c.name)),
  ];
  return `${i.qty}× ${i.name}${opts.length ? ` (${opts.join(', ')})` : ''}${i.note ? ` — obs.: ${i.note}` : ''}`;
}

export interface SummaryCardData {
  id: string;
  lines: { text: string; totalCents: number }[];
  subtotalCents: number;
  feeCents: number;
  discountCents: number;
  discountLabel: string | null;
  adjustmentCents: number;
  totalCents: number;
  mode: 'pickup' | 'delivery';
  address: string | null;
  eta: string | null;
  payment: string | null;
  changeForCents: number | null;
  scheduledFor: string | null;
  unusual: string[];
  test: boolean;
}

export function summaryCard(
  id: string,
  cart: CartView,
  o: {
    paymentMethod: PaymentMethod | null;
    changeForCents: number | null;
    scheduledFor: string | null;
    unusual: string[];
    test: boolean;
  },
): Card {
  const d = cart.delivery;
  const address =
    d?.mode === 'delivery'
      ? [
          d.street && d.number ? `${d.street}, ${d.number}` : d.address,
          d.complement,
          d.neighborhood,
        ]
          .filter(Boolean)
          .join(' · ') || null
      : null;
  const eta = d?.etaMin != null && d.etaMax != null ? `${d.etaMin}–${d.etaMax} min` : null;
  const data: SummaryCardData = {
    id,
    lines: cart.items.map((i) => ({ text: lineText(i), totalCents: i.lineTotalCents })),
    subtotalCents: cart.totals.subtotalCents,
    feeCents: cart.totals.deliveryFeeCents,
    discountCents: cart.totals.discountCents,
    discountLabel: cart.coupon?.applies ? cart.coupon.label || cart.coupon.code : null,
    adjustmentCents: cart.totals.paymentAdjustmentCents,
    totalCents: cart.totals.totalCents,
    mode: d?.mode ?? 'pickup',
    address,
    eta,
    payment: o.paymentMethod ? PAYMENT_LABEL[o.paymentMethod] : null,
    changeForCents: o.changeForCents,
    scheduledFor: o.scheduledFor,
    unusual: o.unusual,
    test: o.test,
  };
  return { kind: 'summary', data: data as unknown as Json };
}

function scheduledText(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

export function renderSummary(c: SummaryCardData): string {
  const out: string[] = [`🧾 *${c.test ? 'Pedido de teste' : 'Seu pedido'}* · calculado pela loja`];
  for (const l of c.lines) out.push(`${l.text} — ${brl(l.totalCents)}`);
  out.push(`Subtotal — ${brl(c.subtotalCents)}`);
  if (c.mode === 'delivery')
    out.push(`Entrega${c.eta ? ` (${c.eta})` : ''} — ${c.feeCents ? brl(c.feeCents) : 'grátis'}`);
  if (c.discountCents)
    out.push(
      `Desconto${c.discountLabel ? ` (${c.discountLabel})` : ''} — −${brl(c.discountCents)}`,
    );
  if (c.adjustmentCents)
    out.push(
      `${c.adjustmentCents < 0 ? 'Desconto no pagamento' : 'Taxa do pagamento'} — ${c.adjustmentCents < 0 ? '−' : ''}${brl(Math.abs(c.adjustmentCents))}`,
    );
  out.push(`*Total — ${brl(c.totalCents)}*`);
  out.push(c.mode === 'delivery' ? `Entrega em: ${c.address ?? '—'}` : 'Retirada na loja');
  if (c.scheduledFor) out.push(`Para: ${scheduledText(c.scheduledFor)}`);
  if (c.payment)
    out.push(
      `Pagamento: ${c.payment}${c.changeForCents ? ` · troco para ${brl(c.changeForCents)}` : ''}`,
    );
  if (c.unusual.length) out.push(`⚠️ Confira: ${c.unusual.join(' · ')}`);
  if (c.test) out.push('Pedido de teste · não vai para a cozinha');
  out.push(
    c.unusual.length
      ? 'Para confirmar, responda *sim*.'
      : 'Está tudo certo? Responda *sim* para confirmar.',
  );
  return out.join('\n');
}

export interface PixCardData {
  orderNumber: number;
  totalCents: number;
  copyPaste: string;
  expiresAt: string | null;
  timezone: string;
}

export function pixCard(d: PixCardData): Card {
  return { kind: 'pix', data: d as unknown as Json };
}

/** Two messages: what it is, then the code alone. */
export function renderPix(d: PixCardData): string[] {
  const until = d.expiresAt
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: d.timezone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(d.expiresAt))
    : null;
  return [
    `💠 Pix do pedido #${d.orderNumber} · ${brl(d.totalCents)}${until ? ` · válido até ${until}` : ''}\nCopie o código abaixo e cole no app do seu banco, em Pix copia e cola.`,
    d.copyPaste,
  ];
}

export interface LinkCardData {
  url: string;
  label: string;
}

export function linkCard(d: LinkCardData): Card {
  return { kind: 'link', data: d as unknown as Json };
}

export interface OrderCardData {
  number: number;
  state: string;
  totalCents: number;
  payment: string | null;
  paymentUrl: string | null;
}

export function orderCard(d: OrderCardData): Card {
  return { kind: 'order', data: d as unknown as Json };
}

const STATE_LABEL: Record<string, string> = {
  placed: 'recebido, aguardando a loja aceitar',
  confirmed: 'aceito pela loja',
  preparing: 'em preparo',
  ready: 'pronto',
  out_for_delivery: 'saiu para entrega',
  delivered: 'entregue',
  cancelled: 'cancelado',
  refunded: 'estornado',
};

export interface ProductCardData {
  name: string;
  priceCents: number;
  fromPriceCents: number | null;
  description: string | null;
  status: string;
}

export function productCard(d: ProductCardData): Card {
  return { kind: 'product', data: d as unknown as Json };
}

/** Each card as the WhatsApp messages it becomes; one card can be more than one message. */
export function renderCard(card: Card): string[] {
  const d = card.data as Record<string, unknown>;
  switch (card.kind) {
    case 'summary':
      return [renderSummary(d as unknown as SummaryCardData)];
    case 'pix':
      return renderPix(d as unknown as PixCardData);
    case 'link': {
      const l = d as unknown as LinkCardData;
      return [`${l.label}\n${l.url}`];
    }
    case 'order': {
      const o = d as unknown as OrderCardData;
      const lines = [
        `📦 Pedido #${o.number} · ${STATE_LABEL[o.state] ?? o.state}`,
        `Total — ${brl(o.totalCents)}${o.payment ? ` · ${o.payment}` : ''}`,
      ];
      if (o.paymentUrl) lines.push(`Pague pelo link: ${o.paymentUrl}`);
      return [lines.join('\n')];
    }
    case 'product': {
      const p = d as unknown as ProductCardData;
      const price = p.fromPriceCents ? `a partir de ${brl(p.fromPriceCents)}` : brl(p.priceCents);
      return [
        `*${p.name}* — ${price}${p.status !== 'active' ? ' · esgotado agora' : ''}${p.description ? `\n${p.description.slice(0, 300)}` : ''}`,
      ];
    }
    default:
      return [];
  }
}
