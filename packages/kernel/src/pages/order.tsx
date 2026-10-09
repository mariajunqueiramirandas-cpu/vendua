import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  useCart,
  useCopy,
  useLoyalty,
  useOrder,
  useOrderHistory,
  useOrders,
  usePixTimer,
  useStore,
} from '../hooks.ts';
import { formatCents, LOCALE } from '../rules/format.ts';
import { whatsappUrl } from '../rules/links.ts';
import {
  orderStateLabel,
  PAYMENT_METHOD_LABEL,
  PIX_KEY_LABEL,
  REFUNDED_PAYMENT_STATUSES,
} from '../rules/orders.ts';
import type { Vocabulary } from '../rules/copy.ts';
import { usePageTitle } from '../head.ts';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// "Recebido", "Em preparo": the state without repeating "Pedido" next to the number
const stateWord = (state: string, mode?: Order['delivery']['mode']) =>
  capitalize(orderStateLabel(state, mode).replace(/^Pedido /, ''));
import { Slot } from '../slot.tsx';
import { KLink } from '../sdk/sections.tsx';
import { KERNEL_PATHS, resolvePaths } from '../config.ts';
import { errorCode, errorCopy, showError, showInfo } from '../errors.ts';
import { useNavigateTo } from '../primitives.tsx';
import type { CardPaymentInput, ImportReport, Order, PaymentNext, StoreProfile } from '../api.ts';
import { CardFields, ChallengeFrame, declineCopy } from '../card-payment.tsx';
import { mpDeviceId } from '../mp-device.ts';
import type { PaymentStatusKind, SlotProps } from '../slot-props.ts';
import { useKernel, invalidateQuery } from '../provider.tsx';

// /pedido/:id and /pedidos — Kernel pages. Order history is the first Kernel
// page that exists purely as platform surface (roadmap 1b-iii): every store gets
// it on its next rebuild, no store code involved. Kernel 1.2 adds live status,
// the purchased items, Pix copia e cola, "pedir de novo", orders from other
// devices (phone + order number) and the loyalty card.

/** "Pedir de novo": a past order's lines back in the bag, then the bag (also `sdk:recent-order`). */
export function useReorder() {
  const { mutations } = useCart();
  const { vocabulary } = useCopy();
  const go = useNavigateTo();
  const [pending, setPending] = useState<string | null>(null);
  const reorder = async (orderId: string) => {
    setPending(orderId);
    try {
      const { report } = await mutations.reorder(orderId);
      announce(report, vocabulary);
      go(KERNEL_PATHS.cart);
    } catch (err) {
      showError(err);
    } finally {
      setPending(null);
    }
  };
  return { reorder, pending };
}

function announce(report: ImportReport, v: Vocabulary) {
  if (report.skipped.length === 0)
    showInfo('reorder', `${capitalize(v.itemPlural)} de volta ${v.inBag}`);
  else
    showInfo(
      'reorder',
      report.added
        ? `Parte do pedido voltou ${v.toBag}`
        : `Nenhum ${v.itemSingular} está disponível agora`,
      report.skipped.map((s) => errorCopy(s.code).title).join(' · '),
    );
}

function whatsappHref(store: StoreProfile | undefined, order: Order): string | null {
  return whatsappUrl(store?.whatsapp, `Oi! Quero combinar o pagamento do pedido #${order.number}.`);
}

type CardConfig = Extract<PaymentNext, { kind: 'card' }>;
/** when the order page asks again after a 3DS COMPLETE (MP takes a few moments to settle it) */
const CHALLENGE_POLL_MS = [0, 1500, 3000, 5000, 8000, 15000, 30000];
/** what the card form shows: the fields (with why the last try was refused) or the bank's
 *  challenge */
type CardView =
  | { kind: 'form'; cfg: CardConfig; declined: { title: string; body?: string } | null }
  | { kind: 'challenge'; cfg: CardConfig; url: string; creq: string };

