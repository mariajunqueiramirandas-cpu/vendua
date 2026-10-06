import {
  ArrowCounterClockwise,
  CashRegister,
  CheckCircle,
  CreditCard,
  Money,
  PixLogo,
} from '@phosphor-icons/react';
import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Order, OrderPayment } from '../../lib/api.ts';
import { clock, money, when } from '../../lib/format.ts';
import { useFeature } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { Notice } from '../../ui/Notice.tsx';
import { attemptMeta, PAY_LABEL, PDV_METHOD_LABEL, REVIEW } from '../../ui/PaymentChip.tsx';
import { Bone } from '../../ui/skeletons.tsx';
import { useMarkPaid } from './actions.ts';

// the PDV's payment flow, only fetched when someone receives an order at the counter
const ReceiveSheet = lazy(() => import('../pdv/ReceiveSheet.tsx'));

const SETTLED = ['approved', 'partially_refunded', 'refunded', 'charged_back', 'in_mediation'];

/** The attempt that carries the money (the paid one), else the latest. */
export function primaryPayment(payments: OrderPayment[] | undefined): OrderPayment | null {
  if (!payments?.length) return null;
  const byNew = [...payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return byNew.find((p) => SETTLED.includes(p.status)) ?? byNew[0]!;
}

/** What can still go back on this attempt (Core's figure). */
export const refundable = (p: OrderPayment | null) =>
  !p || !(p.status === 'approved' || p.status === 'partially_refunded') ? 0 : p.refundableCents;

function methodLabel(o: Order) {
  const split = o.payment.pdv;
  if (o.payment.method === 'mixed' && split?.length)
    return split.map((x) => `${PDV_METHOD_LABEL[x.method]} ${money(x.cents)}`).join(' + ');
  if (o.payment.provider === 'pdv' && o.payment.method !== 'tab')
    return `${PAY_LABEL[o.payment.method] ?? o.payment.method} no caixa`;
  if (o.payment.method === 'pix')
    return o.payment.online ? 'Pix pelo Mercado Pago' : 'Pix na chave da loja';
  return PAY_LABEL[o.payment.method] ?? o.payment.method;
}

function explain(o: Order): string {
  const p = o.payment;
  const online = !!p.online;
  switch (p.status) {
    case 'paid':
      return online
        ? `Pago${p.paidAt ? ` ${when(p.paidAt)}` : ''} · confirmado pelo Mercado Pago`
        : `${p.provider === 'pdv' ? 'Pago no caixa' : 'Pago'}${p.confirmedBy ? `, recebido por ${p.confirmedBy}` : ''}`;
    case 'pending':
      if (p.method === 'tab') return 'Paga junto com a comanda, quando ela fechar.';
      if (online && p.method === 'pix')
        return p.pix?.expiresAt
          ? `O Mercado Pago confirma sozinho quando o cliente pagar. O Pix vale até ${clock(p.pix.expiresAt)}.`
          : 'O Mercado Pago confirma sozinho quando o cliente pagar.';
      if (online) return 'O cliente está pagando no Mercado Pago. A confirmação chega sozinha.';
      return p.method === 'pix'
        ? 'Aguardando o Pix — confira no seu banco'
        : 'Recebe na entrega ou retirada';
    case 'failed':
      return 'O pagamento não passou. O cliente pode tentar de novo pela página do pedido.';
    case 'expired':
      return 'O Pix venceu sem pagamento. O cliente pode gerar outro pela página do pedido.';
    case 'refunded':
      return 'O valor foi devolvido ao cliente.';
    case 'partially_refunded':
      return `${money(p.refundedCents ?? 0)} devolvido ao cliente.`;
    case 'charged_back':
      return 'O cliente contestou a compra com o banco. Acompanhe no app do Mercado Pago.';
    case 'in_mediation':
      return 'O cliente abriu uma reclamação no Mercado Pago. Responda por lá.';
    default:
      return '';
  }
}

const REFUND_STATE = { pending: 'processando', approved: 'devolvido', rejected: 'não passou' };

/** Payment on the order detail: method, state, Mercado Pago's numbers, refunds, the action. */
export function PaymentSection({
  order,
  payments,
  canRefund,
  onRefund,
}: {
  order: Order;
  payments: OrderPayment[] | undefined;
  canRefund: boolean;
  onRefund: () => void;
}) {
  const paid = useMarkPaid();
  const p = order.payment;
  const online = !!p.online;
  const main = primaryPayment(payments);
  const others = (payments ?? []).filter((x) => x.id !== main?.id);
  const Icon = p.method === 'pix' ? PixLogo : p.method === 'cash' ? Money : CreditCard;
  const settled = main && SETTLED.includes(main.status);
  const refunds = (payments ?? []).flatMap((x) => x.refunds);
  const reviews = (payments ?? []).filter((x) => x.review && REVIEW[x.review]);
  const pdvOpen = useFeature('pdv');
  const [receiving, setReceiving] = useState(false);
  const open = !['cancelled', 'refunded'].includes(order.state);
  // a PDV order's money is the caixa's: Core refuses "marcar pago" on it
  const pdv = p.provider === 'pdv';
  const canMarkPaid = !online && !pdv && p.status !== 'paid' && open;
  const canReceive = pdvOpen && !online && !pdv && p.status !== 'paid' && open;

  return (
    <Card as="section" aria-label="pagamento" className="divide-y divide-line">
      <div className="flex items-start gap-3 p-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken">
          <Icon weight="duotone" className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{methodLabel(order)}</p>
          <p className={cn('t-body mt-1', p.status === 'paid' ? 'text-success' : 'text-muted')}>
            {explain(order)}
          </p>
        </div>
      </div>

      {reviews.length ? (
        <div className="space-y-2 p-4">
          {reviews.map((x) => (
            <Notice key={x.id} tone="warning" title={REVIEW[x.review!].title}>
              {REVIEW[x.review!].body}
            </Notice>
          ))}
        </div>
      ) : null}

      {online && payments === undefined && p.status !== 'pending' ? (
        <div className="space-y-2 p-4" aria-hidden>
          <Bone className="h-4 w-2/3" />
          <Bone className="h-4 w-1/2" />
        </div>
      ) : null}

      {main && settled ? (
        <dl className="t-body space-y-1.5 p-4">
          <div className="flex justify-between gap-3 text-muted">
            <dt>Valor pago</dt>
            <dd className="tnum">{money(main.amountCents)}</dd>
          </div>
          {main.providerFeeCents !== null ? (
            <div className="flex justify-between gap-3 text-muted">
              <dt>Taxa do Mercado Pago</dt>
              <dd className="tnum">−{money(main.providerFeeCents)}</dd>
            </div>
          ) : null}
          {main.netCents !== null ? (
            <div className="flex justify-between gap-3 font-semibold">
              <dt>Você recebe</dt>
              <dd className="tnum">{money(main.netCents)}</dd>
            </div>
          ) : (
            <p className="t-caption text-muted">
              A taxa e o valor líquido aparecem quando o Mercado Pago liberar.
            </p>
          )}
        </dl>
      ) : null}

      {refunds.length ? (
        <div className="p-4">
          <p className="t-label mb-2">Devoluções</p>
          <ul className="space-y-2">
            {refunds.map((r, i) => (
              <li key={i} className="flex items-start gap-3">
                <ArrowCounterClockwise className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="t-body">
                    <span className="tnum font-semibold">{money(r.amountCents)}</span>
                    {r.reason ? <span className="text-muted"> · {r.reason}</span> : null}
                  </p>
                  <p
                    className={cn(
                      't-caption',
                      r.status === 'rejected' ? 'text-danger' : 'text-muted',
                    )}
                  >
                    {REFUND_STATE[r.status]} · {when(r.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {others.length ? (
        <p className="t-caption px-4 py-3 text-muted">
          {others.length === 1 ? 'Outra tentativa: ' : 'Outras tentativas: '}
          {others
            .map((x) => `${attemptMeta(x.kind, x.status).label} (${clock(x.createdAt)})`)
            .join(' · ')}
        </p>
      ) : null}

      {pdv && p.method === 'tab' && order.delivery.tabId && pdvOpen ? (
        <div className="p-4">
          <Link
            to={`/pdv/comanda/${order.delivery.tabId}`}
            className="t-label inline-flex min-h-11 items-center underline underline-offset-2"
          >
            abrir a comanda
          </Link>
        </div>
      ) : null}

      {canRefund || canMarkPaid || canReceive ? (
        <div className="flex flex-wrap gap-2 p-4">
          {canReceive ? (
            <Button icon={<CashRegister />} onClick={() => setReceiving(true)}>
              receber no caixa
            </Button>
          ) : null}
          {canRefund ? (
            <Button variant="secondary" icon={<ArrowCounterClockwise />} onClick={onRefund}>
              devolver dinheiro
            </Button>
          ) : null}
          {canMarkPaid ? (
            <Button
              variant="secondary"
              loading={paid.isPending}
              onClick={() => paid.mutate({ id: order.id, status: 'paid' })}
              icon={<CheckCircle />}
            >
              marcar pago
            </Button>
          ) : null}
        </div>
      ) : null}
      {receiving ? (
        <Suspense fallback={null}>
          <ReceiveSheet order={order} onClose={() => setReceiving(false)} />
        </Suspense>
      ) : null}
    </Card>
  );
}
