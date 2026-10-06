import { useEffect, useRef, useState } from 'react';
import {
  lineDraw,
  unitsLeft,
  useCart,
  useCep,
  useCopy,
  useCoupon,
  useCustomer,
  useDeliveryQuote,
  useDeliveryZones,
  useStore,
} from '../hooks.ts';
import { CheckoutButton, useNavigateTo } from '../primitives.tsx';
import { Slot } from '../slot.tsx';
import { showError, showInfo } from '../errors.ts';
import { useKernel } from '../provider.tsx';
import { resolvePaths } from '../config.ts';
import { ITEM_NOTE_MAX, type Cart, type CartItem, type QuoteResult } from '../api.ts';
import { haptic } from '../haptics.ts';
import { MAX_LINE_QTY } from '../rules/card.ts';
import type { Vocabulary } from '../rules/copy.ts';
import { formatCents } from '../rules/format.ts';
import { digitsOf, isValidCep, maskCep } from '../rules/phone.ts';
import { usePageTitle } from '../head.ts';
import { closedNote } from './closed.ts';

// /sacola — Kernel page (17 — Kernel pages), rendered inside the store's layout.
// Totals are Core's; the page only wires slots to the cart mutations.

function Line({
  item,
  currency,
  vocabulary,
}: {
  item: CartItem;
  currency: string;
  vocabulary: Vocabulary;
}) {
  const { cart, mutations } = useCart();
  const [pending, setPending] = useState(false);
  // other lines (another modifier set, a kit with the same pick) draw on the same stock
  const max = Math.min(MAX_LINE_QTY, Math.max(item.qty, unitsLeft(cart, lineDraw(item), item.id)));
  const run = async (fn: () => Promise<unknown>) => {
    setPending(true);
    try {
      await fn();
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Slot
      name="cart.LineItem"
      item={item}
      currency={currency}
      vocabulary={vocabulary}
      pending={pending}
      max={max}
      onQty={(qty) => {
        const next = Math.min(qty, max);
        if (qty > 0 && next === item.qty) return;
        haptic.tick();
        void run(() => (qty <= 0 ? mutations.remove(item.id) : mutations.updateQty(item.id, next)));
      }}
      onRemove={() => void run(() => mutations.remove(item.id))}
      noteMax={ITEM_NOTE_MAX}
      onNote={(note) => {
        if (note.trim() === (item.note ?? '')) return;
        void run(() => mutations.setNote(item.id, note));
      }}
    />
  );
}

/** "Mandar sacola": a Core share code as a link — native share sheet, else clipboard. */
function ShareCart() {
  const { mutations } = useCart();
  const { vocabulary } = useCopy();
  const [pending, setPending] = useState(false);
  const share = async () => {
    setPending(true);
    try {
      const { url } = await mutations.share();
      const nav = globalThis.navigator as Navigator | undefined;
      if (nav?.share) {
        await nav.share({ title: vocabulary.yourBag, url }).catch(() => {});
      } else {
        await nav?.clipboard?.writeText(url);
        showInfo(
          'share',
          `Link ${vocabulary.ofBag} copiado`,
          'Abra em outro aparelho ou mande para alguém.',
        );
      }
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <button
      type="button"
      className="v-link-btn"
      data-vendua="share-cart"
      disabled={pending}
      onClick={() => void share()}
    >
      {pending ? 'Gerando link…' : `Mandar ${vocabulary.bag} por link`}
    </button>
  );
}

function Coupon({ currency }: { currency: string }) {
  const coupon = useCoupon();
  return (
    <Slot
      name="checkout.CouponField"
      coupon={coupon.coupon}
      discountCents={coupon.discountCents}
      currency={currency}
      pending={coupon.pending}
      {...(coupon.message ? { error: coupon.message } : {})}
      onApply={(code) => void coupon.apply(code)}
      onRemove={() => void coupon.remove()}
    />
  );
}

type QuoteWhere = { neighborhood?: string; lat?: number; lng?: number };
type Estimate =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; place: string; quote: QuoteResult }
  /** Core delivers nowhere it knows by that bairro */
  | { kind: 'out'; place: string }
  /** drawn or radius zones decide by the address: the fee comes at the delivery step */
  | { kind: 'later'; place: string }
  | { kind: 'error'; message: string };

const pinOf = (a: { lat?: number; lng?: number } | undefined) =>
  typeof a?.lat === 'number' && typeof a.lng === 'number' ? { lat: a.lat, lng: a.lng } : null;

/** Kernel 1.21 — "Calcular entrega" before the delivery step: the remembered address (or a
 *  CEP) quoted on this cart. Every figure is Core's (`api.quote` with the cart session). */
function DeliveryEstimate({ cart, currency }: { cart: Cart; currency: string }) {
  const { store } = useStore();
  const { zones } = useDeliveryZones();
  const { customer } = useCustomer();
  const cepLookup = useCep();
  const { quote } = useDeliveryQuote();
  const money = (c: number) => formatCents(c, currency);
  const byDistance = store?.distancePricing ?? null;
  const geoZones = zones.some((z) => z.kind === 'radius' || z.kind === 'polygon');
  const remembered = customer?.address;
  const [where, setWhere] = useState<{ arg: QuoteWhere; place: string } | null>(() => {
    const pin = pinOf(remembered);
    const bairro = remembered?.neighborhood.trim();
    const place = bairro || remembered?.street.trim() || '';
    if (byDistance) return pin ? { arg: pin, place } : null;
    if (!pin && !bairro) return null;
    return { arg: { ...(bairro ? { neighborhood: bairro } : {}), ...(pin ?? {}) }, place };
  });
  const [cep, setCep] = useState(() => maskCep(remembered?.cep ?? ''));
  const [editing, setEditing] = useState(where === null);
  const [estimate, setEstimate] = useState<Estimate>({ kind: 'idle' });
  // Core's totals change with the bag: ask again so the figures stay its own
  const t = cart.totals;
  const cartKey = [t.subtotalCents, t.discountCents ?? 0, t.itemCount].join('|');

  useEffect(() => {
    if (!where) return;
    let live = true;
    setEstimate({ kind: 'pending' });
    quote({ ...where.arg, withCart: true }).then(
      (r) => {
        if (!live) return;
        setEstimate(
          r.eligible
            ? { kind: 'ok', place: where.place, quote: r }
            : { kind: geoZones && !where.arg.lat ? 'later' : 'out', place: where.place },
        );
      },
      () => {
        if (live) setEstimate({ kind: 'error', message: 'Não deu para calcular agora.' });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where, cartKey]);

  // a remembered CEP alone (no bairro) is looked up once
  const autoCep = useRef(where === null && !byDistance && isValidCep(cep));
  const lookup = async (value: string) => {
    setEstimate({ kind: 'pending' });
    const r = await cepLookup.lookup(value);
    // the hook's error lands with the next render: words chosen there
    if (!r) return setEstimate({ kind: 'error', message: '' });
    const bairro = r.address.neighborhood?.trim();
    setEditing(false);
    if (bairro) setWhere({ arg: { neighborhood: bairro }, place: bairro });
    else setEstimate({ kind: 'later', place: `CEP ${maskCep(value)}` });
  };
  useEffect(() => {
    if (!autoCep.current) return;
    autoCep.current = false;
    void lookup(cep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (
    !store ||
    store.deliveryEnabled === false ||
    cart.delivery?.mode === 'delivery' ||
    (!byDistance && zones.length === 0)
  )
    return null;
  if (byDistance && !where)
    return (
      <p className="v-note v-estimate" data-vendua="delivery-estimate" data-state="distance">
        Entrega calculada pela distância
        {byDistance.fromFeeCents > 0 ? `, a partir de ${money(byDistance.fromFeeCents)}` : ''}. Você
        confirma o local no próximo passo.
      </p>
    );

  const totals = estimate.kind === 'ok' ? estimate.quote.totals : undefined;
  const fee =
    estimate.kind === 'ok' ? (totals?.deliveryFeeCents ?? estimate.quote.feeCents ?? 0) : 0;
  return (
    <section
      className="v-estimate"
      data-vendua="delivery-estimate"
      data-state={estimate.kind}
      aria-label="Calcular entrega"
    >
      {editing && !byDistance ? (
        <form
          className="v-estimate-form"
          data-part="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (isValidCep(cep)) void lookup(digitsOf(cep));
          }}
        >
          <label className="v-label" htmlFor="v-estimate-cep">
            Calcular entrega
          </label>
          <div className="v-estimate-row">
            <input
              id="v-estimate-cep"
              name="estimate-cep"
              className="v-input"
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="Seu CEP"
              maxLength={9}
              value={cep}
              onChange={(e) => setCep(maskCep(e.target.value))}
            />
            <button
              type="submit"
              className="v-btn v-btn-ghost"
              data-part="submit"
              disabled={!isValidCep(cep) || estimate.kind === 'pending'}
            >
              Calcular
            </button>
          </div>
        </form>
      ) : null}
      <div className="v-estimate-result" data-part="result" role="status">
        {estimate.kind === 'pending' ? (
          <p className="v-muted">Calculando a entrega…</p>
        ) : estimate.kind === 'ok' ? (
          <>
            <p data-part="fee">
              Entrega para <strong>{estimate.place || 'seu endereço'}</strong>:{' '}
              <span className="v-num">{fee > 0 ? money(fee) : 'grátis'}</span>
              {estimate.quote.etaMin != null
                ? ` · ${estimate.quote.etaMin}–${estimate.quote.etaMax} min`
                : ''}
            </p>
            {totals ? (
              <p className="v-estimate-total" data-part="total">
                Total com entrega <span className="v-num">{money(totals.totalCents)}</span>
              </p>
            ) : null}
            {totals?.belowMinOrder ? (
              <p className="v-muted" data-part="min-order">
                Pedido mínimo para entrega: {money(totals.minOrderCents)} — faltam{' '}
                {money(totals.remainingMinOrderCents)}.
              </p>
            ) : null}
            {totals?.freeDeliveryRemainingCents ? (
              <p className="v-muted" data-part="free-delivery">
                Faltam {money(totals.freeDeliveryRemainingCents)} para a entrega grátis.
              </p>
            ) : null}
          </>
        ) : estimate.kind === 'out' ? (
          <p data-part="out">
            {estimate.place} fica fora da área de entrega
            {store.pickupEnabled !== false ? ' — a retirada continua disponível' : ''}.
          </p>
        ) : estimate.kind === 'later' ? (
          <p className="v-muted" data-part="later">
            O valor para {estimate.place} aparece quando você informar o endereço.
          </p>
        ) : estimate.kind === 'error' ? (
          <p className="v-muted" data-part="error">
            {estimate.message ||
              (cepLookup.error?.code === 'CEP_UNAVAILABLE' ||
              cepLookup.error?.code === 'NETWORK_ERROR'
                ? 'A busca de CEP não respondeu agora.'
                : 'CEP não encontrado.')}
          </p>
        ) : null}
      </div>
      {!editing && !byDistance ? (
        <button
          type="button"
          className="v-link-btn"
          data-part="change"
          onClick={() => setEditing(true)}
        >
          {estimate.kind === 'ok' ? 'Calcular para outro CEP' : 'Calcular com o CEP'}
        </button>
      ) : null}
    </section>
  );
}

/** Kernel 1.21 — the bag's shape while it loads (lines and the summary), not a blank box. */
function CartSkeleton({ bag }: { bag: string }) {
  return (
    <div
      className="v-cart v-skeleton-page"
      data-vendua="cart-skeleton"
      aria-busy="true"
      aria-label={`Carregando ${bag}`}
    >
      <div className="v-skeleton v-skeleton-title" />
      <div className="v-cart-grid">
        <ol className="v-cart-lines" aria-hidden="true">
          {[0, 1].map((i) => (
            <li key={i} className="v-line">
              <span className="v-line-thumb v-skeleton" />
              <span className="v-skeleton-lines">
                <span className="v-skeleton v-skeleton-line" />
                <span className="v-skeleton v-skeleton-line" data-short="" />
              </span>
            </li>
          ))}
        </ol>
        <div className="v-skeleton v-skeleton-block" aria-hidden="true" />
      </div>
    </div>
  );
}

/** The bag itself — the `/sacola` page, or the sheet drawn over the page it was opened from. */
export function CartContents({
  presentation,
  onClose,
  onBrowse,
}: {
  presentation: 'page' | 'drawer';
  /** drawer: close the sheet; page: back to browsing */
  onClose?: () => void;
  /** the empty bag's way to the menu (default: go to the catalog) */
  onBrowse?: () => void;
}) {
  const { cart, loading } = useCart();
  const { store } = useStore();
  const { vocabulary } = useCopy();
  const { config } = useKernel();
  const go = useNavigateTo();
  const currency = store?.currency ?? 'BRL';
  const browse = onClose ?? (() => go(resolvePaths(config).catalog));
  const open = cart?.status === 'open' && cart.items.length > 0;
  const closed = open ? closedNote(store, cart.items, vocabulary.bag) : null;

  if (loading && !cart) return <CartSkeleton bag={vocabulary.bag} />;
  if (!open)
    return (
      <Slot
        name="checkout.EmptyCart"
        vocabulary={vocabulary}
        onBrowse={onBrowse ?? (() => go(resolvePaths(config).catalog))}
      />
    );
  return (
    <Slot
      name="cart.Drawer"
      cart={cart}
      currency={currency}
      vocabulary={vocabulary}
      presentation={presentation}
      onClose={browse}
      lines={cart.items.map((i) => (
        <Line key={i.id} item={i} currency={currency} vocabulary={vocabulary} />
      ))}
      summary={
        <>
          <Slot name="checkout.Summary" cart={cart} currency={currency} vocabulary={vocabulary} />
          <DeliveryEstimate cart={cart} currency={currency} />
          <Coupon currency={currency} />
          <ShareCart />
        </>
      }
      checkout={
        <>
          <CheckoutButton asChild>
            <button type="button" className="v-btn v-btn-accent v-btn-block">
              Ir para o pagamento
            </button>
          </CheckoutButton>
          {closed ? (
            <p className="v-note" role="status" data-part="closed-note">
              {closed}
            </p>
          ) : null}
        </>
      }
    />
  );
}

export function CartPage() {
  const { vocabulary } = useCopy();
  usePageTitle(capitalize(vocabulary.bag));
  return (
    <main id="main" className="v-page" data-vendua-page="cart">
      <CartContents presentation="page" />
    </main>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
