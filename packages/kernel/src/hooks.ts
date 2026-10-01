import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useKernel, useQuery, invalidateQuery, invalidateMatching } from './provider.tsx';
import type {
  AddedLine,
  Cart,
  CartCoupon,
  CartItem,
  CatalogCategory,
  CepResult,
  CheckoutInput,
  ComboSelection,
  CouponCheck,
  DeliveryAddress,
  DeliveryZone,
  ImportLine,
  ImportReport,
  LinePicks,
  LineQuote,
  LoyaltyCard,
  Notice,
  Order,
  OrderSummary,
  ProductDetail,
  QuoteResult,
  StoreProfile,
} from './api.ts';
import { ApiError } from './api.ts';
import type { ConsentPurpose } from './config.ts';
import { cardState, type CardInput, type CardState } from './rules/card.ts';
import { couponMessage } from './rules/errors.ts';
import { countdown, formatCents, interpolate } from './rules/format.ts';
import { deliverySummary, type DeliverySummary } from './rules/delivery.ts';
import {
  hoursRows,
  statusHint,
  statusWords,
  todayHours,
  type HoursRow,
  type StatusHint,
  type TodayHours,
} from './rules/hours.ts';
import {
  absoluteUrl,
  catalogHref,
  contactLinks,
  productAnchor,
  productHref,
  type ContactLinks,
} from './rules/links.ts';
import { arrangeMenu } from './rules/menu.ts';
import { TERMINAL_ORDER_STATES } from './rules/orders.ts';
import { isBlocking, visibleNotices } from './rules/notices.ts';
import { vocabularyOf, type Vocabulary } from './rules/copy.ts';
import { digitsOf, isValidCep, phoneKey } from './rules/phone.ts';
import {
  currentConsent,
  emit,
  onConsentChange,
  trackCustom,
  writeConsent,
  type ConsentState,
} from './telemetry.ts';

// data hooks — thin typed wrappers over Core reads (02-kernel.md#hooks);
// they never compute prices or eligibility, and every read exposes `refetch`

export interface QueryError {
  status?: number | undefined;
  code: string;
  message: string;
  details?: Record<string, unknown> | undefined;
}

export function useStore(): {
  store: StoreProfile | undefined;
  status: 'open' | 'closed' | 'paused' | undefined;
  resumesAt: string | undefined;
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
} {
  const { api } = useKernel();
  const q = useQuery('store', () => api.store());
  return {
    store: q.data,
    status: q.data?.status,
    resumesAt: q.data?.resumesAt,
    loading: q.loading,
    error: q.error,
    refetch: q.refetch,
  };
}

export function useCatalog(): {
  categories: CatalogCategory[];
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
} {
  const { api } = useKernel();
  const q = useQuery('catalog', () => api.catalog());
  // Kernel 1.13 — Core says when the catalog next changes by itself (a timed promotion or a
  // product's hours starting or ending): the catalog and open product pages are read again then
  // armed again on every read: the 6-hour cap (or a clock running ahead) can read the catalog
  // before the moment and get the same instant back
  const data = q.data;
  useEffect(() => {
    const next = data?.nextChangeAt;
    const at = next ? Date.parse(next) : NaN;
    if (!Number.isFinite(at)) return;
    // a sleeping laptop wakes past the moment: a capped wait re-reads and asks again
    const wait = Math.min(Math.max(at - Date.now(), 0) + 1000, 6 * 3_600_000);
    const t = setTimeout(
      () => invalidateMatching((key) => key === 'catalog' || key.startsWith('product:')),
      wait,
    );
    return () => clearTimeout(t);
  }, [data]);
  return {
    categories: q.data?.categories ?? [],
    loading: q.loading,
    error: q.error,
    refetch: q.refetch,
  };
}

export function useProduct(slug: string): {
  product: ProductDetail | undefined;
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
} {
  const { api } = useKernel();
  const q = useQuery(`product:${slug}`, () => api.product(slug));
  const product = q.data?.product;
  // product_view once per resolved product per mount (15 — taxonomy)
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!product || seen.current === product.id) return;
    seen.current = product.id;
    emit('product_view', { product_id: product.id, slug: product.slug });
  }, [product]);
  return { product, loading: q.loading, error: q.error, refetch: q.refetch };
}

