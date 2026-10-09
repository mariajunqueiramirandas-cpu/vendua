// The coupon and stamp-card rules as Core runs them, ported for the post's widgets (integer cents):
// packages/core/src/modules/coupons.ts (evaluateCoupon, COUPON_CODE_RE), customer.ts (stamp card,
// FIEL rewards), the shopper's words from packages/kernel/src/rules/errors.ts and the admin's
// defaults from apps/admin/src/features/marketing/Marketing.tsx.

export type Kind = 'percent' | 'fixed' | 'free_delivery';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** "R$ 1.234,56" with a no-break space, so it never splits */
export const brl = (cents: number) => BRL.format(cents / 100).replace(/\s/g, ' ');

/** an amount in hundredths of a cent, every digit kept: 113250 → "R$ 11,325" */
function exactBrl(hundredths: number): string {
  const reais = Math.floor(hundredths / 10000);
  const frac = String(hundredths % 10000)
    .padStart(4, '0')
    .replace(/0{1,2}$/, '');
  return `R$ ${reais.toLocaleString('pt-BR')},${frac}`;
}

/** the admin's code field: upper case, letters, numbers, _ and - (Marketing.tsx), 3–32 (coupons.ts) */
export const cleanCode = (v: string) =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
export const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

/** Bolos da Nena's menu, as the site's other demos price it */
export const MENU = [
  { id: 'chocolate', name: 'Bolo de chocolate molhadinho', cents: 4800 },
  { id: 'cenoura', name: 'Fatia de cenoura com brigadeiro', cents: 900 },
  { id: 'fatia', name: 'Fatia de chocolate', cents: 950 },
] as const;
export const FEE = 800;

export interface CouponDraft {
  kind: Kind;
  /** percent 1–100, or cents for a fixed coupon */
  value: number;
  minSubtotalCents: number;
  /** the coupon's switch in the admin list */
  active: boolean;
  /** "Vale até" set, and the order comes after it */
  expired: boolean;
  /** "Limitar o número de usos": the limit, or null */
  maxRedemptions: number | null;
  usedTotal: number;
  /** "Uma vez por cliente" */
  oncePerPhone: boolean;
  /** "Só no primeiro pedido" */
  firstOrderOnly: boolean;
}

export type Shopper = 'new' | 'returning' | 'used';

export type GateState = 'pass' | 'stop' | 'skip' | 'na';
export interface Gate {
  id: string;
  question: string;
  state: GateState;
  /** what the gate found, in plain words */
  note: string;
  /** what the shopper reads when it stops here (kernel rules/errors.ts) */
  says?: string;
}

/**
 * evaluateCoupon's checks in Core's order. The phone checks (personal, per phone, first order)
 * only run once the shopper typed a phone, at checkout; the others run on every cart read.
 */
