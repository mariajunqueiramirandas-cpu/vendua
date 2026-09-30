import {
  ArrowSquareOut,
  Bag,
  CalendarBlank,
  MapPin,
  Moped,
  NotePencil,
  Printer,
  WhatsappLogo,
  XCircle,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Order, OrderPayment } from '../../lib/api.ts';
import { clock, dateShort, money, phone, when } from '../../lib/format.ts';
import { can, useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { Chips, Field, TextArea } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { nextStep, STATE_META, StateChip } from '../../ui/StateChip.tsx';
import { PaymentChip } from '../../ui/PaymentChip.tsx';
import { CANCEL_REASONS, printTicket, useTransition, whatsappUrl } from './actions.ts';
import { PaymentSection, primaryPayment, refundable } from './PaymentSection.tsx';
import { RefundSheet } from './RefundSheet.tsx';

export function OrderDetail({
  order,
  customer,
  payments,
  prepDefault,
  inPanel,
}: {
  order: Order;
  customer: { phone: string; orders: number; spentCents: number } | null;
  /** Mercado Pago attempts; undefined while the detail is still the board's copy */
  payments?: OrderPayment[] | undefined;
  prepDefault: number;
  inPanel?: boolean;
}) {
  const s = useSession();
  const move = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const manager = can(s.user.role, 'manager');
  const online = !!order.payment.online;
  const main = primaryPayment(payments);
  const canRefund = online && manager && refundable(main) > 0;
  const next = nextStep(order.state, order.delivery.mode);
  const nm = next ? STATE_META[next.to] : null;
  const advance = () =>
    next &&
    move.mutate({
      order,
      to: next.to,
      ...(order.state === 'placed' ? { prepMinutes: prepDefault } : {}),
      idem: `adv-${order.id}-${next.to}`,
    });
  const cancellable = !['delivered', 'cancelled', 'refunded'].includes(order.state);
  const d = order.delivery;
  const coords =
    typeof d.lat === 'number' && typeof d.lng === 'number' ? { lat: d.lat, lng: d.lng } : null;
  const mapHref = coords
    ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`
    : d.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.address} ${d.neighborhood ?? ''}`)}`
      : null;

  return (
    <div className={cn('space-y-4', inPanel ? '' : 'pb-24 md:pb-0')}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="t-caption text-muted">{when(order.placedAt)}</p>
          <h2 className="t-display tnum">#{order.number}</h2>
        </div>
        <div className="mt-6 flex flex-col items-end gap-1.5">
          <StateChip state={order.state} mode={d.mode} />
          <PaymentChip payment={order.payment} quiet />
        </div>
      </div>

      {order.scheduledFor ? (
        <div className="flex items-center gap-2 rounded-md bg-info-soft px-4 py-3 text-info">
          <CalendarBlank weight="bold" className="size-5" />
          <span className="font-semibold">Encomenda para {dateShort(order.scheduledFor)}</span>
        </div>
      ) : null}

      {order.notes ? (
        <div className="rounded-md bg-warning-soft px-4 py-3 text-warning" role="note">
          <p className="t-caption flex items-center gap-1.5 font-bold uppercase tracking-wide">
            <NotePencil weight="bold" className="size-4" /> Observação do cliente
          </p>
          <p className="t-body-lg mt-1 font-semibold">{order.notes}</p>
        </div>
      ) : null}

      <Card className="p-4">
        <ul className="divide-y divide-line">
          {order.items.map((i, k) => (
            <li key={k} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span className="tnum t-body-lg w-8 shrink-0 font-bold">{i.qty}×</span>
              <div className="min-w-0 flex-1">
                <p className="t-body-lg font-semibold">{i.name}</p>
                {i.modifiers.length ? (
                  <p className="t-body text-muted">{i.modifiers.map((m) => m.name).join(' · ')}</p>
                ) : null}
                {i.combo.length ? (
                  <ul className="t-body text-muted">
                    {i.combo.map((c, j) => (
                      <li key={j}>
                        {c.qty}× {c.name} <span className="text-faint">({c.slotName})</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <span className="tnum t-body shrink-0">{money(i.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="t-body mt-4 space-y-1 border-t border-line pt-3">
          <div className="flex justify-between text-muted">
            <dt>Subtotal</dt>
            <dd className="tnum">{money(order.subtotalCents)}</dd>
          </div>
          {order.deliveryFeeCents ? (
            <div className="flex justify-between text-muted">
              <dt>Entrega</dt>
              <dd className="tnum">{money(order.deliveryFeeCents)}</dd>
            </div>
          ) : null}
          {order.discountCents ? (
            <div className="flex justify-between text-success">
              <dt>Desconto{order.coupon ? ` (${order.coupon.code})` : ''}</dt>
              <dd className="tnum">−{money(order.discountCents)}</dd>
            </div>
          ) : null}
          <div className="t-title-2 flex justify-between pt-1">
            <dt>Total</dt>
            <dd className="tnum">{money(order.totalCents)}</dd>
          </div>
        </dl>
      </Card>

      <Card className="divide-y divide-line">
        <div className="flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="t-body-lg font-semibold">{order.customer.name}</p>
            <p className="t-body text-muted">
              {phone(order.customer.phone)}
              {customer ? (
                <>
                  {' · '}
                  {customer.orders <= 1 ? (
                    <span className="font-semibold text-success">primeiro pedido</span>
                  ) : (
                    <Link
                      to={`/clientes/${customer.phone}`}
                      className="underline underline-offset-2"
                    >
                      {customer.orders}º pedido
                    </Link>
                  )}
                </>
              ) : null}
            </p>
          </div>
          {order.customer.phone ? (
            <a
              href={whatsappUrl(order, s.store.name)}
              target="_blank"
              rel="noreferrer"
              className="t-label inline-flex min-h-12 items-center gap-2 rounded-md bg-[#1f7a4d] px-4 text-white hover:opacity-90"
            >
              <WhatsappLogo weight="fill" className="size-5" /> WhatsApp
            </a>
          ) : null}
        </div>
        <div className="flex items-start gap-3 p-4">
          {d.mode === 'delivery' ? (
            <Moped className="mt-0.5 size-6 shrink-0" />
          ) : (
            <Bag className="mt-0.5 size-6 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {d.mode === 'delivery' ? 'Entrega' : 'Retirada na loja'}
            </p>
            {d.mode === 'delivery' ? (
              <p className="t-body text-muted">
                {[d.address, d.neighborhood].filter(Boolean).join(' — ')}
                {d.zoneName ? ` · ${d.zoneName}` : ''}
              </p>
            ) : null}
            {d.promisedTo && !['delivered', 'cancelled', 'refunded'].includes(order.state) ? (
              <p className="t-body text-muted">
                Prometido:{' '}
                {d.promisedFrom && d.promisedFrom !== d.promisedTo
                  ? `${clock(d.promisedFrom)}–`
                  : ''}
                {clock(d.promisedTo)}
              </p>
            ) : null}
          </div>
          {mapHref ? (
            <a
              href={mapHref}
              target="_blank"
              rel="noreferrer"
              className="t-label inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-muted hover:bg-hover"
            >
              <MapPin className="size-5" /> mapa
            </a>
          ) : null}
        </div>
        {coords ? (
          <iframe
            title="mapa da entrega"
            loading="lazy"
            className="h-40 w-full rounded-b-lg border-0 grayscale-[.3]"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${coords.lng - 0.006},${coords.lat - 0.004},${coords.lng + 0.006},${coords.lat + 0.004}&layer=mapnik&marker=${coords.lat},${coords.lng}`}
          />
        ) : null}
      </Card>

      <PaymentSection
        order={order}
        payments={payments}
        canRefund={canRefund}
        onRefund={() => setRefundOpen(true)}
      />

      <section aria-label="histórico do pedido">
        <h3 className="t-label mb-2 px-1">Linha do tempo</h3>
        <ol className="relative ml-3 border-l-2 border-line pl-5">
          {order.timeline.map((t, i) => {
            const m = STATE_META[t.to];
            return (
              <li key={i} className="relative pb-4 last:pb-0">
                <span
                  className="absolute -left-[31px] grid size-5 place-items-center rounded-full ring-4 ring-bg"
                  style={{ background: `var(--st-${m.var})`, color: `var(--st-${m.var}-ink)` }}
                >
                  <m.Icon weight="bold" className="size-3" />
                </span>
                <p className="font-semibold">{m.label}</p>
                <p className="t-caption text-muted">
                  {when(t.at)}
                  {typeof t.meta.by === 'string'
                    ? ` · ${t.meta.by}`
                    : t.actor === 'customer'
                      ? ' · cliente'
                      : ''}
                  {typeof t.meta.prepMinutes === 'number'
                    ? ` · preparo de ${t.meta.prepMinutes} min`
                    : ''}
                </p>
                {typeof t.meta.reason === 'string' ? (
                  <p className="t-body text-muted">Motivo: {t.meta.reason}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          icon={<Printer />}
          onClick={() => printTicket(order, s.store.name)}
        >
          imprimir comanda
        </Button>
        {!inPanel ? null : (
          <Link
            to={`/pedidos/${order.id}`}
            className="t-label inline-flex min-h-12 items-center gap-2 rounded-md px-4 text-muted hover:bg-hover"
          >
            <ArrowSquareOut className="size-5" /> abrir em tela cheia
          </Link>
        )}
        {cancellable ? (
          <Button
            variant="ghost"
            className="text-danger!"
            icon={<XCircle />}
            onClick={() => setCancelOpen(true)}
          >
            cancelar pedido
          </Button>
        ) : null}
        {order.state === 'delivered' && manager && !online ? (
          <Button variant="ghost" className="text-muted!" onClick={() => setCancelOpen(true)}>
            marcar estorno
          </Button>
        ) : null}
      </div>

      {next ? (
        <div
          className={cn(
            inPanel
              ? 'sticky bottom-0 -mx-5 border-t border-line bg-surface px-5 py-3'
              : 'hidden md:block',
          )}
        >
          <Button
            size="lg"
            block
            loading={move.isPending}
            onClick={advance}
            icon={nm ? <nm.Icon weight="bold" /> : undefined}
          >
            {next.label}
            {order.state === 'placed' ? ` · ${prepDefault} min` : ''}
          </Button>
        </div>
      ) : null}
      {next && !inPanel ? (
        <div className="glass fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 border-t border-line px-4 py-3 md:hidden">
          <Button
            size="lg"
            block
            loading={move.isPending}
            onClick={advance}
            icon={nm ? <nm.Icon weight="bold" /> : undefined}
          >
            {next.label}
            {order.state === 'placed' ? ` · ${prepDefault} min` : ''}
          </Button>
        </div>
      ) : null}

      <CancelSheet order={order} open={cancelOpen} onOpenChange={setCancelOpen} />
      {online ? (
        <RefundSheet order={order} payment={main} open={refundOpen} onOpenChange={setRefundOpen} />
      ) : null}
    </div>
  );
}

export function CancelSheet({
  order,
  open,
  onOpenChange,
}: {
  order: Order;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const move = useTransition();
  const [reason, setReason] = useState<string>('');
  const [other, setOther] = useState('');
  const refund = order.state === 'delivered';
  const text = reason === 'outro' ? other.trim() : reason;
  const paid = order.payment.status === 'paid' || order.payment.status === 'partially_refunded';
  const paidOnline = paid && !!order.payment.online;
  const go = () =>
    move.mutate(
      { order, to: refund ? 'refunded' : 'cancelled', reason: text, idem: `cancel-${order.id}` },
      { onSuccess: () => onOpenChange(false) },
    );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={refund ? `Estornar o pedido #${order.number}?` : `Cancelar o pedido #${order.number}?`}
      description={
        refund
          ? 'Registra que o dinheiro foi devolvido. Faça a devolução pelo seu banco antes.'
          : paidOnline
            ? 'Esse pedido foi pago pelo Mercado Pago. Ao cancelar, o que o cliente pagou volta para ele sozinho, pelo mesmo meio.'
            : paid
              ? 'Esse pedido já foi pago. Depois de cancelar, devolva o valor ao cliente pelo seu banco.'
              : 'O cliente vê o motivo na página do pedido. Não dá para desfazer.'
      }
      footer={
        paid || refund ? (
          <HoldButton disabled={!text} onConfirm={go}>
            {move.isPending
              ? 'cancelando…'
              : refund
                ? 'segure para estornar'
                : paidOnline
                  ? 'segure para cancelar e devolver'
                  : 'segure para cancelar'}
          </HoldButton>
        ) : (
          <Button
            variant="danger"
            size="lg"
            block
            disabled={!text}
            loading={move.isPending}
            onClick={go}
          >
            cancelar pedido
          </Button>
        )
      }
    >
      <Field label="Motivo" className="pt-2">
        <Chips
          label="motivo"
          value={reason}
          onChange={setReason}
          options={[
            ...(refund ? ['Cliente não recebeu', 'Produto com problema'] : CANCEL_REASONS),
            'outro',
          ].map((r) => ({
            value: r,
            label: r === 'outro' ? 'outro motivo' : r,
          }))}
        />
      </Field>
      {reason === 'outro' ? (
        <Field label="Qual?" htmlFor="other-reason" className="mt-4">
          <TextArea
            id="other-reason"
            maxLength={200}
            value={other}
            onChange={(e) => setOther(e.target.value)}
            className="min-h-20"
            autoFocus
          />
        </Field>
      ) : null}
    </Sheet>
  );
}