/** Kernel 1.7 — the order's online payment (card, online Pix): asks Core for the Pix or, since
 *  1.19, the in-page card form; takes the card's token to Core; and turns the payment's state
 *  into what `checkout.PaymentStatus` / `checkout.CardPayment` show. Offline orders: none. */
function useOnlinePayment(
  order: Order | undefined,
  store: StoreProfile | undefined,
  params: URLSearchParams,
) {
  const { api } = useKernel();
  const [work, setWork] = useState<'sync' | 'redirect' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [next, setNext] = useState<PaymentNext | null>(null);
  const [cardView, setCardView] = useState<CardView | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [fields, setFields] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [justPaid, setJustPaid] = useState(false);
  const started = useRef<string | null>(null);
  const lastStatus = useRef<string | undefined>(undefined);
  const later = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(later.current), []);

  const pay = order?.payment;
  const card = pay?.method === 'card_online';
  const isOnline = !!order && (pay?.online === true || card);
  const method: 'pix' | 'card_online' = card ? 'card_online' : 'pix';
  const status = pay?.status;
  const currency = store?.currency ?? 'BRL';
  const nextPix = next?.kind === 'pix' ? next : null;
  const pixCode = pay?.pix?.copyPaste || nextPix?.copyPaste;
  const pixExpiresAt = pay?.pix?.expiresAt ?? nextPix?.expiresAt ?? null;
  // the Pix expires on the shopper's clock too, not only when Core says so
  const pixTimedOut = usePixTimer(status === 'pending' ? pixExpiresAt : null).expired;
  const retorno = params.get('pagamento') === 'retorno';

  const showForm = (cfg: CardConfig, declined: string | null) => {
    setCardView({ kind: 'form', cfg, declined: declined ? declineCopy(declined) : null });
    setFields('loading');
    setAttempt((a) => a + 1);
  };

  const apply = (n: PaymentNext, cfg: CardConfig | null) => {
    if (n.kind === 'card') return showForm(n, n.declined);
    if (n.kind === 'challenge' && cfg)
      return setCardView({ kind: 'challenge', cfg, url: n.url, creq: n.creq });
    if (n.kind === 'declined' && cfg) return showForm(cfg, n.reason);
    setCardView(null);
    setNext(n);
  };

  const run = async (mode: 'sync' | 'redirect') => {
    if (!order) return;
    clearTimeout(later.current);
    setWork(mode);
    setFailure(null);
    try {
      // the Pix Core creates here carries Mercado Pago's device fingerprint (anti-fraud), waited
      // for briefly; the card sends its own with the token
      const deviceId = card ? null : await mpDeviceId();
      const r = await api.payOrder(order.id, { cardForm: true, deviceId });
      invalidateQuery(`order:${order.id}`, r.order);
      apply(r.next, null);
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

  // MP settles a finished 3DS challenge a few moments after the bank's COMPLETE: show
  // "processing" and ask again, telling Core the challenge was answered so a still-pending one
  // doesn't come back as a fresh card form. Still pending after ~a minute → an ordinary sync.
  const afterChallenge = (i = 0): void => {
    if (!order) return;
    if (i === 0) {
      clearTimeout(later.current);
      setCardView(null);
      setNext({ kind: 'none' });
    }
    if (i >= CHALLENGE_POLL_MS.length) return void run('sync');
    later.current = setTimeout(async () => {
      try {
        const r = await api.payOrder(order.id, { cardForm: true, challengeDone: true });
        invalidateQuery(`order:${order.id}`, r.order);
        if (r.order.payment?.status !== 'pending' || r.next.kind !== 'none')
          return apply(r.next, null);
      } catch (err) {
        if (errorCode(err) === 'PAYMENT_NOT_REQUIRED') return invalidateQuery(`order:${order.id}`);
      }
      afterChallenge(i + 1);
    }, CHALLENGE_POLL_MS[i]);
  };

  // the Brick's spinner runs until this settles; every outcome is the page's to show
  const submitCard = async (cfg: CardConfig, input: CardPaymentInput) => {
    if (!order) return;
    try {
      const r = await api.payCard(order.id, input);
      invalidateQuery(`order:${order.id}`, r.order);
      apply(r.next, cfg);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'INVALID_PAYMENT') return showForm(cfg, 'card_data');
      setCardView(null);
      if (code === 'PAYMENT_IN_PROGRESS') {
        // an earlier submit is still with the bank: wait for it, then ask again
        setNext({ kind: 'none' });
        later.current = setTimeout(() => void run('sync'), 5000);
      } else if (code === 'PAYMENT_NOT_REQUIRED') {
        setNext({ kind: 'none' });
        invalidateQuery(`order:${order.id}`);
      } else setFailure(code);
    }
  };

  // one automatic call per order: generate the missing Pix, or open the card form
  const id = order?.id;
  const cancelled = order?.state === 'cancelled';
  const autoPix = isOnline && !card && status === 'pending' && !pixCode && !cancelled;
  const autoCard = isOnline && card && (status === 'pending' || status === 'failed') && !cancelled;
  useEffect(() => {
    if (!id || started.current === id || !(autoPix || autoCard)) return;
    started.current = id;
    void run('sync');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, autoPix, autoCard]);

  // paid while this page was open (live stream, card answer) — the default celebrates it
  useEffect(() => {
    // …or the shopper came back from an older hosted checkout to a confirmed payment
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
  let showCard = false;
  if (!order || !isOnline) kind = null;
  else if (work === 'redirect') kind = 'redirecting';
  else if (status === 'paid') kind = 'paid';
  else if (status && REFUNDED_PAYMENT_STATUSES.has(status)) kind = 'refunded';
  else if (cancelled) kind = null;
  else if (work === 'sync') kind = 'confirming';
  else if (failure) {
    kind = 'unavailable';
    action = again('Tentar de novo', 'sync');
  } else if (card) {
    if (cardView) showCard = true;
    else if (next?.kind === 'redirect') {
      // a Core that still sends shoppers to the hosted checkout
      kind = status === 'pending' ? 'due' : 'failed';
      action = again(status === 'pending' ? 'Pagar com cartão' : 'Tentar de novo', 'redirect');
    } else if (status === 'pending' && next?.kind === 'none') kind = 'processing';
    else if (status === 'pending' || (status === 'failed' && !next)) kind = 'confirming';
    else if (status === 'failed' || status === 'expired') {
      kind = 'failed';
      action = again('Tentar de novo', 'sync');
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

  const whatsapp = order ? whatsappHref(store, order) : null;
  const panel: SlotProps['checkout.PaymentStatus'] | null =
    kind && order
      ? {
          status: kind,
          method,
          amountCents: order.totalCents,
          currency,
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
                ...(whatsapp ? { whatsappHref: whatsapp } : {}),
              }
            : {}),
        }
      : null;

  let cardPanel: SlotProps['checkout.CardPayment'] | null = null;
  if (showCard && cardView) {
    const { cfg } = cardView;
    cardPanel = {
      amountCents: cfg.amountCents,
      currency,
      phase: cardView.kind === 'challenge' ? 'challenge' : fields,
      declined: cardView.kind === 'form' ? cardView.declined : null,
      fields:
        cardView.kind === 'challenge' ? (
          <ChallengeFrame
            key={cardView.creq}
            url={cardView.url}
            creq={cardView.creq}
            onComplete={() => afterChallenge()}
          />
        ) : (
          <CardFields
            key={attempt}
            provider={cfg.provider}
            publicKey={cfg.publicKey}
            amountCents={cfg.amountCents}
            submitLabel={`Pagar ${formatCents(cfg.amountCents, currency)}`}
            onReady={() => setFields('ready')}
            onError={() => setFields('unavailable')}
            onSubmit={(input) => submitCard(cfg, input)}
          />
        ),
      ...(whatsapp ? { whatsappHref: whatsapp } : {}),
      ...(fields === 'unavailable' && cardView.kind === 'form'
        ? { onRetry: () => showForm(cfg, null) }
        : {}),
    };
  }

  return {
    panel,
    cardPanel,
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
  // Kernel 1.21: opened from the store's WhatsApp link on another device, `tracking` (status only)
  const { order, tracking, loading, error, refetch } = useOrder(id);
  const { store } = useStore();
  const { vocabulary } = useCopy();
  const { reorder, pending } = useReorder();
  const { config } = useKernel();
  const currency = store?.currency ?? 'BRL';
  const timeZone = store?.hours.timezone || undefined;
  const time = timeZone ? { timeZone } : {};
  const shown = order ?? tracking;
  // Kernel 1.21: the state in the tab title ("Pedido #12 · Em preparo · Loja"), live
  usePageTitle(
    shown ? `Pedido #${shown.number} · ${stateWord(shown.state, shown.delivery.mode)}` : null,
  );
  const talk = shown ? whatsappUrl(store?.whatsapp, `Oi! Sobre o pedido #${shown.number}.`) : null;
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
      {loading && !shown ? (
        <OrderSkeleton />
      ) : tracking && !order ? (
        <>
          <Slot
            name="order.TrackingPage"
            order={tracking}
            vocabulary={vocabulary}
            {...time}
            timeline={
              <Slot
                name="order.Timeline"
                events={tracking.timeline.map((e, i) => ({
                  at: e.at,
                  from: tracking.timeline[i - 1]?.to ?? null,
                  to: e.to,
                  actor: '',
                  meta: {},
                }))}
                mode={tracking.delivery.mode}
                {...time}
              />
            }
            {...(tracking.delivery.mode === 'pickup' && store?.pickup
              ? { pickup: store.pickup }
              : {})}
          />
          <p className="v-section-cta v-order-actions" data-part="actions">
            {talk ? (
              <a
                href={talk}
                className="v-btn v-btn-ghost"
                data-vendua="order-whatsapp"
                target="_blank"
                rel="noopener noreferrer"
              >
                Falar com a loja
                <span className="v-sr"> no WhatsApp (abre em outra aba)</span>
              </a>
            ) : null}
            <KLink href={resolvePaths(config).catalog} className="v-btn v-btn-ghost">
              Ver o cardápio
            </KLink>
          </p>
        </>
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
          {isNew ? (
            <Slot name="checkout.SuccessPage" order={order} currency={currency} {...time} />
          ) : null}
          {online.panel ? <Slot name="checkout.PaymentStatus" {...online.panel} /> : null}
          {online.cardPanel ? <Slot name="checkout.CardPayment" {...online.cardPanel} /> : null}
          {payPix ? (
            <Slot
              name="checkout.PixPayment"
              copyPaste={pix.copyPaste}
              beneficiary={pix.beneficiary ?? ''}
              {...(pix.keyType ? { keyLabel: PIX_KEY_LABEL[pix.keyType] ?? pix.keyType } : {})}
              amountCents={order.totalCents}
              currency={currency}
              {...time}
              {...(order.payment.online
                ? { online: true, expiresAt: online.pixExpiresAt ?? null }
                : {})}
            />
          ) : null}
          <Slot
            name="order.StatusPage"
            order={order}
            currency={currency}
            {...time}
            timeline={
              <Slot
                name="order.Timeline"
                events={order.timeline}
                mode={order.delivery.mode}
                {...time}
              />
            }
            {...(order.delivery.mode === 'pickup' && store?.pickup ? { pickup: store.pickup } : {})}
          />
          {order.items?.length ? (
            <Slot
              name="order.Items"
              items={order.items}
              currency={currency}
              vocabulary={vocabulary}
              notes={order.notes ?? null}
              scheduledFor={order.scheduledFor ?? null}
              discountCents={order.discountCents ?? 0}
              couponCode={order.coupon?.code ?? null}
              {...(order.paymentAdjustmentCents
                ? {
                    paymentAdjustmentCents: order.paymentAdjustmentCents,
                    paymentLabel:
                      PAYMENT_METHOD_LABEL[order.payment.method] ?? order.payment.method,
                  }
                : {})}
              onReorder={() => void reorder(order.id)}
              reorderPending={pending === order.id}
            />
          ) : null}
          <p className="v-section-cta v-order-actions" data-part="actions">
            {talk ? (
              <a
                href={talk}
                className="v-btn v-btn-ghost"
                data-vendua="order-whatsapp"
                target="_blank"
                rel="noopener noreferrer"
              >
                Falar com a loja
                <span className="v-sr"> no WhatsApp (abre em outra aba)</span>
              </a>
            ) : null}
            <KLink href={KERNEL_PATHS.orders} className="v-btn v-btn-ghost">
              Meus pedidos
            </KLink>
          </p>
        </>
      )}
    </main>
  );
}

/** Kernel 1.21 — the order page's shape while it loads (state, progress, facts). */
function OrderSkeleton() {
  return (
    <div
      className="v-order v-skeleton-page"
      data-vendua="order-skeleton"
      aria-busy="true"
      aria-label="Carregando pedido"
    >
      <span className="v-skeleton v-skeleton-line" data-short="" />
      <div className="v-skeleton v-skeleton-title" />
      <div className="v-skeleton v-skeleton-bar" />
      <div className="v-order-grid" aria-hidden="true">
        <span className="v-skeleton-lines">
          <span className="v-skeleton v-skeleton-line" />
          <span className="v-skeleton v-skeleton-line" data-short="" />
          <span className="v-skeleton v-skeleton-line" />
        </span>
        <div className="v-skeleton v-skeleton-block" />
      </div>
    </div>
  );
}

export function OrderHistoryPage() {
  const local = useOrderHistory();
  const phone = useOrders();
  const loyalty = useLoyalty(phone.phone);
  const { store } = useStore();
  const { vocabulary } = useCopy();
  const { reorder, pending } = useReorder();
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string>();
  const currency = store?.currency ?? 'BRL';
  const timeZone = store?.hours.timezone || undefined;
  usePageTitle('Meus pedidos');

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
      mode: o.delivery.mode,
      here: true,
    })),
    ...phone.orders.filter((o) => !localIds.has(o.id)).map((o) => ({ ...o, here: false })),
  ].sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt));
  const loading = (local.loading || phone.loading) && rows.length === 0;

  // Kernel 1.21: a phone's order placed on this device opens when its token is still here
  const { api } = useKernel();
  const held = new Set(api.orderIds());
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
        <Slot
          name="customer.LoyaltyCard"
          card={loyalty.card}
          currency={currency}
          {...(timeZone ? { timeZone } : {})}
        />
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
                    {new Date(o.placedAt).toLocaleDateString(LOCALE, {
                      day: '2-digit',
                      month: 'short',
                      ...(timeZone ? { timeZone } : {}),
                    })}
                    {o.items.length
                      ? ` · ${o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}`
                      : ''}
                  </span>
                </span>
                <span className="v-order-row-side">
                  <span className="v-num v-order-row-total">
                    {formatCents(o.totalCents, currency)}
                  </span>
                  <span className="v-order-row-state" data-state={o.state}>
                    {orderStateLabel(o.state, o.mode)}
                  </span>
                </span>
              </>
            );
            return (
              <li key={o.id} data-origin={o.here ? 'device' : 'phone'}>
                {o.here || held.has(o.id) ? (
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
                    {pending === o.id ? `Colocando ${vocabulary.inBag}…` : 'Pedir de novo'}
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
