import {
  ArrowCounterClockwise,
  ClockCounterClockwise,
  CreditCard,
  CurrencyCircleDollar,
  HourglassMedium,
  Money,
  Prohibit,
  Scales,
  WarningOctagon,
} from '@phosphor-icons/react';
import { ApiError, type PaymentReview, type PayMethod } from '../lib/api.ts';
import { cn } from './cn.ts';
import { messageOf } from './feedback.tsx';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const TONE: Record<Tone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  neutral: 'bg-[var(--st-cancelado)] text-[var(--st-cancelado-ink)]',
};

export const METHOD_LABEL: Record<PayMethod, string> = {
  pix: 'Pix',
  card_online: 'Cartão pelo Mercado Pago',
  card_on_delivery: 'Cartão na entrega',
  cash: 'Dinheiro',
  meal_voucher: 'Vale-refeição',
};

type Pay = { method: PayMethod | string; status: string; online?: boolean | undefined };
type Meta = { label: string; tone: Tone; Icon: typeof Money };

/**
 * The payment's state in a word, a tone and an icon. `quiet` (cards, rows) drops what the
 * kitchen doesn't need to see: an offline payment that is simply collected on delivery.
 */
export function paymentMeta(p: Pay, quiet = false): Meta | null {
  const card = p.method === 'card_online' || p.method === 'card_on_delivery';
  switch (p.status) {
    case 'paid':
      return {
        label: p.online ? 'Pago online' : 'Pago',
        tone: 'success',
        Icon: CurrencyCircleDollar,
      };
    case 'pending':
      if (p.method === 'pix')
        return {
          label: p.online ? 'Aguardando Pix' : 'Pix a conferir',
          tone: 'warning',
          Icon: HourglassMedium,
        };
      if (p.method === 'card_online')
        return { label: 'Aguardando cartão', tone: 'warning', Icon: HourglassMedium };
      return quiet
        ? null
        : { label: 'Paga na entrega', tone: 'neutral', Icon: card ? CreditCard : Money };
    case 'failed':
      return { label: 'Pagamento recusado', tone: 'danger', Icon: Prohibit };
    case 'expired':
      return {
        label: p.method === 'pix' ? 'Pix expirou' : 'Pagamento expirou',
        tone: 'neutral',
        Icon: ClockCounterClockwise,
      };
    case 'refunded':
      return { label: 'Reembolsado', tone: 'neutral', Icon: ArrowCounterClockwise };
    case 'partially_refunded':
      return { label: 'Reembolso parcial', tone: 'info', Icon: ArrowCounterClockwise };
    case 'charged_back':
      return { label: 'Contestado', tone: 'danger', Icon: WarningOctagon };
    case 'in_mediation':
      return { label: 'Em disputa', tone: 'warning', Icon: Scales };
    default:
      return null;
  }
}

/** One Mercado Pago attempt (a `payments` row), in the same words as the order's payment. */
export function attemptMeta(kind: 'pix' | 'card', status: string): Meta {
  const method = kind === 'pix' ? 'pix' : 'card_online';
  if (status === 'cancelled') return { label: 'Cancelado', tone: 'neutral', Icon: Prohibit };
  const s =
    status === 'approved'
      ? 'paid'
      : status === 'rejected'
        ? 'failed'
        : status === 'creating'
          ? 'pending'
          : status;
  return (
    paymentMeta({ method, status: s, online: true }) ?? {
      label: status,
      tone: 'neutral',
      Icon: HourglassMedium,
    }
  );
}

export function MetaChip({ meta: m, className }: { meta: Meta; className?: string | undefined }) {
  return (
    <span
      className={cn(
        't-caption inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-semibold',
        TONE[m.tone],
        className,
      )}
    >
      <m.Icon weight="bold" className="size-4" aria-hidden />
      {m.label}
    </span>
  );
}

export function PaymentChip({
  payment,
  quiet,
  className,
}: {
  payment: Pay;
  quiet?: boolean;
  className?: string | undefined;
}) {
  const m = paymentMeta(payment, quiet);
  return m ? <MetaChip meta={m} className={className} /> : null;
}

