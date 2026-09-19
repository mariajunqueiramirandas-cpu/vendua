import type { CartItem, Order } from '@vendua/kernel';
import { formatBRL } from './format.ts';

/**
 * WhatsApp deep links (wa.me) — the reference storefront's main contact
 * channel for orders, waitlist and out-of-range delivery. The Kernel exposes
 * `store.whatsapp`; everything else is text building (OBSERVATIONS.md).
 */
export function waLink(whatsapp: string | null | undefined, text?: string): string | null {
  const digits = whatsapp?.replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

const PAYMENT_LABEL: Record<string, string> = {
  pix: 'Pix',
  card_on_delivery: 'Cartão na entrega',
  cash: 'Dinheiro',
};

function itemsText(items: CartItem[]): string {
  return items
    .map((item) => {
      let line = `- ${item.qty}x ${item.name} (${formatBRL(item.lineTotalCents)})`;
      for (const m of item.modifiers) {
        line += `\n  └ ${m.name}${m.priceDeltaCents > 0 ? ` (+${formatBRL(m.priceDeltaCents)})` : ''}`;
      }
      return line;
    })
    .join('\n');
}

export function orderWhatsAppMessage(
  order: Order,
  items: CartItem[],
  storeName: string,
  notes?: string,
): string {
  const addressText = typeof order.delivery.address === 'string' ? order.delivery.address : null;
  return (
    `Olá! Acabei de fazer o pedido *#${order.number}* na ${storeName}:\n\n` +
    `*Cliente:* ${order.customer.name}\n` +
    `*Tipo:* ${order.delivery.mode === 'delivery' ? 'Entrega' : 'Retirada no local'}\n` +
    (addressText ? `*Endereço:* ${addressText}\n` : '') +
    (order.delivery.neighborhood ? `*Bairro:* ${order.delivery.neighborhood}\n` : '') +
    `*Pagamento:* ${PAYMENT_LABEL[order.payment.method] ?? order.payment.method}\n` +
    (notes ? `*Observações:* ${notes}\n` : '') +
    `\n*Doces escolhidos:*\n${itemsText(items)}\n\n` +
    (order.deliveryFeeCents > 0 ? `*Entrega:* ${formatBRL(order.deliveryFeeCents)}\n` : '') +
    `*Total:* ${formatBRL(order.totalCents)}`
  );
}
