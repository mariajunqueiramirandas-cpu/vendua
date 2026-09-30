import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { money, ORDER_STATE_LABEL } from '@vendua/ui-defaults';
import { useCart, useLoyalty, useOrder, useOrderHistory, useOrders, useStore } from '../hooks.ts';
import { Slot } from '../slot.tsx';
import { KLink } from '../sdk/sections.tsx';
import { KERNEL_PATHS } from '../config.ts';
import { errorCode, errorCopy, showError, showInfo } from '../errors.ts';
import { useNavigateTo } from '../primitives.tsx';
import type { ImportReport, Order, PaymentNext, StoreProfile } from '../api.ts';
import type { PaymentStatusKind, SlotProps } from '../slot-props.ts';
import { useKernel, invalidateQuery } from '../provider.tsx';

// /pedido/:id and /pedidos — Kernel pages. Order history is the first Kernel
// page that exists purely as platform surface (roadmap 1b-iii): every store gets
// it on its next rebuild, no store code involved. Kernel 1.2 adds live status,
// the purchased items, Pix copia e cola, "pedir de novo", orders from other
// devices (phone + order number) and the loyalty card.

const KEY_LABEL: Record<string, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'e-mail',
  phone: 'celular',
  random: 'chave aleatória',
};

function useReorder() {
  const { mutations } = useCart();
  const go = useNavigateTo();
  const [pending, setPending] = useState<string | null>(null);
  const reorder = async (orderId: string) => {
    setPending(orderId);
    try {
      const { report } = await mutations.reorder(orderId);
      announce(report);
      go(KERNEL_PATHS.cart);
    } catch (err) {
      showError(err);
    } finally {
      setPending(null);
    }
  };
  return { reorder, pending };
}

function announce(report: ImportReport) {
  if (report.skipped.length === 0) showInfo('reorder', 'Itens de volta na sacola');
  else
    showInfo(
      'reorder',
      report.added ? 'Parte do pedido voltou para a sacola' : 'Nenhum item está disponível agora',
      report.skipped.map((s) => errorCopy(s.code).title).join(' · '),
    );
}

const REFUNDED = new Set(['refunded', 'partially_refunded']);