export function useNotices(zoneMatched?: boolean): {
  notices: Notice[];
  blocking: Notice[];
  store: { status: 'open' | 'closed' | 'paused'; resumesAt?: string } | undefined;
  loading: boolean;
  refetch: () => void;
} {
  const { api } = useKernel();
  const key = `surfaces:${zoneMatched ?? 'any'}`;
  const q = useQuery(key, () => api.surfaces(zoneMatched));
  const all = q.data?.notices;
  // Kernel 1.14: only notices inside their window, re-read when the next one opens or closes
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    let nearest = Infinity;
    for (const n of all ?? [])
      for (const b of [n.startsAt, n.endsAt]) {
        const t = b ? Date.parse(b) : NaN;
        if (t > now && t < nearest) nearest = t;
      }
    if (nearest === Infinity) return;
    const id = setTimeout(() => setTick((t) => t + 1), Math.min(nearest - now + 50, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [all, tick]);
  const notices = visibleNotices(all ?? []);
  const blocking = notices.filter(isBlocking);
  return { notices, blocking, store: q.data?.store, loading: q.loading, refetch: q.refetch };
}

export function useDeliveryZones(): {
  zones: DeliveryZone[];
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
} {
  const { api } = useKernel();
  const q = useQuery('zones', () => api.zones());
  return { zones: q.data?.zones ?? [], loading: q.loading, error: q.error, refetch: q.refetch };
}

export interface CartMutations {
  add: (
    productId: string,
    qty?: number,
    modifierIds?: string[],
    /** Kernel 1.2 — kit picks for a `kind: 'combo'` product */
    comboSelections?: ComboSelection[],
    /** Kernel 1.12 — units per option id, for options with `maxQty` > 1 (absent = 1 each) */
    modifierQty?: Record<string, number>,
  ) => Promise<Cart>;
  /** Kernel 1.14 — `add`, also answering what Core added (`added`: units and Core's price) */
  addLine: (
    productId: string,
    qty?: number,
    modifierIds?: string[],
    comboSelections?: ComboSelection[],
    modifierQty?: Record<string, number>,
  ) => Promise<{ cart: Cart; added?: AddedLine }>;
  updateQty: (itemId: string, qty: number) => Promise<Cart>;
  remove: (itemId: string) => Promise<Cart>;
  setDelivery: (d: { mode: 'pickup' | 'delivery' } & DeliveryAddress) => Promise<Cart>;
  /** Kernel 1.2 — Core validates and prices; a coupon short of its minimum stays on, not applying */
  applyCoupon: (code: string) => Promise<Cart>;
  removeCoupon: () => Promise<Cart>;
  /** Kernel 1.2 — merge lines into this cart; `report.skipped` says what couldn't be added */
  importItems: (items: ImportLine[]) => Promise<{ cart: Cart; report: ImportReport }>;
  /** Kernel 1.2 — a `?cart=CODE` link anyone can open to get this sacola */
  share: () => Promise<{ code: string; url: string; expiresAt: string }>;
  /** Kernel 1.2 — "pedir de novo": a past order's lines back in the sacola */
  reorder: (orderId: string) => Promise<{ cart: Cart; report: ImportReport }>;
}

export function useCart(): {
  /** null = no session/cart yet (or a resolved empty read). */
  cart: Cart | null;
  loading: boolean;
  error: QueryError | undefined;
  mutations: CartMutations;
  refetch: () => void;
} {
  const { api, invalidate } = useKernel();
  const q = useQuery('cart', () =>
    api.sessionToken ? api.cart().then((r) => r.cart) : Promise.resolve(null),
  );

  const bump = useCallback(
    (cart: Cart) => {
      // seed, don't evict: an evict→refetch gap drops cart to null mid-render,
      // re-firing checkout effects into a POST loop
      invalidateQuery('cart', cart);
      invalidate('cart');
      return cart;
    },
    [invalidate],
  );

  const mutations = useMemo<CartMutations>(
    () => ({
      add: (productId, qty = 1, modifierIds = [], comboSelections, modifierQty) =>
        api.addItem(productId, qty, modifierIds, comboSelections, modifierQty).then(bump),
      addLine: (productId, qty = 1, modifierIds = [], comboSelections, modifierQty) =>
        api.addLine(productId, qty, modifierIds, comboSelections, modifierQty).then((r) => {
          bump(r.cart);
          return r;
        }),
      updateQty: (itemId, qty) => api.updateItem(itemId, qty).then(bump),
      remove: (itemId) => api.removeItem(itemId).then(bump),
      setDelivery: (d) => api.setDelivery(d).then(bump),
      applyCoupon: (code) => api.applyCoupon(code).then(bump),
      removeCoupon: () => api.removeCoupon().then(bump),
      importItems: (items) =>
        api.importCart(items).then((r) => {
          bump(r.cart);
          return r;
        }),
      share: async () => {
        const r = await api.shareCart();
        const origin = globalThis.location?.origin ?? '';
        return { ...r, url: `${origin}/?cart=${encodeURIComponent(r.code)}` };
      },
      reorder: (orderId) =>
        api.reorder(orderId).then((r) => {
          bump(r.cart);
          return r;
        }),
    }),
    [api, bump],
  );

  return {
    cart: q.data ?? null,
    loading: q.loading,
    error: q.error,
    mutations,
    refetch: q.refetch,
  };
}

/** Units of a product the cart already holds: direct lines plus kit picks × kit qty,
 *  counted the way Core's stock check (`stockDemand`) counts them. */
export function cartDemand(cart: Cart | null, productId: string, excludeItemId?: string): number {
  if (!cart || cart.status !== 'open') return 0;
  let n = 0;
  for (const line of cart.items) {
    if (line.id === excludeItemId) continue;
    if (line.productId === productId) n += line.qty;
    for (const pick of line.comboSelections ?? line.combo ?? [])
      if (pick.productId === productId) n += pick.qty * line.qty;
  }
  return n;
}

/** What one unit of a product (or kit) draws: productId → units, with its tracked stock. */
export type StockDraw = { productId: string; perUnit: number; stock: number | null | undefined }[];

/** Draw of one unit of `product` with `picks`; pick stock comes from the product's combo slots. */
export function productDraw(
  product: {
    id: string;
    stockQuantity?: number | null;
    comboSlots?: { items: { productId: string; stockQuantity: number | null }[] }[];
  },
  picks: readonly { productId: string; qty: number }[] = [],
): StockDraw {
  const stock = new Map(
    (product.comboSlots ?? []).flatMap((s) => s.items.map((i) => [i.productId, i.stockQuantity])),
  );
  return [
    { productId: product.id, perUnit: 1, stock: product.stockQuantity },
    ...picks.map((p) => ({
      productId: p.productId,
      perUnit: p.qty,
      stock: stock.get(p.productId),
    })),
  ];
}

/** Draw of one unit of a cart line (its kit picks carry their stock since Core 1.9). */
export function lineDraw(item: CartItem): StockDraw {
  const stock = new Map((item.combo ?? []).map((c) => [c.productId, c.stockQuantity]));
  return [
    { productId: item.productId, perUnit: 1, stock: item.stockQuantity },
    ...(item.comboSelections ?? item.combo ?? []).map((p) => ({
      productId: p.productId,
      perUnit: p.qty,
      stock: stock.get(p.productId),
    })),
  ];
}

/** How many units of `draw` still fit next to the cart; Infinity when no stock is tracked. */
export function unitsLeft(cart: Cart | null, draw: StockDraw, excludeItemId?: string): number {
  const need = new Map<string, { perUnit: number; stock: number }>();
  for (const d of draw) {
    if (typeof d.stock !== 'number' || d.perUnit <= 0) continue;
    const prev = need.get(d.productId);
    need.set(d.productId, { perUnit: (prev?.perUnit ?? 0) + d.perUnit, stock: d.stock });
  }
  let max = Number.POSITIVE_INFINITY;
  for (const [id, { perUnit, stock }] of need) {
    const left = Math.max(0, stock - cartDemand(cart, id, excludeItemId));
    max = Math.min(max, Math.floor(left / perUnit));
  }
  return max;
}

/** A product's tracked stock minus what the cart holds (kit picks included); null = not
 *  tracked. `useStockLeft` without the hook, for lists. */
export function stockLeftOf(
  cart: Cart | null,
  product: { id: string; stockQuantity?: number | null } | null | undefined,
): number | null {
  const stock = product?.stockQuantity;
  if (!product || typeof stock !== 'number') return null;
  return Math.max(0, stock - cartDemand(cart, product.id));
}

/** Kernel 1.9 — units of a product the shopper can still add (its stock minus what the
 *  cart holds, kit picks included); null = stock not tracked. */
export function useStockLeft(
  product: { id: string; stockQuantity?: number | null } | null | undefined,
): number | null {
  const { cart } = useCart();
  return stockLeftOf(cart, product);
}

const TERMINAL_ORDER = TERMINAL_ORDER_STATES;
const FIRST_WAIT_DELAY_MS = 1500;

/** Live by default (Kernel 1.2; SSE since 1.3): a Kernel-owned stream of the
 *  order — no storefront polling. It opens once the page settles, drops while
 *  the tab is hidden, reconnects with backoff, stops at a terminal state, and
 *  falls back to Core's long poll when no event stream gets through (an old
 *  Core, a buffering proxy). `{ live: false }` restores the plain read. */
export function useOrder(
  id: string,
  opts: { live?: boolean } = {},
): {
  order: Order | undefined;
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
  /** a live connection is open right now */
  live: boolean;
  /** Kernel 1.3 — which transport carries it */
  transport: 'stream' | 'poll' | null;
} {
  const { api } = useKernel();
  const q = useQuery(`order:${id}`, () => api.order(id));
  const [fresh, setFresh] = useState<Order>();
  const [live, setLive] = useState(false);
  const [transport, setTransport] = useState<'stream' | 'poll' | null>(null);
  const armed = useRef(false);
  const want = opts.live !== false;
  // whichever read is newer wins: the live answer or a refetch
  const own = fresh?.id === id ? fresh : undefined;
  const current = own && (own.version ?? 0) >= (q.data?.version ?? 0) ? own : (q.data ?? own);
  const versionRef = useRef<number | undefined>(undefined);
  const seen = current?.version;
  if (seen !== undefined && seen > (versionRef.current ?? 0)) versionRef.current = seen;
  // Core without Kernel-1.2 orders (no version) keeps the plain read
  const ready = current?.version !== undefined;
  const terminal = current?.state ? TERMINAL_ORDER.has(current.state) : false;

  useEffect(() => {
    setFresh(undefined);
    armed.current = false;
    versionRef.current = undefined;
  }, [id]);

  useEffect(() => {
    if (!want || !ready || terminal) return;
    const master = new AbortController();
    let stopped = false;
    let failures = 0;
    let mode: 'stream' | 'poll' = 'stream';
    const doc = globalThis.document;
    const visible = () => !doc || doc.visibilityState !== 'hidden';
    const sleep = (ms: number) =>
      new Promise<void>((r) => {
        const t = setTimeout(r, ms);
        master.signal.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
      });
    const accept = (o: Order) => {
      if ((o.version ?? 0) <= (versionRef.current ?? 0)) return;
      versionRef.current = o.version;
      setFresh(o);
    };
    const loop = async () => {
      while (!stopped) {
        if (!visible()) {
          setLive(false);
          await new Promise<void>((r) => {
            const on = () => {
              if (visible() || stopped) {
                doc?.removeEventListener('visibilitychange', on);
                r();
              }
            };
            doc?.addEventListener('visibilitychange', on);
            master.signal.addEventListener('abort', on, { once: true });
          });
          continue;
        }
        // one connection per iteration; hiding the tab closes it
        const round = new AbortController();
        const kill = () => round.abort();
        master.signal.addEventListener('abort', kill, { once: true });
        const onHide = () => {
          if (!visible()) kill();
        };
        doc?.addEventListener('visibilitychange', onHide);
        setLive(true);
        setTransport(mode);
        try {
          if (mode === 'stream') {
            await api.orderStream(id, versionRef.current ?? 0, accept, round.signal);
            failures = 0;
            // Core closed it (lifetime or terminal) — a beat before reconnecting
            await sleep(1000);
          } else {
            const r = await api.orderWait(id, versionRef.current ?? 0, 25, round.signal);
            failures = 0;
            if (r.changed) accept(r.order);
          }
        } catch (err) {
          if (stopped) return;
          if (round.signal.aborted) continue; // hidden tab, not a failure
          if (mode === 'stream' && err instanceof ApiError && err.code === 'STREAM_UNAVAILABLE') {
            mode = 'poll';
            continue;
          }
          failures++;
          setLive(false);
          await sleep(Math.min(30_000, 1000 * 2 ** failures));
        } finally {
          master.signal.removeEventListener('abort', kill);
          doc?.removeEventListener('visibilitychange', onHide);
        }
      }
    };
    // the first connection opens after the page settles: load stays quick and tools
    // that wait for network idle (crawlers, screenshots, conformance) aren't held forever
    const start = armed.current ? Promise.resolve() : sleep(FIRST_WAIT_DELAY_MS);
    armed.current = true;
    void start.then(() => {
      if (!stopped) void loop();
    });
    return () => {
      stopped = true;
      master.abort();
      setLive(false);
      setTransport(null);
    };
  }, [api, id, want, ready, terminal]);

  return {
    order: current,
    loading: q.loading && !current,
    error: current ? undefined : q.error,
    refetch: q.refetch,
    live,
    transport,
  };
}

export function useCheckout(): {
  submit: (input: CheckoutInput) => Promise<Order>;
  pending: boolean;
  /** structured failure; `code`/`details.field` stable for form display */
  error: QueryError | undefined;
  reset: () => void;
} {
  const { api, invalidate } = useKernel();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<QueryError | undefined>();

  const submit = useCallback(
    async (input: CheckoutInput) => {
      setPending(true);
      setError(undefined);
      emit('payment_submit', { method: input.payment.method });
      try {
        const order = await api.checkout(input);
        // drop the now-completed cart so the next read isn't stale
        invalidateQuery('cart');
        invalidate('cart');
        return order;
      } catch (err) {
        const e =
          err instanceof ApiError
            ? { status: err.status, code: err.code, message: err.message, details: err.details }
            : { code: 'INTERNAL', message: err instanceof Error ? err.message : 'checkout failed' };
        setError(e);
        emit('order_failed', { code: e.code });
        // Core already moved the lines to the live price: show the new total
        if (e.code === 'PRICES_CHANGED') {
          invalidateQuery('cart');
          invalidate('cart');
        }
        throw err;
      } finally {
        setPending(false);
      }
    },
    [api, invalidate],
  );

  return { submit, pending, error, reset: useCallback(() => setError(undefined), []) };
}

/** Zone check for a neighborhood — fee, ETA and eligibility are Core's answer. */
export function useDeliveryQuote(): {
  /** a bairro, or Kernel 1.2 `{ lat, lng }` (e.g. from the device's location); Kernel 1.12
   *  `paymentMethod` adds the cart's `totals` priced for it */
  quote: (
    where: string | { neighborhood?: string; lat?: number; lng?: number; paymentMethod?: string },
  ) => Promise<QuoteResult>;
  result: QuoteResult | undefined;
  pending: boolean;
  error: QueryError | undefined;
} {
  const { api } = useKernel();
  const [result, setResult] = useState<QuoteResult>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<QueryError>();
  const seq = useRef(0);
  const quote = useCallback(
    async (
      where: string | { neighborhood?: string; lat?: number; lng?: number; paymentMethod?: string },
    ) => {
      const n = ++seq.current;
      setPending(true);
      setError(undefined);
      try {
        const r = await api.quote(typeof where === 'string' ? where.trim().slice(0, 80) : where);
        if (n === seq.current) setResult(r);
        return r;
      } catch (err) {
        const e =
          err instanceof ApiError
            ? { status: err.status, code: err.code, message: err.message, details: err.details }
            : { code: 'INTERNAL', message: 'quote failed' };
        if (n === seq.current) setError(e);
        throw err;
      } finally {
        if (n === seq.current) setPending(false);
      }
    },
    [api],
  );
  return { quote, result, pending, error };
}

export interface CustomerProfile {
  name: string;
  phone: string;
  address: {
    street: string;
    number: string;
    neighborhood: string;
    complement: string;
    /** Kernel 1.2 */
    cep?: string;
  };
}

const CUSTOMER_KEY = 'vendua.customer';
let customerMem: CustomerProfile | null | undefined;
const customerListeners = new Set<() => void>();

function readCustomer(): CustomerProfile | null {
  if (customerMem !== undefined) return customerMem;
  try {
    const raw = globalThis.localStorage?.getItem(CUSTOMER_KEY);
    const p = raw ? (JSON.parse(raw) as CustomerProfile) : null;
    customerMem = p && typeof p.name === 'string' && typeof p.phone === 'string' ? p : null;
  } catch {
    customerMem = null;
  }
  return customerMem;
}

/** Guest customer remembered on this device, only when they opt in at checkout
 *  (03 — storage only via Kernel session utilities). Phone-OTP accounts land
 *  with the merchant admin (Phase 3) behind this same hook. */
export function useCustomer(): {
  customer: CustomerProfile | null;
  status: 'guest' | 'remembered';
  remember: (p: CustomerProfile) => void;
  forget: () => void;
} {
  const customer = useSyncExternalStore(
    (fn) => {
      customerListeners.add(fn);
      return () => customerListeners.delete(fn);
    },
    readCustomer,
    () => null,
  );
  const remember = useCallback((p: CustomerProfile) => {
    const clean: CustomerProfile = {
      name: p.name.slice(0, 120),
      phone: digitsOf(p.phone).slice(0, 13),
      address: {
        street: p.address.street.slice(0, 120),
        number: p.address.number.slice(0, 10),
        neighborhood: p.address.neighborhood.slice(0, 80),
        complement: p.address.complement.slice(0, 80),
        ...(p.address.cep ? { cep: digitsOf(p.address.cep).slice(0, 8) } : {}),
      },
    };
    customerMem = clean;
    try {
      globalThis.localStorage?.setItem(CUSTOMER_KEY, JSON.stringify(clean));
    } catch {
      /* private mode — remembered for this page only */
    }
    customerListeners.forEach((fn) => fn());
  }, []);
  const forget = useCallback(() => {
    customerMem = null;
    try {
      globalThis.localStorage?.removeItem(CUSTOMER_KEY);
    } catch {
      /* nothing stored */
    }
    customerListeners.forEach((fn) => fn());
  }, []);
  return { customer, status: customer ? 'remembered' : 'guest', remember, forget };
}

/** Allow-listed custom events: `track('custom.<name>', props)`; no-ops without analytics consent. */
export function useAnalytics(): {
  track: (name: `custom.${string}`, props?: Record<string, unknown>) => boolean;
} {
  return useMemo(() => ({ track: (name, props) => trackCustom(name, props) }), []);
}

export function useConsent(): {
  consent: ConsentState | null;
  decide: (purposes: ConsentPurpose[]) => void;
} {
  const consent = useSyncExternalStore(onConsentChange, currentConsent, () => null);
  return { consent, decide: writeConsent };
}

/** Orders this browser placed (the Kernel keeps each order's tracking token). */
export function useOrderHistory(): {
  orders: Order[];
  loading: boolean;
  refetch: () => void;
} {
  const { api } = useKernel();
  const ids = api.orderIds().slice(0, 20);
  const q = useQuery(`orders:${ids.join(',')}`, async () => {
    const settled = await Promise.allSettled(ids.map((id) => api.order(id)));
    return settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  });
  return { orders: q.data ?? [], loading: q.loading, refetch: q.refetch };
}

function toQueryError(err: unknown, fallback: string): QueryError {
  return err instanceof ApiError
    ? { status: err.status, code: err.code, message: err.message, details: err.details }
    : { code: 'INTERNAL', message: fallback };
}

/** Kernel 1.2 — "sem senha, sem cadastro": a phone's orders across devices. The
 *  device that checked out with the phone is trusted already; any other proves it
 *  with one order number (`verify`). Summaries only — no addresses. */
export function useOrders(phone?: string): {
  orders: OrderSummary[];
  /** the phone the list belongs to (normalized), once known */
  phone: string | undefined;
  /** no proof for this phone on this device yet — call verify(orderNumber) */
  needsVerification: boolean;
  verify: (orderNumber: number, phoneOverride?: string) => Promise<void>;
  forget: () => void;
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
} {
  const { api } = useKernel();
  const [, bumpTick] = useState(0);
  const known = api.customerPhones();
  const target = phone ?? known[0];
  const key = `customer-orders:${target ?? ''}`;
  const q = useQuery(key, () =>
    target && known.includes(phoneKey(target)) ? api.customerOrders(target) : Promise.resolve(null),
  );
  const needsVerification =
    !q.loading && (q.data === null || q.error?.code === 'CUSTOMER_REQUIRED');
  const verify = useCallback(
    async (orderNumber: number, phoneOverride?: string) => {
      const p = phoneOverride ?? phone;
      if (!p) throw new ApiError(422, 'INVALID_CUSTOMER', 'phone is required');
      const verified = await api.verifyCustomer(p, orderNumber);
      invalidateQuery(`customer-orders:${phoneOverride ?? phone ?? ''}`);
      invalidateQuery(`customer-orders:${verified}`);
      invalidateQuery(`loyalty:${verified}`);
      bumpTick((t) => t + 1);
    },
    [api, phone],
  );
  const forget = useCallback(() => {
    api.forgetCustomer(target);
    invalidateQuery(key);
    bumpTick((t) => t + 1);
  }, [api, key, target]);
  return {
    orders: q.data?.orders ?? [],
    phone: q.data?.phone ?? target,
    needsVerification,
    verify,
    forget,
    loading: q.loading,
    error: q.error?.code === 'CUSTOMER_REQUIRED' ? undefined : q.error,
    refetch: q.refetch,
  };
}

/** Kernel 1.2 — the stamp card for a verified phone (see useOrders for verification). */
export function useLoyalty(phone?: string): {
  card: LoyaltyCard | null;
  needsVerification: boolean;
  loading: boolean;
  refetch: () => void;
} {
  const { api } = useKernel();
  const target = phone ?? api.customerPhones()[0];
  const q = useQuery(`loyalty:${target ?? ''}`, () =>
    target ? api.loyalty(target).catch(() => null) : Promise.resolve(null),
  );
  return {
    card: q.data?.loyalty ?? null,
    needsVerification: !q.loading && !q.data,
    loading: q.loading,
    refetch: q.refetch,
  };
}

/** Kernel 1.2 — CEP → street/bairro/cidade and the delivery zone, via Core. */
export function useCep(): {
  lookup: (cep: string) => Promise<CepResult | null>;
  result: CepResult | undefined;
  pending: boolean;
  error: QueryError | undefined;
} {
  const { api } = useKernel();
  const [result, setResult] = useState<CepResult>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<QueryError>();
  const seq = useRef(0);
  const lookup = useCallback(
    async (cep: string) => {
      if (!isValidCep(cep)) return null;
      const digits = digitsOf(cep);
      const n = ++seq.current;
      setPending(true);
      setError(undefined);
      try {
        const r = await api.cep(digits);
        if (n === seq.current) setResult(r);
        return r;
      } catch (err) {
        if (n === seq.current) setError(toQueryError(err, 'cep lookup failed'));
        return null;
      } finally {
        if (n === seq.current) setPending(false);
      }
    },
    [api],
  );
  return { lookup, result, pending, error };
}

/** Kernel 1.2 — join a sold-out product's restock waitlist. */
export function useWaitlist(productId: string | undefined): {
  join: (phone: string) => Promise<number>;
  /** how many wait, after joining */
  waiting: number | undefined;
  joined: boolean;
  pending: boolean;
  error: QueryError | undefined;
} {
  const { api } = useKernel();
  const [waiting, setWaiting] = useState<number>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<QueryError>();
  const join = useCallback(
    async (phone: string) => {
      if (!productId) throw new ApiError(422, 'INVALID_NOTIFY', 'no product');
      setPending(true);
      setError(undefined);
      try {
        const r = await api.waitlist(productId, phone);
        setWaiting(r.waiting);
        emit('notify_me', { subject: 'product', product_id: productId });
        return r.waiting;
      } catch (err) {
        setError(toQueryError(err, 'waitlist failed'));
        throw err;
      } finally {
        setPending(false);
      }
    },
    [api, productId],
  );
  return { join, waiting, joined: waiting !== undefined, pending, error };
}

// ── Kernel 1.14: the rules (`./rules`) bound to the store's live data ──────────────────────

const STORE_TIME_ZONE = 'America/Sao_Paulo';

/** A product card's state (sold out, all in the bag, low stock, quick add, badge) from Core's
 *  fields and the stock the cart leaves. */
export function useCardState(
  product: CardInput & { id: string; stockQuantity?: number | null },
): CardState {
  const left = useStockLeft(product);
  return cardState(product, left);
}

/** The catalog arranged for browsing: `query` searches (accents ignored), empty categories
 *  drop out, sold-out products sink within their category. */
export function useMenu(opts: { query?: string } = {}): {
  categories: CatalogCategory[];
  /** products shown */
  count: number;
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
} {
  const { categories, loading, error, refetch } = useCatalog();
  const query = opts.query ?? '';
  const arranged = useMemo(() => arrangeMenu(categories, { query }), [categories, query]);
  return {
    categories: arranged,
    count: arranged.reduce((n, c) => n + c.products.length, 0),
    loading,
    error,
    refetch,
  };
}

/** Open, closed or paused, with Core's `closesAt`/`resumesAt` as a line ("Aberto até 18:00",
 *  "Abre amanhã às 09:00") in the store's zone. Reads the store again when that moment passes. */
export function useStoreStatus(): {
  status: StoreProfile['status'] | undefined;
  closesAt: string | undefined;
  resumesAt: string | undefined;
  hint: StatusHint | null;
  label: string | null;
  timeZone: string;
  loading: boolean;
} {
  const { store, loading } = useStore();
  const timeZone = store?.hours.timezone || STORE_TIME_ZONE;
  const status = store?.status;
  const closesAt = store?.closesAt;
  const resumesAt = store?.resumesAt;
  const next = status === 'open' ? closesAt : resumesAt;
  useEffect(() => {
    const at = next ? Date.parse(next) : NaN;
    const wait = at - Date.now();
    if (!(wait > 0)) return;
    const t = setTimeout(
      () => invalidateMatching((key) => key === 'store'),
      Math.min(wait + 1000, 2 ** 31 - 1),
    );
    return () => clearTimeout(t);
  }, [next]);
  const hint = status ? statusHint({ status, closesAt, resumesAt }) : null;
  return {
    status,
    closesAt,
    resumesAt,
    hint,
    label: hint ? statusWords(hint, timeZone) : null,
    timeZone,
    loading,
  };
}

/** The weekly hours table (Monday first, folded) and today's hours, special days included. */
export function useStoreHours(): {
  rows: HoursRow[];
  today: TodayHours | null;
  timeZone: string;
} {
  const { store } = useStore();
  const hours = store?.hours;
  return useMemo(
    () => ({
      rows: hours ? hoursRows(hours) : [],
      today: hours ? todayHours(hours) : null,
      timeZone: hours?.timezone || STORE_TIME_ZONE,
    }),
    [hours],
  );
}

/** Delivery fee/ETA/minimum and pickup time, summed up from Core's zones. */
export function useDeliverySummary(): DeliverySummary & { loading: boolean } {
  const { store, loading } = useStore();
  const { zones, loading: zonesLoading } = useDeliveryZones();
  const summary = useMemo(
    () => (store ? deliverySummary(store, zones) : { delivery: null, pickup: null }),
    [store, zones],
  );
  return { ...summary, loading: loading || zonesLoading };
}

/** Cents → money in the store's currency. */
export function useMoney(): (cents: number) => string {
  const { store } = useStore();
  const currency = store?.currency ?? 'BRL';
  return useCallback((cents: number) => formatCents(cents, currency), [currency]);
}

/** The store's URLs: its routes, the catalog deep link, absolute links (the store's public URL,
 *  else this page's origin) and its WhatsApp/Instagram. */
export function useLinks(): {
  product: (slug: string) => string;
  catalog: string;
  anchor: (slug: string) => string;
  absolute: (path: string) => string;
  contacts: ContactLinks;
} {
  const { config } = useKernel();
  const { store } = useStore();
  const base = store?.publicUrl || globalThis.location?.origin || '';
  return useMemo(
    () => ({
      product: (slug: string) => productHref(config, slug),
      catalog: catalogHref(config),
      anchor: productAnchor,
      absolute: (path: string) => absoluteUrl(base, path),
      contacts: contactLinks(store),
    }),
    [config, base, store],
  );
}

/** The store's words (`store.vocabulary` over the defaults) and `{store}`/`{city}` filled in. */
export function useCopy(): { vocabulary: Vocabulary; interpolate: (text: string) => string } {
  const { store } = useStore();
  return useMemo(
    () => ({
      vocabulary: vocabularyOf(store),
      interpolate: (text: string) =>
        interpolate(text, { store: store?.name ?? '', city: store?.city ?? '' }),
    }),
    [store],
  );
}

/** Units in the open bag (Core's count; 0 with no open cart). */
export function useCartCount(): number {
  const { cart } = useCart();
  return cart?.status === 'open' ? cart.totals.itemCount : 0;
}

/** The bag's coupon: apply/remove through Core, with the messages in words. Never throws. */
export function useCoupon(): {
  coupon: CartCoupon | null;
  discountCents: number;
  apply: (code: string) => Promise<boolean>;
  remove: () => Promise<boolean>;
  pending: boolean;
  /** the last apply/remove failure, in words */
  message: string | null;
  /** its error code */
  error: string | null;
  /** why the coupon on the bag isn't discounting now, in words */
  reason: string | null;
} {
  const { cart, mutations } = useCart();
  const { store } = useStore();
  const currency = store?.currency ?? 'BRL';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ code: string; details?: Record<string, unknown> } | null>(
    null,
  );
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { code: err.code, ...(err.details ? { details: err.details } : {}) }
          : { code: 'INTERNAL' },
      );
      return false;
    } finally {
      setPending(false);
    }
  }, []);
  const apply = useCallback(
    (code: string) => {
      const c = code.trim().slice(0, 40);
      return c ? run(() => mutations.applyCoupon(c)) : Promise.resolve(false);
    },
    [mutations, run],
  );
  const remove = useCallback(() => run(() => mutations.removeCoupon()), [mutations, run]);
  const coupon = cart?.coupon ?? null;
  return {
    coupon,
    discountCents: cart?.totals.discountCents ?? 0,
    apply,
    remove,
    pending,
    message: error ? couponMessage(error.code, error.details, currency) : null,
    error: error?.code ?? null,
    reason:
      coupon && !coupon.applies && coupon.reason
        ? couponMessage(coupon.reason, coupon.details, currency)
        : null,
  };
}

