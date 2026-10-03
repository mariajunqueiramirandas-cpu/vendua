import { createHash } from 'node:crypto';
import type { CartView } from '../modules/cart.ts';
import type { PaymentMethod } from '../modules/payment-adjustments.ts';

// The confirmation gate's pure parts (sales-agent.md §4.7): the hash a summary card binds to,
// and the deterministic reading of the shopper's answer. An order exists only after a yes to the
// exact cart the shopper saw.

export interface CheckoutDraft {
  name?: string;
  phone?: string;
  payment?: { method: PaymentMethod; changeForCents?: number | null };
  scheduledFor?: string | null;
  notes?: string | null;
}

/**
 * Everything the shopper agreed to: each line's unit price and options, the fee, discount,
 * payment adjustment and total, how it's fulfilled and how it's paid. Any change is a new hash,
 * hence a new card, a new idempotency key and a new yes.
 */
export function cartHash(cart: CartView, draft: CheckoutDraft): string {
  const d = cart.delivery;
  const payload = {
    lines: cart.items
      .map((i) => ({
        p: i.productId,
        q: i.qty,
        u: i.unitPriceCents,
        m: [...i.modifiers].map((m) => `${m.id}:${m.qty}`).sort(),
        c: i.comboSelections.map((c) => `${c.slotId}:${c.productId}:${c.qty}`).sort(),
      }))
      .sort((a, b) => (a.p + a.m.join() + a.c.join()).localeCompare(b.p + b.m.join() + b.c.join())),
    fee: cart.totals.deliveryFeeCents,
    discount: cart.totals.discountCents,
    adjustment: cart.totals.paymentAdjustmentCents,
    total: cart.totals.totalCents,
    coupon: cart.coupon?.applies ? cart.coupon.code : null,
    fulfil: d
      ? {
          mode: d.mode,
          street: d.street ?? null,
          number: d.number ?? null,
          address: d.address ?? null,
          neighborhood: d.neighborhood ?? null,
          complement: d.complement ?? null,
          lat: d.lat ?? null,
          lng: d.lng ?? null,
        }
      : null,
    pay: draft.payment?.method ?? null,
    change: draft.payment?.changeForCents ?? null,
    when: draft.scheduledFor ?? null,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[!.,;:?…]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A plain yes: what an unusual order needs whatever else was said. */
const PLAIN = new Set(['sim', 's', 'ss', 'sim sim', 'confirmo', 'confirmado', 'pode', 'pode sim']);

const YES = new Set([
  ...PLAIN,
  'isso',
  'isso mesmo',
  'isso ai',
  'manda',
  'pode mandar',
  'manda ver',
  'manda bala',
  'fechado',
  'fecha',
  'pode fechar',
  'fechou',
  'confirma',
  'pode confirmar',
  'ok',
  'okay',
  'okk',
  'beleza',
  'blz',
  'perfeito',
  'certo',
  'ta certo',
  'esta certo',
  'ta otimo',
  'ta bom',
  'ta bem',
  'bora',
  'vamos',
  'pode ser',
  'quero',
  'yes',
  'sim pode',
  'sim por favor',
  'sim pf',
  'sim obrigado',
  'sim obrigada',
  'show',
  'top',
  'otimo',
]);

const YES_EMOJI = /^[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}️‍\s]+$/u;
const THUMBS = /[👍✅👌🙌🤝✔]/u;
const DOUBT =
  /\b(nao|n|espera|perai|pera|calma|muda|mudar|troca|trocar|tira|tirar|cancela|cancelar|menos|mais|errado|faltou|falta|sem|com|so que|mas|duvida|quanto|qual)\b|\?/;

export type Answer = 'yes' | 'plain_yes' | 'other';

/** Deterministic: "sim", "pode", "fechado", 👍 are a yes; anything with a doubt or a change is not. */
export function readAnswer(text: string | null | undefined): Answer {
  if (!text) return 'other';
  const raw = text.trim();
  if (raw.length === 0 || raw.length > 60) return 'other';
  if (YES_EMOJI.test(raw)) return THUMBS.test(raw) ? 'yes' : 'other';
  const f = fold(raw.replace(/\p{Extended_Pictographic}/gu, ' '));
  if (!f) return 'other';
  if (DOUBT.test(f)) return 'other';
  if (PLAIN.has(f)) return 'plain_yes';
  if (YES.has(f)) return 'yes';
  // "sim, pode mandar" and the like: every word from a yes phrase
  const words = f.split(' ');
  const vocab = new Set(
    [...YES].flatMap((p) => p.split(' ')).concat(['por', 'favor', 'obg', 'vlw']),
  );
  if (
    words.length <= 6 &&
    words.some((w) => w === 'sim' || w === 'pode' || w === 'manda') &&
    words.every((w) => vocab.has(w))
  )
    return words[0] === 'sim' ? 'plain_yes' : 'yes';
  return 'other';
}

export interface Unusual {
  unusual: boolean;
  reasons: string[];
}

/** An order the shopper must confirm with a plain "sim" (proposed thresholds, §4.7). */
export function unusualOrder(cart: CartView, averageTicketCents: number | null): Unusual {
  const reasons: string[] = [];
  for (const i of cart.items) if (i.qty > 10) reasons.push(`${i.qty}× ${i.name}`);
  if (
    averageTicketCents &&
    averageTicketCents > 0 &&
    cart.totals.totalCents > averageTicketCents * 4
  )
    reasons.push('valor bem acima do comum');
  return { unusual: reasons.length > 0, reasons };
}
