import {
  ArrowClockwise,
  ArrowSquareOut,
  CalendarBlank,
  CaretDown,
  CheckCircle,
  ClockClockwise,
  HourglassMedium,
  MapPin,
  NotePencil,
  Printer,
  Prohibit,
  WarningCircle,
  WhatsappLogo,
  XCircle,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Order, OrderPayment, OrderPrintJob, OrderState } from '../../lib/api.ts';
import { clock, dateShort, money, phone, when } from '../../lib/format.ts';
import { can, featureOpen, useCan, useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { Chips, Field, TextArea } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { modeOf } from '../../ui/orderMode.ts';
import { nextStep, STATE_META, StateChip } from '../../ui/StateChip.tsx';
import { PAY_LABEL, PaymentChip } from '../../ui/PaymentChip.tsx';
import {
  CANCEL_REASONS,
  orderWhatsappUrl,
  useDelay,
  usePrintJobs,
  usePrintOrder,
  useSoldOutToday,
  useTransition,
} from './actions.ts';
import { PaymentSection, primaryPayment, refundable } from './PaymentSection.tsx';
import { RefundSheet } from './RefundSheet.tsx';
import { afterHeld, holdMove, useHeldStates, withHeld } from './transition.ts';

export function OrderDetail({
  order: shown,
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
  // a move waiting out its "desfazer" shows already, whatever a refetch brought back
  const order = withHeld(shown, useHeldStates());
  const printing = usePrintOrder(s.store.name);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [soldOutOpen, setSoldOutOpen] = useState(false);
  const manager = can(s.user.role, 'manager');
  const online = !!order.payment.online;
  const main = primaryPayment(payments);
  const canRefund = online && manager && refundable(main) > 0;
  const next = nextStep(order.state, order.delivery.mode);
  const nm = next ? STATE_META[next.to] : null;
  const advance = () =>
    next && holdMove(order, next.to, order.state === 'placed' ? prepDefault : undefined);
  const products = soldOutItems(order);
  const cancellable = !['delivered', 'cancelled', 'refunded'].includes(order.state);
  const d = order.delivery;
  const ModeIcon = modeOf(d).Icon;
  const pdvOpen = featureOpen(s, 'pdv');
  const coords =
    typeof d.lat === 'number' && typeof d.lng === 'number' ? { lat: d.lat, lng: d.lng } : null;
  const mapHref = coords
    ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`
    : d.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.address} ${d.neighborhood ?? ''}`)}`
      : null;

  return (
    <div className={cn('space-y-4', inPanel ? '' : 'pb-24 md:pb-0')}>
      <div
        className="flex items-start justify-between gap-4"
        {...(inPanel ? {} : { 'data-vt-dst': `order:${order.id}` })}
      >
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
                  <p className="t-body text-muted">
                    {i.modifiers
                      .map((m) => ((m.qty ?? 1) > 1 ? `${m.qty}× ${m.name}` : m.name))
                      .join(' · ')}
                  </p>
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
                {i.note ? (
                  <p className="t-body mt-0.5 flex items-start gap-1.5 font-semibold">
                    <NotePencil
                      weight="bold"
                      className="mt-0.5 size-4 shrink-0 text-warning"
                      aria-label="Observação"
                    />
                    <span className="min-w-0 break-words">{i.note}</span>
                  </p>
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
          {order.paymentAdjustmentCents ? (
            <div
              className={cn(
                'flex justify-between',
                order.paymentAdjustmentCents < 0 ? 'text-success' : 'text-muted',
              )}
            >
              <dt>
                {order.paymentAdjustmentCents < 0 ? 'Desconto' : 'Acréscimo'} (
                {PAY_LABEL[order.payment.method] ?? 'pagamento'})
              </dt>
              <dd className="tnum">
                {order.paymentAdjustmentCents < 0 ? '−' : '+'}
                {money(Math.abs(order.paymentAdjustmentCents))}
              </dd>
            </div>
          ) : null}
          <div className="t-title-2 flex justify-between pt-1">
            <dt>Total</dt>
            <dd className="tnum">{money(order.totalCents)}</dd>
          </div>
        </dl>
        {manager && products.length ? (
          <div className="mt-3 border-t border-line pt-3">
            <Button
              variant="ghost"
              size="md"
              icon={<Prohibit />}
              aria-expanded={soldOutOpen}
              className="-ml-3 text-muted!"
              onClick={() => setSoldOutOpen((v) => !v)}
            >
              acabou algum item?
              <CaretDown
                weight="bold"
                aria-hidden
                className={cn('size-4! transition-transform', soldOutOpen && 'rotate-180')}
              />
            </Button>
            {soldOutOpen ? <SoldOutList order={order} className="mt-1" /> : null}
          </div>
        ) : null}
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
              href={orderWhatsappUrl(order, s.store.name)}
              target="_blank"
              rel="noreferrer"
              className="press t-label inline-flex min-h-12 items-center gap-2 rounded-md bg-whatsapp px-4 text-on-whatsapp hover:opacity-90"
            >
              <WhatsappLogo weight="fill" className="size-5" /> WhatsApp
            </a>
          ) : null}
        </div>
        <div className="flex items-start gap-3 p-4">
          <ModeIcon className="mt-0.5 size-6 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {d.mode === 'delivery'
                ? 'Entrega'
                : d.mode === 'dine_in'
                  ? d.table
                    ? `${modeOf(d).label}, consumo no local`
                    : 'Consumo no local'
                  : 'Retirada na loja'}
            </p>
            {d.mode === 'dine_in' && d.tabId && pdvOpen ? (
              <Link
                to={`/pdv/comanda/${d.tabId}`}
                className="t-body font-semibold underline underline-offset-2"
              >
                abrir a comanda
              </Link>
            ) : null}
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
                {d.delayMinutes ? (
                  <span className="text-warning"> · atrasou {d.delayMinutes} min</span>
                ) : null}
              </p>
            ) : null}
            <DelayChips order={order} className="mt-2" />
          </div>
          {mapHref ? (
            <a
              href={mapHref}
              target="_blank"
              rel="noreferrer"
              className="press t-label inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-muted hover:bg-hover"
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

      {printing.available ? <PrintSection order={order} printing={printing} /> : null}

      <div className="flex flex-wrap gap-2">
        {!inPanel ? null : (
          <Link
            to={`/pedidos/${order.id}`}
            className="press t-label inline-flex min-h-12 items-center gap-2 rounded-md px-4 text-muted hover:bg-hover"
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
            onClick={advance}
            icon={nm ? <nm.Icon weight="bold" /> : undefined}
          >
            {next.label}
            {order.state === 'placed' ? ` · ${prepDefault} min` : ''}
          </Button>
        </div>
      ) : null}
      {next && !inPanel ? (
        <div
          data-action-bar
          className="glass fixed inset-x-0 bottom-[var(--tabbar-h,calc(72px+env(safe-area-inset-bottom)))] z-30 border-t border-line px-4 py-3 md:hidden"
        >
          <Button
            size="lg"
            block
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
  const go = async () => {
    // a step still waiting out its "desfazer" reaches Core first
    await afterHeld(order.id);
    move.mutate(
      { order, to: refund ? 'refunded' : 'cancelled', reason: text, idem: `cancel-${order.id}` },
      { onSuccess: () => onOpenChange(false) },
    );
  };
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
          <HoldButton disabled={!text} onConfirm={() => void go()}>
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
            onClick={() => void go()}
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

const DELAYABLE: readonly OrderState[] = ['confirmed', 'preparing', 'ready', 'out_for_delivery'];

/** accepted, still on its way, with a time promised (an encomenda has a day, not a time) */
export const canDelay = (o: Order) =>
  DELAYABLE.includes(o.state) && !o.scheduledFor && !!o.delivery.promisedTo;

/** "Atrasou?": the promise moves later and the shopper hears the new time on WhatsApp. */
export function DelayChips({ order, className }: { order: Order; className?: string }) {
  const s = useSession();
  const delay = useDelay(s.store.name);
  if (!canDelay(order)) return null;
  return (
    <div
      role="group"
      aria-label="atrasou? empurrar o horário"
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      <span className="t-label mr-1 inline-flex items-center gap-1.5 text-muted">
        <ClockClockwise weight="bold" className="size-5" aria-hidden /> Atrasou?
      </span>
      {[10, 20].map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => delay(order, m)}
          className="press t-label tnum inline-flex min-h-11 items-center rounded-full px-4 ring-1 ring-line-strong hover:bg-hover"
        >
          +{m} min<span className="sr-only"> no horário prometido</span>
        </button>
      ))}
    </div>
  );
}

/** the order's products, once each: what "acabou" can mark */
function soldOutItems(o: Order) {
  const seen = new Map<string, string>();
  for (const i of o.items) if (i.productId && !seen.has(i.productId)) seen.set(i.productId, i.name);
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** "Acabou": one tap sells the product out for today, from the order that showed it. */
export function SoldOutList({ order, className }: { order: Order; className?: string }) {
  const manager = useCan('manager');
  const soldOut = useSoldOutToday();
  const products = soldOutItems(order);
  if (!manager || !products.length) return null;
  return (
    <ul className={cn('divide-y divide-line', className)}>
      {products.map((p) => (
        <li key={p.id} className="flex min-h-14 items-center gap-3 py-1.5">
          <span className="t-body min-w-0 flex-1 truncate font-semibold">{p.name}</span>
          <Button
            variant="secondary"
            icon={<Prohibit />}
            onClick={() => soldOut.mutate({ productId: p.id, name: p.name })}
          >
            esgotou hoje
          </Button>
        </li>
      ))}
    </ul>
  );
}

type Printing = ReturnType<typeof usePrintOrder>;

/** The latest ticket on each printer, newest first. */
function latestJobs(jobs: OrderPrintJob[]) {
  const seen = new Set<string>();
  return jobs.filter((j) => (seen.has(j.printerId) ? false : (seen.add(j.printerId), true)));
}

function jobWords(j: OrderPrintJob): {
  title: string;
  detail: string;
  tone: 'ok' | 'bad' | 'wait';
} {
  switch (j.status) {
    case 'done':
      return {
        title: `Impressa às ${clock(j.finishedAt ?? j.createdAt)}`,
        detail: j.printer,
        tone: 'ok',
      };
    case 'failed':
      return {
        title: 'A comanda não imprimiu',
        detail: `${j.printer}: ${j.error ?? 'falha ao imprimir'}`,
        tone: 'bad',
      };
    case 'expired':
      return {
        title: 'A comanda não saiu',
        detail:
          j.error === 'Pedido cancelado'
            ? `${j.printer}: o pedido foi cancelado antes`
            : `${j.printer}: o aparelho ficou desligado`,
        tone: 'bad',
      };
    default:
      return j.deviceOnline
        ? { title: 'Imprimindo…', detail: j.printer, tone: 'wait' }
        : {
            title: 'Esperando o aparelho ligar',
            detail: `${j.printer} · ${j.device} está desligado`,
            tone: 'wait',
          };
  }
}

/** "Impressa às 12:03 · Cozinha", or why not and "imprimir de novo"; and a printer to pick. */
function PrintSection({ order, printing }: { order: Order; printing: Printing }) {
  const jobs = latestJobs(usePrintJobs(order.id, printing.printers.length > 0).data?.jobs ?? []);
  const many = printing.printers.length > 1;
  return (
    <section aria-label="comanda">
      <h3 className="t-label mb-2 px-1">Comanda</h3>
      <Card className="divide-y divide-line">
        {jobs.map((j) => {
          const w = jobWords(j);
          const Icon =
            w.tone === 'ok' ? CheckCircle : w.tone === 'bad' ? WarningCircle : HourglassMedium;
          return (
            <div key={j.id} className="flex items-start gap-3 p-4">
              <Icon
                weight="fill"
                aria-hidden
                className={cn(
                  'mt-0.5 size-6 shrink-0',
                  w.tone === 'ok'
                    ? 'text-success'
                    : w.tone === 'bad'
                      ? 'text-danger'
                      : 'text-muted',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{w.title}</p>
                <p className="t-caption text-muted">{w.detail}</p>
                {w.tone === 'bad' ? (
                  <Button
                    variant="secondary"
                    icon={<ArrowClockwise />}
                    loading={printing.pending}
                    className="mt-3"
                    onClick={() => printing.printTo(order, j.printerId)}
                  >
                    imprimir de novo
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
        <div className="space-y-3 p-4">
          <Button
            variant="secondary"
            icon={<Printer />}
            loading={printing.pending}
            onClick={() => printing.print(order)}
          >
            imprimir comanda
          </Button>
          {many ? (
            <PrintChoice
              order={order}
              printing={printing}
              lead="ou só em:"
              className="items-center"
            />
          ) : null}
        </div>
      </Card>
    </section>
  );
}

/** One printer, by name, when the store has more than one. */
export function PrintChoice({
  order,
  printing,
  className,
  lead,
}: {
  order: Order;
  printing: Printing;
  className?: string;
  /** a few words before the choices, shown only with them */
  lead?: string;
}) {
  if (printing.printers.length < 2) return null;
  return (
    <div
      role="group"
      aria-label="imprimir em uma impressora"
      className={cn('flex flex-wrap gap-2', className)}
    >
      {lead ? <span className="t-caption text-muted">{lead}</span> : null}
      {printing.printers.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => printing.printTo(order, p.id)}
          className="press t-label inline-flex min-h-12 items-center gap-2 rounded-full px-4 ring-1 ring-line-strong hover:bg-hover"
        >
          <Printer className="size-5" aria-hidden />
          {p.name}
          {!p.online ? <span className="font-normal text-muted">· desligada</span> : null}
        </button>
      ))}
    </div>
  );
}