const PAY_ERRORS: Record<string, string> = {
  MP_NOT_CONNECTED: 'Conecte o Mercado Pago antes de ligar o cartão pelo site.',
  MP_UNAVAILABLE: 'O pagamento online ainda não está disponível na sua loja.',
  PAYMENT_ONLINE: 'Esse pagamento é pelo Mercado Pago: ele confirma sozinho, sem você marcar.',
  PAYMENT_UNAVAILABLE: 'O Mercado Pago não respondeu agora. Tente de novo em instantes.',
  PROVIDER_ERROR: 'O Mercado Pago não respondeu agora. Tente de novo em instantes.',
  NOT_PAID: 'Esse pedido ainda não foi pago, então não há o que devolver.',
  NOTHING_TO_REFUND: 'Esse pagamento já foi devolvido por inteiro.',
  ALREADY_REFUNDED: 'Esse pagamento já foi devolvido por inteiro.',
  REFUND_TOO_LARGE: 'O valor passa do que ainda dá para devolver. Confira e tente de novo.',
  REFUND_EXCEEDS: 'O valor passa do que ainda dá para devolver. Confira e tente de novo.',
  INVALID_AMOUNT: 'Digite um valor maior que zero, até o que ainda dá para devolver.',
  REFUND_NOT_ALLOWED:
    'O Mercado Pago não aceita devolver esse pagamento agora. Veja no app do Mercado Pago.',
  REFUND_FAILED:
    'O Mercado Pago recusou a devolução. Confira o saldo da sua conta Mercado Pago e tente de novo.',
  INSUFFICIENT_FUNDS:
    'Falta saldo na sua conta Mercado Pago para devolver. Adicione saldo e tente de novo.',
  PAYMENT_METHOD_UNAVAILABLE: 'Essa forma de pagamento não está disponível agora.',
};

/** Money Core couldn't settle by itself: what happened, and what the merchant does about it. */
export const REVIEW: Record<PaymentReview, { title: string; body: string }> = {
  unverified: {
    title: 'Pagamento sem confirmação',
    body: 'Não conseguimos conferir este pagamento com o Mercado Pago porque a conexão caiu. Conecte o Mercado Pago de novo e a gente confere.',
  },
  amount_mismatch: {
    title: 'Valor pago diferente do pedido',
    body: 'O cliente pagou um valor diferente do total. Confirme com ele e, se pagou a mais, devolva a diferença pelo pedido.',
  },
  paid_twice: {
    title: 'Pedido pago duas vezes',
    body: 'Chegou um segundo pagamento para este pedido. Confira com o cliente e devolva um deles pelo pedido.',
  },
  refund_duplicate: {
    title: 'Devolução registrada duas vezes',
    body: 'O Mercado Pago mostrou esta devolução repetida. Confira no app do Mercado Pago quanto saiu de fato.',
  },
  refund_amount_mismatch: {
    title: 'Devolução com valor diferente',
    body: 'O valor devolvido não bate com o que você pediu. Confira no app do Mercado Pago.',
  },
  refund_failed: {
    title: 'A devolução não passou',
    body: 'O Mercado Pago não concluiu a devolução. Confira o saldo no app do Mercado Pago e tente de novo pelo pedido.',
  },
};

/** messageOf, plus what money actions can say (Core's payment error codes). */
export function payError(err: unknown): string {
  if (
    err instanceof ApiError &&
    err.code === 'PAYMENT_UNAVAILABLE' &&
    err.details?.reason === 'conflict'
  )
    return 'O Mercado Pago ainda está processando este pagamento. Espere um instante e tente de novo.';
  if (err instanceof ApiError && err.code === 'PAYMENT_UNAVAILABLE')
    return PAY_ERRORS.PAYMENT_UNAVAILABLE!;
  if (err instanceof ApiError && err.status < 500 && PAY_ERRORS[err.code])
    return PAY_ERRORS[err.code]!;
  if (err instanceof ApiError && err.status === 502) return PAY_ERRORS.PROVIDER_ERROR!;
  return messageOf(err);
}