export function gates(c: CouponDraft, subtotal: number, shopper: Shopper): Gate[] {
  const out: Gate[] = [];
  let stopped = false;
  const add = (g: Omit<Gate, 'state'>, ok: boolean, applies = true) => {
    if (!applies) out.push({ ...g, state: stopped ? 'skip' : 'na' });
    else if (stopped) out.push({ ...g, state: 'skip' });
    else {
      out.push({ ...g, state: ok ? 'pass' : 'stop' });
      if (!ok) stopped = true;
    }
  };
  add(
    {
      id: 'active',
      question: 'Está ligado?',
      note: c.active ? 'Ligado na lista de cupons.' : 'Você desligou o cupom.',
      says: 'Cupom não encontrado',
    },
    c.active,
  );
  add(
    {
      id: 'ends',
      question: 'Ainda está na validade?',
      note: c.expired ? 'O pedido veio depois do “Vale até”.' : 'Dentro do “Vale até”.',
      says: 'Esse cupom expirou',
    },
    !c.expired,
  );
  const limited = c.maxRedemptions != null;
  add(
    {
      id: 'total',
      question: 'Ainda tem usos?',
      note: limited
        ? `${c.usedTotal} de ${c.maxRedemptions} usos até agora.`
        : 'Sem limite de usos no total.',
      says: 'Esse cupom esgotou',
    },
    !limited || c.usedTotal < c.maxRedemptions!,
  );
  const missing = c.minSubtotalCents - subtotal;
  add(
    {
      id: 'min',
      question: 'Chegou no pedido mínimo?',
      note:
        c.minSubtotalCents === 0
          ? 'Sem pedido mínimo.'
          : missing > 0
            ? `Os itens somam ${brl(subtotal)}, o mínimo é ${brl(c.minSubtotalCents)}. O cupom fica na sacola e passa a valer quando chegar lá.`
            : `Os itens somam ${brl(subtotal)}, o mínimo é ${brl(c.minSubtotalCents)}.`,
      says: `Faltam ${brl(Math.max(0, missing))} para usar este cupom.`,
    },
    missing <= 0,
  );
  add(
    {
      id: 'personal',
      question: 'É de um cliente só?',
      note: 'Não: este vale para qualquer telefone. Só os prêmios do cartão fidelidade são pessoais.',
    },
    true,
    false,
  );
  add(
    {
      id: 'once',
      question: 'Este telefone já usou?',
      note: !c.oncePerPhone
        ? 'Pode usar quantas vezes quiser.'
        : shopper === 'used'
          ? 'Esse telefone já usou o cupom uma vez.'
          : 'Ainda não usou.',
      says: 'Você já usou esse cupom',
    },
    !(c.oncePerPhone && shopper === 'used'),
    c.oncePerPhone,
  );
  add(
    {
      id: 'first',
      question: 'É o primeiro pedido?',
      note:
        shopper === 'new'
          ? 'Nenhum pedido antes com esse telefone.'
          : 'Esse telefone já pediu na loja antes.',
      says: 'Cupom válido só no primeiro pedido',
    },
    shopper === 'new',
    c.firstOrderOnly,
  );
  return out;
}

export interface Discount {
  cents: number;
  /** how the number came out, in words */
  how: string;
}

/** evaluateCoupon's arithmetic: percent rounds down to the cent, and nothing goes below zero */
export function discountOf(c: CouponDraft, subtotal: number, fee: number): Discount {
  if (c.kind === 'percent') {
    const exact = subtotal * c.value; // hundredths of a cent
    const cents = Math.min(Math.floor(exact / 100), subtotal);
    const rest = exact % 100;
    const shown = `${c.value}% de ${brl(subtotal)}`;
    return {
      cents,
      how: rest
        ? `${shown} dá ${exactBrl(exact)}. A Venduá arredonda para baixo, no centavo: ${brl(cents)}.`
        : `${shown} dá ${brl(cents)} certinho.`,
    };
  }
  if (c.kind === 'fixed') {
    const cents = Math.min(c.value, subtotal);
    return {
      cents,
      how:
        cents < c.value
          ? `O desconto é de ${brl(c.value)}, mas os itens somam ${brl(subtotal)}: ele para aí, e o pedido nunca fica negativo.`
          : `${brl(c.value)} saem do valor dos itens.`,
    };
  }
  return {
    cents: fee,
    how: fee
      ? `A entrega de ${brl(fee)} sai da conta. Os itens não mudam.`
      : 'Na retirada não há entrega para zerar: o cupom passa, mas o desconto é zero.',
  };
}

export const kindWords = (kind: Kind, value: number) =>
  kind === 'percent'
    ? { big: `${value}%`, small: 'de desconto nos itens' }
    : kind === 'fixed'
      ? { big: brl(value), small: 'de desconto nos itens' }
      : { big: 'Entrega', small: 'zerada no pedido' };

/** the storefront's name for a reward (couponLabel), except the one word this site never says */
export const rewardWords = (kind: Kind, value: number) =>
  kind === 'percent'
    ? `${value}% off`
    : kind === 'fixed'
      ? `${brl(value)} off`
      : 'a entrega zerada';