/** Ask Core whether a code is valid for this bag, without applying it. */
export function useCouponCheck(): {
  check: (code: string) => Promise<CouponCheck | null>;
  result: CouponCheck | undefined;
  pending: boolean;
  /** why it isn't valid, in words */
  message: string | null;
  error: QueryError | undefined;
} {
  const { api } = useKernel();
  const { store } = useStore();
  const currency = store?.currency ?? 'BRL';
  const [result, setResult] = useState<CouponCheck>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<QueryError>();
  const seq = useRef(0);
  const check = useCallback(
    async (code: string) => {
      const c = code.trim().slice(0, 40);
      if (!c) return null;
      const n = ++seq.current;
      setPending(true);
      setError(undefined);
      try {
        const r = await api.validateCoupon(c);
        if (n === seq.current) setResult(r);
        return r;
      } catch (err) {
        if (n === seq.current) setError(toQueryError(err, 'coupon check failed'));
        return null;
      } finally {
        if (n === seq.current) setPending(false);
      }
    },
    [api],
  );
  const message =
    result && !result.valid
      ? couponMessage(result.reason ?? 'INVALID_COUPON', result.details, currency)
      : error
        ? couponMessage(error.code, error.details, currency)
        : null;
  return { check, result, pending, message, error };
}

const QUOTE_DEBOUNCE_MS = 150;