function whatsappHref(store: StoreProfile | undefined, order: Order): string | undefined {
  const wa = store?.whatsapp?.replace(/\D/g, '');
  if (!wa) return undefined;
  const text = `Oi! Quero combinar o pagamento do pedido #${order.number}.`;
  return `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
}

/** Kernel 1.7 — the order's online payment (Mercado Pago card checkout, online Pix):
 *  asks Core for the Pix when there's none yet, syncs a card return, and turns the
 *  payment's state into what `checkout.PaymentStatus` shows. Offline orders: no panel. */
function useOnlinePayment(
  order: Order | undefined,
  store: StoreProfile | undefined,
  params: URLSearchParams,
) {
  const { api } = useKernel();
  const [work, setWork] = useState<'sync' | 'redirect' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [next, setNext] = useState<PaymentNext | null>(null);
  const [returned, setReturned] = useState(false);
  const [justPaid, setJustPaid] = useState(false);
  const [, tick] = useState(0);
  const started = useRef<string | null>(null);
  const lastStatus = useRef<string | undefined>(undefined);

  const pay = order?.payment;
  const card = pay?.method === 'card_online';
  const isOnline = !!order && (pay?.online === true || card);
  const method: 'pix' | 'card_online' = card ? 'card_online' : 'pix';
  const status = pay?.status;
  const nextPix = next?.kind === 'pix' ? next : null;
  const pixCode = pay?.pix?.copyPaste || nextPix?.copyPaste;
  const pixExpiresAt = pay?.pix?.expiresAt ?? nextPix?.expiresAt ?? null;
  const deadline = pixExpiresAt ? Date.parse(pixExpiresAt) : NaN;
  const pixTimedOut = Number.isFinite(deadline) && Date.now() >= deadline;
  const retorno = params.get('pagamento') === 'retorno';
  // MP appends its own outcome to the back_url — a hint for the copy only; Core's sync is the truth
  const mpHint = params.get('collection_status') ?? params.get('status');

  const run = async (mode: 'sync' | 'redirect') => {
    if (!order) return;
    setWork(mode);
    setFailure(null);
    try {
      const r = await api.payOrder(order.id);
      invalidateQuery(`order:${order.id}`, r.order);
      setNext(r.next);
      if (mode === 'redirect' && r.next.kind === 'redirect') {
        globalThis.location.assign(r.next.url);
        return; // stays "redirecting" until the browser leaves
      }
    } catch (err) {
      const code = errorCode(err);
      // paid meanwhile (or never online): the order read has the answer
      if (code === 'PAYMENT_NOT_REQUIRED') invalidateQuery(`order:${order.id}`);
      else setFailure(code);
    }
    setWork(null);
  };

  // one automatic call per order: generate the missing Pix, or sync a card return
  const id = order?.id;
  const autoPix =
    isOnline && !card && status === 'pending' && !pixCode && order?.state !== 'cancelled';
  const autoReturn = isOnline && card && retorno && (status === 'pending' || status === 'failed');
  useEffect(() => {
    if (!id || started.current === id || !(autoPix || autoReturn)) return;
    started.current = id;
    if (autoReturn) setReturned(true);
    void run('sync');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, autoPix, autoReturn]);

  // the Pix expires on the shopper's clock too, not only when Core says so
  useEffect(() => {
    if (!Number.isFinite(deadline) || status !== 'pending') return;
    const ms = deadline - Date.now();
    if (ms <= 0) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.min(ms + 250, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [deadline, status]);

  // paid while this page was open (live stream, sync) — the default celebrates it
  useEffect(() => {
    // …or the shopper just came back from Mercado Pago to a confirmed payment
    const arrived = lastStatus.current === undefined && retorno;
    if (status === 'paid' && (arrived || (lastStatus.current && lastStatus.current !== 'paid')))
      setJustPaid(true);
    lastStatus.current = status;
  }, [status, retorno]);

  let kind: PaymentStatusKind | null = null;
  let action: SlotProps['checkout.PaymentStatus']['action'];
  const again = (label: string, mode: 'sync' | 'redirect') => ({
    label,
    onClick: () => void run(mode),
    pending: work !== null,
  });
  if (!order || !isOnline) kind = null;
  else if (work === 'redirect') kind = 'redirecting';
  else if (status === 'paid') kind = 'paid';
  else if (status && REFUNDED.has(status)) kind = 'refunded';
  else if (order.state === 'cancelled') kind = null;
  else if (work === 'sync') kind = 'confirming';
  else if (failure) {
    kind = 'unavailable';
    action = again('Tentar de novo', card ? 'redirect' : 'sync');
  } else if (card) {
    if (status === 'pending' && returned) {
      // back from MP with nothing approved: processing only when MP says so, else not done
      const processing = mpHint === 'pending' || mpHint === 'in_process';
      const reopened = next?.kind === 'redirect';
      kind = processing || !reopened ? 'processing' : 'failed';
      if (kind === 'failed') action = again('Tentar de novo', 'redirect');
    } else if (status === 'pending') {
      kind = 'due';
      action = again('Pagar com cartão', 'redirect');
    } else if (status === 'failed' || status === 'expired') {
      kind = 'failed';
      action = again('Tentar de novo', 'redirect');
    }
  } else if (status === 'expired' || (status === 'pending' && pixTimedOut)) {
    kind = 'expired';
    action = again('Gerar novo Pix', 'sync');
  } else if (status === 'failed') {
    kind = 'failed';
    action = again('Gerar novo Pix', 'sync');
  } else if (status === 'pending' && !pixCode) {
    kind = 'due';
    action = again('Gerar Pix', 'sync');
  }

  const panel: SlotProps['checkout.PaymentStatus'] | null =
    kind && order
      ? {
          status: kind,
          method,
          amountCents: order.totalCents,
          currency: store?.currency ?? 'BRL',
          ...(kind === 'refunded' && pay?.refundedCents
            ? { refundedCents: pay.refundedCents }
            : {}),
          ...(kind === 'paid' && justPaid ? { justPaid: true } : {}),
          ...(action ? { action } : {}),
          ...(kind === 'unavailable'
            ? {
                ...(failure === 'PAYMENT_UNAVAILABLE'
                  ? {}
                  : { detail: errorCopy(failure ?? '').title }),
                ...(whatsappHref(store, order)
                  ? { whatsappHref: whatsappHref(store, order)! }
                  : {}),
              }
            : {}),
        }
      : null;

  return {
    panel,
    pix:
      isOnline && pixCode
        ? ({ ...(pay?.pix ?? { key: '', beneficiary: '' }), copyPaste: pixCode } as NonNullable<
            Order['payment']['pix']
          >)
        : undefined,
    pixExpiresAt,
  };
}

export function OrderPage() {
  const { id = '' } = useParams();
  const { search } = useLocation();
  // live: the Kernel holds a long poll open while the tab is visible (Kernel 1.2)
  const { order, loading, error, refetch } = useOrder(id);
  const { store } = useStore();
  const { reorder, pending } = useReorder();
  const currency = store?.currency ?? 'BRL';
  const params = new URLSearchParams(search);
  const isNew = params.has('novo');
  const online = useOnlinePayment(order, store, params);
  const pix = online.pix ?? order?.payment.pix;
  const payPix =
    order &&
    pix &&
    !online.panel &&
    order.payment.method === 'pix' &&
    order.payment.status === 'pending' &&
    order.state !== 'cancelled';

  return (
    <main id="main" className="v-page" data-vendua-page="order">
      {loading && !order ? (
        <div className="v-panel" aria-busy="true" aria-label="Carregando pedido" />
      ) : !order ? (
        <Slot
          name="system.ErrorFallback"
          error={{
            code: error?.code ?? 'ORDER_NOT_FOUND',
            message:
              error?.code === 'ORDER_NOT_FOUND' || error?.status === 400
                ? 'Pedido não encontrado neste aparelho.'
                : 'O pedido não carregou.',
          }}
          retry={refetch}
        />
      ) : (
        <>
          {isNew ? <Slot name="checkout.SuccessPage" order={order} currency={currency} /> : null}
          {online.panel ? <Slot name="checkout.PaymentStatus" {...online.panel} /> : null}
          {payPix ? (
            <Slot
              name="checkout.PixPayment"
              copyPaste={pix.copyPaste}
              beneficiary={pix.beneficiary ?? ''}
              {...(pix.keyType ? { keyLabel: KEY_LABEL[pix.keyType] ?? pix.keyType } : {})}
              amountCents={order.totalCents}
              currency={currency}
              {...(order.payment.online
                ? { online: true, expiresAt: online.pixExpiresAt ?? null }
                : {})}
            />
          ) : null}
          <Slot
            name="order.StatusPage"
            order={order}
            currency={currency}
            timeline={<Slot name="order.Timeline" events={order.timeline} />}
            {...(order.delivery.mode === 'pickup' && store?.pickup ? { pickup: store.pickup } : {})}
          />
          {order.items?.length ? (
            <Slot
              name="order.Items"
              items={order.items}
              currency={currency}
              notes={order.notes ?? null}
              scheduledFor={order.scheduledFor ?? null}
              discountCents={order.discountCents ?? 0}
              couponCode={order.coupon?.code ?? null}
              onReorder={() => void reorder(order.id)}
              reorderPending={pending === order.id}
            />
          ) : null}
          <p className="v-section-cta">
            <KLink href={KERNEL_PATHS.orders} className="v-btn v-btn-ghost">
              Meus pedidos
            </KLink>
          </p>
        </>
      )}
    </main>
  );
}

export function OrderHistoryPage() {
  const local = useOrderHistory();
  const phone = useOrders();
  const loyalty = useLoyalty(phone.phone);
  const { store } = useStore();
  const { reorder, pending } = useReorder();
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string>();
  const currency = store?.currency ?? 'BRL';

  // one list: this device's full orders, plus the phone's orders placed elsewhere
  const localIds = new Set(local.orders.map((o) => o.id));
  const rows = [
    ...local.orders.map((o) => ({
      id: o.id,
      number: o.number,
      state: o.state,
      placedAt: o.placedAt,
      totalCents: o.totalCents,
      items: (o.items ?? []).map((i) => ({ name: i.name, qty: i.qty })),
      here: true,
    })),
    ...phone.orders.filter((o) => !localIds.has(o.id)).map((o) => ({ ...o, here: false })),
  ].sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt));
  const loading = (local.loading || phone.loading) && rows.length === 0;

  const verify = async (p: string, orderNumber: number) => {
    setVerifying(true);
    setVerifyError(undefined);
    try {
      await phone.verify(orderNumber, p);
      loyalty.refetch();
    } catch (err) {
      setVerifyError(errorCopy(errorCode(err)).title);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <main id="main" className="v-page" data-vendua-page="orders">
      <h1 className="v-page-title">Meus pedidos</h1>
      <p className="v-muted">
        {phone.needsVerification
          ? 'Pedidos feitos neste aparelho.'
          : 'Pedidos deste aparelho e do seu WhatsApp.'}
      </p>
      {loyalty.card?.enabled ? (
        <Slot name="customer.LoyaltyCard" card={loyalty.card} currency={currency} />
      ) : null}
      {loading ? (
        <div className="v-panel" aria-busy="true" aria-label="Carregando pedidos" />
      ) : rows.length === 0 ? (
        <div className="v-panel v-empty" data-part="empty">
          <p className="v-panel-title">Nenhum pedido por aqui ainda.</p>
          <KLink href="/" className="v-btn v-btn-accent">
            Fazer um pedido
          </KLink>
        </div>
      ) : (
        <ol className="v-order-list" data-part="list">
          {rows.map((o) => {
            const head = (
              <>
                <span className="v-order-row-main">
                  <strong className="v-order-row-title">Pedido #{o.number}</strong>
                  <span className="v-muted v-order-row-meta">
                    {new Date(o.placedAt).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'short',
                    })}
                    {o.items.length
                      ? ` · ${o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}`
                      : ''}
                  </span>
                </span>
                <span className="v-order-row-side">
                  <span className="v-num v-order-row-total">{money(o.totalCents, currency)}</span>
                  <span className="v-order-row-state" data-state={o.state}>
                    {ORDER_STATE_LABEL[o.state] ?? o.state}
                  </span>
                </span>
              </>
            );
            return (
              <li key={o.id} data-origin={o.here ? 'device' : 'phone'}>
                {o.here ? (
                  <KLink href={KERNEL_PATHS.order.replace(':id', o.id)} data-state={o.state}>
                    {head}
                  </KLink>
                ) : (
                  <div className="v-order-row" data-state={o.state}>
                    {head}
                  </div>
                )}
                {o.items.length ? (
                  <button
                    type="button"
                    className="v-link-btn"
                    data-part="reorder"
                    disabled={pending === o.id}
                    onClick={() => void reorder(o.id)}
                  >
                    {pending === o.id ? 'Colocando na sacola…' : 'Pedir de novo'}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {phone.needsVerification ? (
        <Slot
          name="customer.PhoneVerify"
          phone=""
          pending={verifying}
          {...(verifyError ? { error: verifyError } : {})}
          onSubmit={(p, n) => void verify(p, n)}
        />
      ) : (
        <p className="v-muted v-forget">
          <button type="button" className="v-link-btn" onClick={phone.forget}>
            Esquecer meu WhatsApp neste aparelho
          </button>
        </p>
      )}
    </main>
  );
}