/** Core's price for a configured line (options, kit picks, quantity) before it's added — the
 *  same pricing as add-to-cart. Debounced; a newer configuration cancels the older request;
 *  `quote` keeps the last answer while the next is pending. A refusal (`MODIFIER_REQUIRED`,
 *  `SOLD_OUT`, …) is `error`, its code — never thrown. */
export function useLineQuote(
  product: { slug: string } | null | undefined,
  picks: LinePicks | null | undefined,
  qty: number,
): { quote: LineQuote | null; pending: boolean; error: string | null } {
  const { api } = useKernel();
  const key =
    product?.slug && Number.isInteger(qty) && qty >= 1
      ? JSON.stringify([
          product.slug,
          qty,
          (picks?.modifiers ?? []).map((m) => [m.id, m.qty ?? 1]),
          (picks?.comboSelections ?? []).map((c) => [c.slotId, c.productId, c.qty]),
        ])
      : null;
  const [state, setState] = useState<{
    key: string | null;
    quote: LineQuote | null;
    error: string | null;
  }>({ key: null, quote: null, error: null });
  useEffect(() => {
    if (!key) return;
    const [slug, n, mods, combo] = JSON.parse(key) as [
      string,
      number,
      [string, number][],
      [string, string, number][],
    ];
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api
        .quoteLine(
          slug,
          {
            qty: n,
            ...(mods.length ? { modifiers: mods.map(([id, q]) => ({ id, qty: q })) } : {}),
            ...(combo.length
              ? {
                  comboSelections: combo.map(([slotId, productId, q]) => ({
                    slotId,
                    productId,
                    qty: q,
                  })),
                }
              : {}),
          },
          ctrl.signal,
        )
        .then(
          (quote) => {
            if (!ctrl.signal.aborted) setState({ key, quote, error: null });
          },
          (err: unknown) => {
            if (ctrl.signal.aborted) return;
            setState({
              key,
              quote: null,
              error: err instanceof ApiError ? err.code : 'INTERNAL',
            });
          },
        );
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [api, key]);
  if (!key) return { quote: null, pending: false, error: null };
  const settled = state.key === key;
  return { quote: state.quote, pending: !settled, error: settled ? state.error : null };
}

/** A Pix's countdown on the shopper's clock ("29:41"); `expired` once it passes. */
export function usePixTimer(expiresAt: string | null | undefined): {
  expired: boolean;
  msLeft: number | null;
  label: string | null;
} {
  const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(deadline)) return;
    setNow(Date.now());
    if (Date.now() >= deadline) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= deadline) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [deadline]);
  if (!Number.isFinite(deadline)) return { expired: false, msLeft: null, label: null };
  const msLeft = Math.max(0, deadline - now);
  return { expired: msLeft === 0, msLeft, label: countdown(deadline, now) };
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const motionQuery = () =>
  typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(REDUCED_MOTION) : null;

/** The shopper asked for less motion (live: follows the system setting). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = motionQuery();
      mq?.addEventListener?.('change', fn);
      return () => mq?.removeEventListener?.('change', fn);
    },
    () => motionQuery()?.matches ?? false,
    () => false,
  );
}

/** Which of `ids` (element ids, in page order) is being read: the first one inside the band
 *  below `offset` px (a sticky header) and above the lower 60% of the viewport. Keeps the last
 *  answer while none is; null before any. */
export function useScrollSpy(
  ids: readonly string[],
  opts: { offset?: number; rootMargin?: string } = {},
): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('\n');
  const rootMargin = opts.rootMargin ?? `-${Math.max(0, opts.offset ?? 0)}px 0px -60% 0px`;
  useEffect(() => {
    const list = key ? key.split('\n') : [];
    const doc = globalThis.document;
    if (typeof globalThis.IntersectionObserver !== 'function' || !doc || list.length === 0) return;
    const inside = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) inside.set(e.target.id, e.isIntersecting);
        const first = list.find((id) => inside.get(id));
        if (first) setActive(first);
      },
      { rootMargin, threshold: 0 },
    );
    for (const id of list) {
      const el = doc.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [key, rootMargin]);
  return active !== null && ids.includes(active) ? active : null;
}
