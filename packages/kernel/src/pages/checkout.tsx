import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  sameAddress,
  savedAddresses,
  useCart,
  useCep,
  useCheckout,
  useCopy,
  useCoupon,
  useCustomer,
  useDeliveryQuote,
  useDeliverySummary,
  useDeliveryZones,
  useStore,
  useStoreStatus,
  type CustomerProfile,
} from '../hooks.ts';
import { useNavigateTo } from '../primitives.tsx';
import { closedNote } from './closed.ts';
import { Slot } from '../slot.tsx';
import { errorCopy, errorCode } from '../errors.ts';
import { emit } from '../telemetry.ts';
import { useKernel } from '../provider.tsx';
import { resolvePaths } from '../config.ts';
import type {
  CheckoutStep,
  CustomerDraft,
  DeliveryOption,
  PaymentMethod,
  SlotProps,
} from '../slot-props.ts';

type SlotPropsOf<K extends keyof SlotProps> = SlotProps[K];
import type { CartTotals, GeoPoint, LatLng, PaymentAdjustment, QuoteResult } from '../api.ts';
import { deliveryWords } from '../rules/delivery.ts';
import { changeMessage, couponMessage, isCouponError } from '../rules/errors.ts';
import { formatCents, LOCALE } from '../rules/format.ts';
import {
  adjustmentKind,
  adjustmentShort,
  PAYMENT_METHOD_DETAIL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHOD_ORDER,
} from '../rules/orders.ts';
import { digitsOf, isValidCep, isValidPhone } from '../rules/phone.ts';
import { usePageTitle } from '../head.ts';
import { preloadMpDevice } from '../mp-device.ts';
import { currentTable, setTable, tableName, useTableSession } from '../table.ts';
import { showInfo } from '../errors.ts';

// /checkout — the Kernel-owned checkout (ADR 0004): a three-step machine
// (dados → entrega → pagamento). Validation here is shape-only; every business
// rule (zone, minimum, pause) is Core's answer, surfaced as-is. Each step is a history entry
// (state.vStep), so the back button/gesture returns to the previous step, not out of checkout.

type StepId = CheckoutStep['id'];
const ORDER: StepId[] = ['dados', 'entrega', 'pagamento'];
const LABEL: Record<StepId, string> = {
  dados: 'Seus dados',
  entrega: 'Entrega',
  pagamento: 'Pagamento',
};

const METHODS: PaymentMethod[] = PAYMENT_METHOD_ORDER.map((id) => ({
  id,
  label: PAYMENT_METHOD_LABEL[id] ?? id,
  ...(PAYMENT_METHOD_DETAIL[id] ? { detail: PAYMENT_METHOD_DETAIL[id] } : {}),
}));
// what a Core without `paymentMethods` (pre-1.4) accepts — never the online card
const LEGACY_METHODS = ['pix', 'card_on_delivery', 'cash'];

const NOTES_MAX = 500;

// at a table the store's status reads differently: no encomenda, no delivery to fall back on
const TABLE_COPY: Record<string, { title: string; body?: string }> = {
  STORE_CLOSED: {
    title: 'A loja está fechada agora',
    body: 'Os pedidos pela mesa voltam quando ela abrir.',
  },
  STORE_PAUSED: { title: 'A loja pausou os pedidos', body: 'Tente de novo em instantes.' },
};

/** The store's rule as a label ("−5%", "+R$ 1,50") — the cents are Core's, in the totals. */
function adjustmentLabel(a: PaymentAdjustment, currency: string): PaymentMethod['adjustment'] {
  const kind = adjustmentKind(a);
  const label = adjustmentShort(a, currency);
  return kind && label ? { label, kind } : undefined;
}

type PinStatus = SlotPropsOf<'checkout.LocationPicker'>['status'];

const savedPin = (a: { lat?: number; lng?: number } | undefined): LatLng | null =>
  typeof a?.lat === 'number' && typeof a.lng === 'number' ? { lat: a.lat, lng: a.lng } : null;

// Kernel 1.21 — the answers typed so far survive a reload of this tab (not a new tab, not the
// next order): sessionStorage, bound to the cart session they were typed for, cleared once the
// order is placed.
const DRAFT_KEY = 'vendua.checkoutDraft';
const METHOD_IDS: readonly string[] = [...PAYMENT_METHOD_ORDER, 'tab'];

interface SavedDraft {
  session: string;
  draft: CustomerDraft;
  mode: 'pickup' | 'delivery';
  pay: PaymentMethod['id'];
  notes: string;
  scheduledFor: string | null;
  changeFor: number | null;
  coords: LatLng | null;
  done: StepId[];
  /** Kernel 1.21 — the phone the bag reminder was asked for (null = not asked) */
  reminder?: string | null;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function readDraft(session: string | null): SavedDraft | null {
  if (!session) return null;
  try {
    const d = JSON.parse(globalThis.sessionStorage?.getItem(DRAFT_KEY) ?? 'null') as Partial<
      Record<keyof SavedDraft, unknown>
    > | null;
    if (!d || d.session !== session || !d.draft || typeof d.draft !== 'object') return null;
    const v = d.draft as Partial<Record<keyof CustomerDraft, unknown>>;
    return {
      session,
      draft: {
        name: text(v.name, 120),
        phone: text(v.phone, 20),
        street: text(v.street, 120),
        number: text(v.number, 10),
        neighborhood: text(v.neighborhood, 80),
        complement: text(v.complement, 80),
        cep: text(v.cep, 9),
        reference: text(v.reference, 120),
        remember: v.remember !== false,
      },
      mode: d.mode === 'pickup' ? 'pickup' : 'delivery',
      pay: (METHOD_IDS.includes(d.pay as string) ? d.pay : 'pix') as PaymentMethod['id'],
      notes: text(d.notes, NOTES_MAX),
      scheduledFor:
        typeof d.scheduledFor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.scheduledFor)
          ? d.scheduledFor
          : null,
      changeFor:
        typeof d.changeFor === 'number' && Number.isSafeInteger(d.changeFor) && d.changeFor > 0
          ? d.changeFor
          : null,
      coords: savedPin(d.coords as { lat?: number; lng?: number } | undefined),
      done: Array.isArray(d.done) ? ORDER.filter((s) => (d.done as unknown[]).includes(s)) : [],
      reminder: typeof d.reminder === 'string' ? text(d.reminder, 20) : null,
    };
  } catch {
    return null;
  }
}

function writeDraft(d: SavedDraft) {
  try {
    globalThis.sessionStorage?.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* storage blocked — a reload starts over, as before */
  }
}

function clearDraft() {
  try {
    globalThis.sessionStorage?.removeItem(DRAFT_KEY);
  } catch {
    /* nothing stored */
  }
}

type Address = CustomerProfile['address'];

const addressOf = (d: CustomerDraft): Address => ({
  street: d.street,
  number: d.number,
  neighborhood: d.neighborhood,
  complement: d.complement,
});

function addressLabel(a: Address): { label: string; detail?: string } {
  const detail = [a.complement, a.reference]
    .map((x) => x?.trim())
    .filter(Boolean)
    .join(' · ');
  return {
    label: `${a.street}${a.number ? `, ${a.number}` : ''}${a.neighborhood ? ` — ${a.neighborhood}` : ''}`,
    ...(detail ? { detail } : {}),
  };
}

// Kernel 1.22 — at a table Core takes only the name (2..80), no phone
const NAME_MAX = 80;

function validate(step: StepId, d: CustomerDraft, mode: DeliveryOption['mode'], located = false) {
  const e: Partial<Record<keyof CustomerDraft, string>> = {};
  if (step === 'dados') {
    if (d.name.trim().length < 2) e.name = 'Informe seu nome.';
    else if (mode === 'dine_in' && d.name.trim().length > NAME_MAX)
      e.name = `Use até ${NAME_MAX} letras.`;
    if (mode !== 'dine_in' && !isValidPhone(d.phone)) e.phone = 'Informe um WhatsApp com DDD.';
  }
  if (step === 'entrega' && mode === 'delivery') {
    // a device location resolves the zone by distance — the bairro is then optional
    if (!d.neighborhood.trim() && !located) e.neighborhood = 'Informe o bairro.';
    if (!d.street.trim()) e.street = 'Informe a rua.';
    if (!d.number.trim()) e.number = 'Informe o número.';
  }
  return e;
}

export function CheckoutPage() {
  const { cart, loading, mutations } = useCart();
  const { store } = useStore();
  // re-reads the store when it opens or closes, so the closed note comes and goes by itself
  useStoreStatus();
  const { zones } = useDeliveryZones();
  const cepLookup = useCep();
  const quote = useDeliveryQuote();
  const { submit, pending, error, reset } = useCheckout();
  const { customer, remember, forget } = useCustomer();
  const { config, api } = useKernel();
  const go = useNavigateTo();
  const paths = resolvePaths(config);
  const currency = store?.currency ?? 'BRL';
  const money = (cents: number) => formatCents(cents, currency);
  const { vocabulary } = useCopy();
  const summary = useDeliverySummary();
  const coupon = useCoupon();
  usePageTitle('Finalizar pedido');
  // Kernel 1.22 (ADR 0036): opened from a table's QR code, at a store taking table orders
  const table = useTableSession();
  const atTable = !!table && store?.dineIn?.enabled === true;
  const tableOff = !!table && !!store && store.dineIn?.enabled !== true;

  const location = useLocation();
  const navigate = useNavigate();
  const nav = location.state as { vStep?: unknown; vFrom?: unknown } | null;
  const lastStep = useRef<StepId | null>(null);
  // a state-less entry that only adds a hash (the header's skip link) stays on its step
  const hashOnly = !nav?.vStep && location.hash !== '' && lastStep.current !== null;
  const asked = ORDER.find((s) => s === nav?.vStep) ?? (hashOnly ? lastStep.current! : 'dados');
  const [done, setDone] = useState<Set<StepId>>(
    () => new Set(readDraft(api.sessionToken)?.done ?? []),
  );
  // a reload keeps the entry; without this tab's answers (another tab, an order placed since)
  // it starts over from the first step
  const reachable = ORDER.slice(0, ORDER.indexOf(asked)).every((s) => done.has(s));
  const step: StepId = reachable ? asked : 'dados';
  lastStep.current = step;
  const keyNow = useRef(location.key);
  keyNow.current = location.key;
  const stepHeading = useRef<HTMLHeadingElement>(null);
  // which way the last step change went: the new step's form slides in from that side
  const prevStep = useRef(step);
  const stepDir = useRef<'push' | 'pop' | undefined>(undefined);
  if (prevStep.current !== step) {
    stepDir.current = ORDER.indexOf(step) > ORDER.indexOf(prevStep.current) ? 'push' : 'pop';
    prevStep.current = step;
  }
  const pushedStep = useRef(false);
  const firstStep = useRef(true);
  // what this tab typed before a reload (the same cart), else the device's remembered profile
  const [restored] = useState(() => readDraft(api.sessionToken));
  const placed = useRef(false);
  const [draft, setDraft] = useState<CustomerDraft>(
    () =>
      restored?.draft ?? {
        name: customer?.name ?? '',
        phone: customer?.phone ?? '',
        street: customer?.address.street ?? '',
        number: customer?.address.number ?? '',
        neighborhood: customer?.address.neighborhood ?? '',
        complement: customer?.address.complement ?? '',
        cep: customer?.address.cep ?? '',
        reference: customer?.address.reference ?? '',
        remember: true,
      },
  );
  // a pin the shopper confirmed (on this device's remembered address, or on the map)
  const [coords, setCoords] = useState<LatLng | null>(() =>
    restored ? restored.coords : savedPin(customer?.address),
  );
  const [locateStatus, setLocateStatus] = useState<
    'idle' | 'pending' | 'located' | 'denied' | 'out_of_zone'
  >('idle');
  const [zoneHint, setZoneHint] = useState<string | undefined>();
  const [notes, setNotes] = useState(() => restored?.notes ?? '');
  const [scheduledFor, setScheduledFor] = useState<string | undefined>(
    () => restored?.scheduledFor ?? undefined,
  );
  const [scheduleError, setScheduleError] = useState<string | undefined>();
  // a coupon Core refused at submit (the field shows it like an apply failure)
  const [couponError, setCouponError] = useState<string | undefined>();
  const deliveryOk = store?.deliveryEnabled !== false;
  const pickupOk = store?.pickupEnabled !== false;
  // Kernel 1.15 (ADR 0024): Core prices the confirmed pin by road distance
  const byDistance = deliveryOk ? (store?.distancePricing ?? null) : null;
  // where the pin map is centred — the typed address once Core placed it
  const [mapAt, setMapAt] = useState<{ center: LatLng; precision: GeoPoint['precision'] } | null>(
    null,
  );
  const [pinStatus, setPinStatus] = useState<PinStatus>(() =>
    (restored ? restored.coords : savedPin(customer?.address)) ? 'confirmed' : 'idle',
  );
  const [pinHint, setPinHint] = useState<string | undefined>();
  const [pinError, setPinError] = useState<string | undefined>();
  const [deviceLocate, setDeviceLocate] = useState<'idle' | 'pending' | 'denied'>('idle');
  // the CEP's city/state, for placing the typed address
  const [cepPlace, setCepPlace] = useState<{ city: string | null; state: string | null } | null>(
    null,
  );
  const [mode, setMode] = useState<'pickup' | 'delivery'>(() =>
    restored && (restored.mode === 'pickup' || deliveryOk)
      ? restored.mode
      : deliveryOk
        ? 'delivery'
        : 'pickup',
  );
  const deliveryMode: DeliveryOption['mode'] = atTable ? 'dine_in' : mode;
  // chosen before the store was read: a pickup-only store starts on Retirada once it is
  useEffect(() => {
    if (!deliveryOk && mode === 'delivery') setMode('pickup');
  }, [deliveryOk, mode]);
  const [pay, setPay] = useState<PaymentMethod['id']>(
    () => restored?.pay ?? (currentTable() ? 'tab' : 'pix'),
  );
  // Kernel 1.17 — cash change in cents (null = none); Core checks it covers the total
  const [changeFor, setChangeFor] = useState<number | null>(() => restored?.changeFor ?? null);
  const [changeError, setChangeError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerDraft, string>>>({});
  const [deliveryIssue, setDeliveryIssue] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const submitting = useRef(false);
  const stepStarted = useRef(Date.now());
  // Kernel 1.21 — "me lembre pelo WhatsApp": the phone Core holds the consent for (null = none)
  const [reminder, setReminder] = useState<string | null>(() => restored?.reminder ?? null);
  const reminderOffered = !!store?.cartReminder && !atTable && isValidPhone(draft.phone);
  const askReminder = async (on: boolean) => {
    const phone = draft.phone;
    setReminder(on ? phone : null);
    try {
      const r = on
        ? await api.cartReminder({ phone, ...(draft.name.trim() ? { name: draft.name } : {}) })
        : await api.cancelCartReminder();
      if (!r.on) setReminder(null);
    } catch {
      // quiet: the box unticks, the order goes on
      setReminder(null);
    }
  };
  // the number fixed after ticking: the reminder follows it
  useEffect(() => {
    if (!reminder || !reminderOffered || digitsOf(reminder) === digitsOf(draft.phone)) return;
    const t = setTimeout(() => void askReminder(true), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.phone, reminder, reminderOffered]);

  useEffect(() => {
    emit('checkout_step', { step, duration_ms: Date.now() - stepStarted.current });
    stepStarted.current = Date.now();
  }, [step]);

  // keep the answers for a reload; never once the order is placed (the session moved on)
  useEffect(() => {
    const session = api.sessionToken;
    if (placed.current || !session) return;
    writeDraft({
      session,
      draft,
      mode,
      pay,
      notes,
      scheduledFor: scheduledFor ?? null,
      changeFor,
      coords,
      done: [...done],
      reminder,
    });
  }, [api, draft, mode, pay, notes, scheduledFor, changeFor, coords, done, reminder]);

  // step entries that can't be shown are skipped, never rewritten into copies of the first
  // step: a reload mid-checkout lands on the first step's entry; with the order placed (no
  // open cart), back leaves checkout in one press
  const closed = !loading && (!cart || cart.status !== 'open' || cart.items.length === 0);
  const skipped = useRef<string | null>(null);
  useEffect(() => {
    if (skipped.current === location.key) return;
    if (hashOnly) {
      navigate(location, { replace: true, state: { vStep: asked, vStepN: ORDER.indexOf(asked) } });
      return;
    }
    if (submitting.current || loading) return;
    const n = ORDER.indexOf(asked);
    const back = closed && n > 0 ? n + 1 : reachable ? 0 : n;
    if (!back) return;
    skipped.current = location.key;
    const idx = (globalThis.history?.state as { idx?: unknown } | null)?.idx;
    if (typeof idx !== 'number' || idx >= back) navigate(-back);
    else navigate({ pathname: location.pathname, search: location.search }, { replace: true });
  });

  // a new step starts at its top with focus on its heading; back/forward lets the scroll
  // manager put the page where it was
  useLayoutEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    if (pushedStep.current) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    pushedStep.current = false;
    stepHeading.current?.focus({ preventScroll: true });
  }, [step]);

  // a step change lands a frame later (it's a view transition): a second tap meanwhile is ignored
  const stepping = useRef(false);
  useLayoutEffect(() => {
    stepping.current = false;
  }, [location.key]);
  const setStep = (next: StepId) => {
    if (next === step || stepping.current) return;
    stepping.current = true;
    if (nav?.vFrom === next) return navigate(-1);
    pushedStep.current = true;
    navigate(
      { pathname: location.pathname, search: location.search },
      { state: { vStep: next, vStepN: ORDER.indexOf(next), vFrom: step } },
    );
  };

  const neighborhoods = useMemo(() => zones.flatMap((z) => z.neighborhoods), [zones]);
  // distance-priced and drawn (polygon) zones both resolve from the shopper's location
  const canLocate =
    typeof navigator !== 'undefined' &&
    'geolocation' in navigator &&
    zones.some((z) => z.kind === 'radius' || z.kind === 'polygon');
  const schedule = cart?.schedule;
  const encomenda = schedule?.required === true;
  const closedNow =
    cart?.status !== 'open'
      ? null
      : atTable
        ? store?.status === 'closed'
          ? 'A loja está fechada agora. Os pedidos pela mesa voltam quando ela abrir.'
          : store?.status === 'paused'
            ? 'A loja pausou os pedidos por alguns instantes. Tente de novo daqui a pouco.'
            : null
        : closedNote(store, cart.items, vocabulary.bag);
  // a table has no encomenda: Core takes no date there
  const allowed = encomenda && !atTable ? schedule!.paymentMethods.join(',') : '';
  // the store's own list (Kernel 1.4); absent on an older Core = the three offline ones
  const accepted = store?.paymentMethods?.join(',') ?? '';
  const online = store?.onlinePayments;
  const pixOnline = online?.pix === true;
  const cardOnline = online?.card !== false;
  const adjustments = store?.paymentAdjustments;
  const byStore = useMemo(
    () =>
      METHODS.filter((m) => (accepted ? accepted.split(',') : LEGACY_METHODS).includes(m.id))
        .filter((m) => m.id !== 'card_online' || cardOnline)
        .map((m) =>
          m.id === 'pix' && pixOnline
            ? { ...m, detail: 'QR Code na próxima tela · confirma na hora' }
            : m,
        )
        .map((m) => {
          const adjustment = adjustments?.[m.id] && adjustmentLabel(adjustments[m.id]!, currency);
          return adjustment ? { ...m, adjustment } : m;
        }),
    [accepted, cardOnline, pixOnline, adjustments, currency],
  );
  // at a table: "Pagar na mesa" (the comanda) and only the methods paid online right now
  const cardPaidOnline = online?.card === true;
  const tableMethods = useMemo<PaymentMethod[]>(() => {
    const tab = adjustments?.tab && adjustmentLabel(adjustments.tab, currency);
    return [
      {
        id: 'tab',
        label: PAYMENT_METHOD_LABEL.tab ?? 'Pagar na mesa',
        ...(PAYMENT_METHOD_DETAIL.tab ? { detail: PAYMENT_METHOD_DETAIL.tab } : {}),
        ...(tab ? { adjustment: tab } : {}),
      },
      ...byStore.filter(
        (m) => (m.id === 'pix' && pixOnline) || (m.id === 'card_online' && cardPaidOnline),
      ),
    ];
  }, [byStore, pixOnline, cardPaidOnline, adjustments, currency]);
  const methods = useMemo(
    () =>
      atTable
        ? tableMethods
        : allowed
          ? byStore.filter((m) => allowed.split(',').includes(m.id))
          : byStore,
    [atTable, tableMethods, allowed, byStore],
  );
  // the online Pix's device fingerprint starts loading here, so the order page rarely waits
  useEffect(() => {
    if (step === 'pagamento' && pay === 'pix' && pixOnline) preloadMpDevice();
  }, [step, pay, pixOnline]);
  // an encomenda narrows payment (Pix-only in the reference) — keep the choice valid; not before
  // the store is read (a table's "Pagar na mesa" isn't offered until then)
  const storeRead = !!store;
  useEffect(() => {
    if (storeRead && methods.length && !methods.some((m) => m.id === pay)) setPay(methods[0]!.id);
  }, [storeRead, methods, pay]);
  // Kernel 1.12: on the payment step Core prices the chosen method's discount/surcharge into
  // the cart's totals (`GET /cart?paymentMethod=`); the page never adds it up itself. The key
  // ties an answer to the cart it priced, so a coupon or a delivery change asks again.
  const [priced, setPriced] = useState<{ key: string; totals: CartTotals } | null>(null);
  const [priceFailed, setPriceFailed] = useState('');
  const [priceTry, setPriceTry] = useState(0);
  const t = cart?.status === 'open' ? cart.totals : null;
  const priceKey = t
    ? [pay, t.subtotalCents, t.deliveryFeeCents, t.discountCents ?? 0, t.totalCents].join('|')
    : '';
  const pricesByMethod = adjustments !== undefined && step === 'pagamento' && priceKey !== '';
  useEffect(() => {
    if (!pricesByMethod) return;
    let live = true;
    api.cart(pay).then(
      (r) => {
        if (live && r.cart.status === 'open') setPriced({ key: priceKey, totals: r.cart.totals });
      },
      () => {
        if (live) setPriceFailed(priceKey);
      },
    );
    return () => {
      live = false;
    };
  }, [pricesByMethod, priceKey, pay, api, priceTry]);
  const pricedTotals = pricesByMethod && priced?.key === priceKey ? priced.totals : null;
  // a method with a rule shows no total until Core priced it
  const pricing = pricesByMethod && !pricedTotals && !!adjustments?.[pay];
  const priceError = pricing && priceFailed === priceKey;
  const payLabel = methods.find((m) => m.id === pay)?.label;
  // "a partir de R$ 5,00", "grátis" — the least a zone charges (a per-km zone is never free)
  const feeWords = deliveryWords(summary, currency)?.fee.replace(/^entrega /, '');
  const deliveryDetail = byDistance
    ? byDistance.fromFeeCents > 0
      ? `a partir de ${money(byDistance.fromFeeCents)}`
      : 'calculada pela distância'
    : feeWords;
  const options: DeliveryOption[] = atTable
    ? [
        {
          mode: 'dine_in',
          label: `Na ${tableName(table!.label)}`,
          detail: 'A equipe confirma o pedido e traz até a mesa',
        },
      ]
    : [
        {
          mode: 'delivery',
          label: 'Entrega',
          ...(deliveryDetail ? { detail: deliveryDetail } : {}),
          disabled: !deliveryOk,
        },
        {
          mode: 'pickup',
          label: 'Retirada',
          detail: store?.pickup?.address ?? store?.address ?? 'na loja',
          ...(store?.pickup?.instructions ? { note: store.pickup.instructions } : {}),
          disabled: !pickupOk,
        },
      ];

  // ── the delivery pin (Kernel 1.15, ADR 0024) ───────────────────────────────
  const pinWanted = !!byDistance && step === 'entrega' && deliveryMode === 'delivery';
  const canGeolocate = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const pinWords = (r: QuoteResult) => {
    // with the cart session Core's totals carry the fee after any free-delivery threshold
    const fee = r.totals?.deliveryFeeCents ?? r.feeCents ?? 0;
    return [
      r.distanceKm != null
        ? `${r.distanceSource === 'estimate' ? 'cerca de ' : ''}${r.distanceKm.toLocaleString(LOCALE)} km`
        : null,
      fee > 0 ? `entrega ${money(fee)}` : 'entrega grátis',
      r.etaMin != null ? `${r.etaMin}–${r.etaMax} min` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  };
  const confirmPin = async (c: LatLng) => {
    const at = { lat: Math.round(c.lat * 1e5) / 1e5, lng: Math.round(c.lng * 1e5) / 1e5 };
    setPinError(undefined);
    setPinStatus('quoting');
    try {
      const r = await quote.quote({ ...at, paymentMethod: pay });
      if (!r.eligible) {
        setCoords(null);
        setPinHint(undefined);
        setPinStatus('out_of_zone');
        return;
      }
      setCoords(at);
      setMapAt({ center: at, precision: 'address' });
      setPinHint(pinWords(r));
      setPinStatus('confirmed');
    } catch {
      setPinStatus('error');
    }
  };
  const locateDevice = () => {
    setDeviceLocate('pending');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDeviceLocate('idle');
        setMapAt({
          center: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          precision: 'address',
        });
      },
      () => setDeviceLocate('denied'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  // place the typed address on the map (Core asks the geocoder); the shopper confirms the door
  const street = draft.street.trim();
  const number = draft.number.trim();
  const cepDigits = isValidCep(draft.cep) ? digitsOf(draft.cep) : '';
  const city = cepPlace?.city ?? store?.city ?? '';
  const uf = cepPlace?.state ?? '';
  const pinned = coords !== null;
  useEffect(() => {
    if (!pinWanted || pinned || (!(street && number) && !cepDigits)) return;
    let live = true;
    const t = setTimeout(() => {
      setPinStatus('finding');
      const settle = () => {
        if (live) setPinStatus((s) => (s === 'finding' ? 'idle' : s));
      };
      api
        .geocode({
          ...(street ? { street } : {}),
          ...(number ? { number } : {}),
          ...(cepDigits ? { cep: cepDigits } : {}),
          ...(city ? { city } : {}),
          ...(uf ? { state: uf } : {}),
        })
        .then((r) => {
          if (live && r.point)
            setMapAt({
              center: { lat: r.point.lat, lng: r.point.lng },
              precision: r.point.precision,
            });
          settle();
        }, settle);
    }, 700);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [pinWanted, pinned, street, number, cepDigits, city, uf, api]);
  // a remembered pin: Core prices it again (the store's prices may have changed)
  useEffect(() => {
    if (pinWanted && coords && !pinHint && pinStatus === 'confirmed') void confirmPin(coords);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinWanted, coords, pinHint, pinStatus]);

  if (loading && !cart)
    return (
      <main
        id="main"
        className="v-page"
        data-vendua-page="checkout"
        aria-busy="true"
        aria-label="Carregando checkout"
      />
    );
  if (!cart || cart.status !== 'open' || cart.items.length === 0)
    return (
      <main id="main" className="v-page" data-vendua-page="checkout">
        <Slot
          name="checkout.EmptyCart"
          vocabulary={vocabulary}
          onBrowse={() => go(paths.catalog)}
        />
      </main>
    );

  const patch = (p: Partial<CustomerDraft>) => {
    // a new street, number or CEP is a new door: the confirmed pin no longer stands
    if (coords && byDistance && ('street' in p || 'number' in p || 'cep' in p)) {
      setCoords(null);
      setPinHint(undefined);
      setPinStatus('idle');
    }
    setDraft((d) => ({ ...d, ...p }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(p)) delete next[k as keyof CustomerDraft];
      return next;
    });
  };

  // Kernel 1.21 — up to three addresses this device remembers (only when the shopper opted in)
  const saved = savedAddresses(customer);
  const typed = addressOf(draft);
  const savedIndex = saved.findIndex(
    (a) => sameAddress(a, typed) && a.neighborhood.trim() === typed.neighborhood.trim(),
  );
  const pickAddress = (id: string | null) => {
    const a = id === null ? null : saved[Number(id)];
    if (id !== null && !a) return;
    const pin = a ? savedPin(a) : null;
    setDraft((d) => ({
      ...d,
      street: a?.street ?? '',
      number: a?.number ?? '',
      neighborhood: a?.neighborhood ?? '',
      complement: a?.complement ?? '',
      cep: a?.cep ?? '',
      reference: a?.reference ?? '',
    }));
    setErrors({});
    setZoneHint(undefined);
    setCepPlace(null);
    setLocateStatus('idle');
    setCoords(pin);
    setPinHint(undefined);
    setPinError(undefined);
    setPinStatus(pin ? 'confirmed' : 'idle');
  };

  const onCep = async (cep: string) => {
    const r = await cepLookup.lookup(cep);
    if (!r) return;
    const a = r.address;
    setCepPlace({ city: a.city, state: a.state });
    // under distance pricing the pin, not the bairro, decides the fee
    if (byDistance) {
      setDraft((d) => ({
        ...d,
        street: d.street.trim() ? d.street : (a.street ?? ''),
        neighborhood: d.neighborhood.trim() ? d.neighborhood : (a.neighborhood ?? ''),
      }));
      return;
    }
    setDraft((d) => ({
      ...d,
      street: d.street.trim() ? d.street : (a.street ?? ''),
      neighborhood: d.neighborhood.trim() ? d.neighborhood : (a.neighborhood ?? ''),
    }));
    setZoneHint(
      r.zone.eligible
        ? `Entrega para ${a.neighborhood ?? 'esse CEP'}: ${
            (r.zone.feeCents ?? 0) > 0 ? money(r.zone.feeCents!) : 'grátis'
          }${r.zone.etaMin != null ? ` · ${r.zone.etaMin}–${r.zone.etaMax} min` : ''}`
        : `${a.neighborhood ?? 'Esse CEP'} fica fora da área de entrega${pickupOk ? ' — retirada continua disponível' : ''}.`,
    );
  };

  const onLocate = () => {
    setLocateStatus('pending');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const c = {
          lat: Math.round(pos.coords.latitude * 1e5) / 1e5,
          lng: Math.round(pos.coords.longitude * 1e5) / 1e5,
        };
        try {
          const r = await quote.quote(c);
          if (!r.eligible) {
            setCoords(null);
            setLocateStatus('out_of_zone');
            return;
          }
          setCoords(c);
          setLocateStatus('located');
          setZoneHint(
            `Entrega${r.distanceKm != null ? ` a ${r.distanceKm.toLocaleString(LOCALE)} km` : ''}: ${
              (r.feeCents ?? 0) > 0 ? money(r.feeCents!) : 'grátis'
            }`,
          );
        } catch {
          setLocateStatus('idle');
        }
      },
      () => setLocateStatus('denied'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const deliveryPayload = () =>
    deliveryMode !== 'delivery'
      ? { mode: deliveryMode }
      : {
          mode,
          ...(draft.neighborhood.trim() ? { neighborhood: draft.neighborhood.trim() } : {}),
          street: draft.street.trim(),
          number: draft.number.trim(),
          ...(draft.complement.trim() ? { complement: draft.complement.trim() } : {}),
          ...(draft.reference?.trim() ? { reference: draft.reference.trim() } : {}),
          ...(isValidCep(draft.cep) ? { cep: digitsOf(draft.cep) } : {}),
          ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
        };

  const applyCoupon = (code: string) => {
    setCouponError(undefined);
    void coupon.apply(code);
  };
  const removeCoupon = () => {
    setCouponError(undefined);
    void coupon.remove();
  };

  // "não estou na mesa" (or a QR Core no longer honours): back to delivery and pickup, from
  // the first step when the phone (not asked at the table) is still missing
  const leaveTable = () => {
    setTable(null);
    setDone(new Set<StepId>(isValidPhone(draft.phone) ? ['dados'] : []));
    setErrors({});
    reset();
  };

  const advance = async () => {
    const e = validate(step, draft, deliveryMode, coords !== null);
    setErrors(e);
    const needPin = step === 'entrega' && deliveryMode === 'delivery' && !!byDistance && !coords;
    if (needPin)
      setPinError(
        pinStatus === 'out_of_zone'
          ? 'Esse local fica fora da área de entrega.'
          : 'Confirme no mapa onde entregar.',
      );
    if (Object.keys(e).length || needPin) return;
    if (step === 'entrega') {
      // sync the server cart so fee/min-order land in Core's totals; a zone problem
      // is shown but doesn't trap the customer — submit gets Core's final answer
      setSyncing(true);
      setDeliveryIssue(null);
      const at = keyNow.current;
      try {
        await mutations.setDelivery(deliveryPayload());
      } catch (err) {
        setDeliveryIssue(errorCopy(errorCode(err)).title);
      } finally {
        setSyncing(false);
      }
      // the shopper went back (or forward) while it synced: don't pull them on
      if (keyNow.current !== at) return;
    }
    // committed before the push, so the next step is already reachable when it renders
    flushSync(() => setDone((d) => new Set(d).add(step)));
    setStep(ORDER[ORDER.indexOf(step) + 1] ?? step);
  };

  const place = async () => {
    if (submitting.current || pending || closedNow) return;
    if (encomenda && !atTable && !scheduledFor) {
      setScheduleError('Escolha a data da encomenda.');
      return;
    }
    submitting.current = true;
    reset();
    setScheduleError(undefined);
    try {
      const order = await submit({
        customer: atTable
          ? { name: draft.name.trim().slice(0, NAME_MAX) }
          : { name: draft.name.trim(), phone: digitsOf(draft.phone) },
        delivery: atTable ? { mode: 'dine_in', table: table!.token } : deliveryPayload(),
        payment: {
          method: pay,
          ...(pay === 'cash' &&
          changeFor !== null &&
          Number.isSafeInteger(changeFor) &&
          changeFor > 0
            ? { changeForCents: changeFor }
            : {}),
        },
        ...(notes.trim() ? { notes: notes.trim().slice(0, NOTES_MAX) } : {}),
        ...(scheduledFor && !atTable ? { scheduledFor } : {}),
        // the total on the button, Core's for this method: Core refuses (409 PRICES_CHANGED) an
        // order whose total moved since. Not when the delivery didn't sync: the cart's fee is stale
        ...(pricedTotals && !deliveryIssue ? { expectedTotalCents: pricedTotals.totalCents } : {}),
      });
      placed.current = true;
      clearDraft();
      if (draft.remember && atTable)
        // the name only: the phone and addresses the device holds stay as they are
        remember({
          name: draft.name,
          phone: customer?.phone ?? '',
          address: { street: '', number: '', neighborhood: '', complement: '' },
        });
      else if (draft.remember)
        remember({
          name: draft.name,
          phone: draft.phone,
          // a pickup doesn't replace the remembered addresses
          address:
            mode === 'delivery'
              ? {
                  street: draft.street,
                  number: draft.number,
                  neighborhood: draft.neighborhood,
                  complement: draft.complement,
                  ...(draft.cep ? { cep: draft.cep } : {}),
                  ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
                  ...(draft.reference?.trim() ? { reference: draft.reference.trim() } : {}),
                }
              : { street: '', number: '', neighborhood: '', complement: '' },
        });
      else forget();
      // card_online included: the card form is on the order page (Kernel 1.19)
      const orderPath = `${paths.order.replace(':id', order.id)}?novo=1`;
      go(orderPath);
    } catch (err) {
      // useCheckout().error carries the typed failure; route the fixable ones to their field
      const code = errorCode(err);
      if (code === 'TABLE_NOT_FOUND' && atTable) {
        const copy = errorCopy(code);
        leaveTable();
        showInfo('table', copy.title, copy.body);
      }
      if (code === 'SCHEDULE_REQUIRED' || code === 'INVALID_SCHEDULE')
        setScheduleError(errorCopy(code).title);
      if (code === 'INVALID_CHANGE')
        setChangeError(
          changeMessage(
            (err as { details?: Record<string, unknown> }).details,
            currency,
            pay === 'cash' ? changeFor : null,
          ),
        );
      // Core's new total for this method, asked again even when the cart's own totals held
      if (code === 'PRICES_CHANGED') {
        setPriced(null);
        setPriceTry((n) => n + 1);
      }
      if (isCouponError(code))
        setCouponError(
          couponMessage(code, (err as { details?: Record<string, unknown> }).details, currency),
        );
      // only a failure reopens the button: after an order the page is on its way out
      submitting.current = false;
    }
  };

  const failure = error ? (atTable && TABLE_COPY[error.code]) || errorCopy(error.code) : null;
  const labelOf = (id: StepId) => (atTable && id === 'entrega' ? 'Mesa' : LABEL[id]);
  const steps: CheckoutStep[] = ORDER.map((id) => ({ id, label: labelOf(id), done: done.has(id) }));

  return (
    <main id="main" className="v-page" data-vendua-page="checkout">
      <h1 className="v-page-title">Finalizar pedido</h1>
      <div className="v-checkout-grid">
        <Slot name="checkout.Layout" steps={steps} current={step} onStep={(id) => setStep(id)}>
          <form
            key={step}
            noValidate
            data-step={step}
            data-dir={stepDir.current}
            onSubmit={(e) => {
              e.preventDefault();
              if (step === 'pagamento') void place();
              else void advance();
            }}
          >
            <h2 className="v-sr" ref={stepHeading} tabIndex={-1}>
              Etapa {ORDER.indexOf(step) + 1} de {ORDER.length}: {labelOf(step)}
            </h2>
            {step === 'dados' ? (
              <Slot
                name="checkout.AddressForm"
                part="customer"
                value={draft}
                onChange={patch}
                errors={errors}
                neighborhoods={neighborhoods}
                {...(atTable ? { nameOnly: true } : {})}
              />
            ) : null}
            {step === 'dados' && reminderOffered ? (
              <label className="v-check v-reminder" data-vendua="cart-reminder">
                <input
                  type="checkbox"
                  checked={reminder !== null}
                  onChange={(e) => void askReminder(e.target.checked)}
                />{' '}
                Me lembre pelo WhatsApp se eu não terminar o pedido
              </label>
            ) : null}
            {step === 'entrega' ? (
              <>
                {tableOff ? (
                  <p className="v-note" role="status" data-vendua="table-note">
                    Os pedidos pela mesa estão desligados agora: chame a equipe, ou peça para
                    entrega ou retirada.
                  </p>
                ) : null}
                <Slot
                  name="checkout.DeliveryOptions"
                  options={options}
                  selected={deliveryMode}
                  onSelect={(m) => {
                    if (m === 'pickup' || m === 'delivery') setMode(m);
                  }}
                  currency={currency}
                />
                {table ? (
                  <p className="v-note" data-vendua="table-leave">
                    <button type="button" className="v-btn v-btn-ghost" onClick={leaveTable}>
                      Não estou na mesa
                    </button>
                  </p>
                ) : null}
                {deliveryMode === 'delivery' ? (
                  <Slot
                    name="checkout.AddressForm"
                    part="address"
                    value={draft}
                    onChange={patch}
                    errors={errors}
                    neighborhoods={neighborhoods}
                    onCep={(cep) => void onCep(cep)}
                    cepStatus={
                      cepLookup.pending
                        ? 'pending'
                        : cepLookup.error?.code === 'CEP_NOT_FOUND'
                          ? 'not_found'
                          : cepLookup.error
                            ? 'unavailable'
                            : cepLookup.result
                              ? 'found'
                              : 'idle'
                    }
                    {...(canLocate && !byDistance ? { onLocate, locateStatus } : {})}
                    {...(zoneHint && !byDistance ? { zoneHint } : {})}
                    {...(saved.length
                      ? {
                          savedAddresses: saved.map((a, i) => ({
                            id: String(i),
                            ...addressLabel(a),
                          })),
                          savedAddressId: savedIndex >= 0 ? String(savedIndex) : null,
                          onPickAddress: pickAddress,
                        }
                      : {})}
                  />
                ) : null}
                {deliveryMode === 'delivery' && byDistance ? (
                  <Slot
                    name="checkout.LocationPicker"
                    {...(mapAt ??
                      (coords
                        ? { center: coords, precision: 'address' as const }
                        : { center: byDistance.center, precision: 'area' as const }))}
                    value={coords}
                    tiles={byDistance.tiles}
                    status={pinStatus}
                    {...(pinHint ? { hint: pinHint } : {})}
                    {...(pinError ? { error: pinError } : {})}
                    onConfirm={(c) => void confirmPin(c)}
                    {...(canGeolocate
                      ? { onLocate: locateDevice, locateStatus: deviceLocate }
                      : {})}
                  />
                ) : null}
              </>
            ) : null}
            {step === 'pagamento' ? (
              <>
                {schedule && !atTable && (encomenda || scheduledFor) ? (
                  <Slot
                    name="checkout.SchedulePicker"
                    dates={schedule.dates}
                    value={scheduledFor}
                    onChange={(d) => {
                      setScheduledFor(d);
                      setScheduleError(undefined);
                    }}
                    required={encomenda}
                    leadDays={schedule.leadDays}
                    {...(store?.hours.timezone ? { timezone: store.hours.timezone } : {})}
                    {...(scheduleError ? { error: scheduleError } : {})}
                  />
                ) : null}
                <Slot
                  name="checkout.PaymentMethods"
                  methods={methods}
                  selected={pay}
                  onSelect={(id) => {
                    setPay(id);
                    setChangeError(undefined);
                  }}
                  currency={currency}
                  {...(methods.some((m) => m.id === 'cash')
                    ? {
                        changeForCents: changeFor,
                        onChangeFor: (cents: number | null) => {
                          setChangeFor(cents);
                          setChangeError(undefined);
                        },
                        ...(changeError ? { changeForError: changeError } : {}),
                      }
                    : {})}
                />
                {encomenda && !atTable && methods.length < byStore.length ? (
                  <p className="v-muted" data-part="payment-note">
                    Encomendas aceitam: {methods.map((m) => m.label).join(', ')}.
                  </p>
                ) : null}
                <Slot
                  name="checkout.CouponField"
                  coupon={coupon.coupon}
                  discountCents={coupon.discountCents}
                  currency={currency}
                  pending={coupon.pending}
                  {...(coupon.message || couponError
                    ? { error: (coupon.message ?? couponError)! }
                    : {})}
                  onApply={applyCoupon}
                  onRemove={removeCoupon}
                />
                <Slot name="checkout.Notes" value={notes} onChange={setNotes} max={NOTES_MAX} />
                {deliveryIssue ? (
                  <p className="v-alert" role="alert" data-part="delivery-issue">
                    {deliveryIssue}
                  </p>
                ) : null}
                {failure ? (
                  <div
                    className="v-alert"
                    role="alert"
                    data-vendua="checkout-error"
                    data-code={error?.code}
                  >
                    <strong>{failure.title}</strong>
                    {failure.body ? <span> {failure.body}</span> : null}
                  </div>
                ) : null}
              </>
            ) : null}
            {closedNow ? (
              <p className="v-note" role="status" data-part="closed-note">
                {closedNow}
              </p>
            ) : null}
            <div className="v-form-actions" data-part="actions">
              {step !== 'dados' ? (
                <button
                  type="button"
                  className="v-btn v-btn-ghost"
                  onClick={() => setStep(ORDER[ORDER.indexOf(step) - 1] ?? 'dados')}
                >
                  Voltar
                </button>
              ) : null}
              {step === 'pagamento' ? (
                <button
                  type="submit"
                  className="v-btn v-btn-accent"
                  disabled={pending || pricing || !!closedNow}
                  aria-busy={pending || undefined}
                >
                  {pending
                    ? 'Enviando…'
                    : `${pay === 'card_online' ? 'Ir para o pagamento' : 'Confirmar pedido'}${
                        pricing ? '' : ` · ${money((pricedTotals ?? cart.totals).totalCents)}`
                      }`}
                </button>
              ) : (
                <button type="submit" className="v-btn v-btn-accent" disabled={syncing}>
                  Continuar
                </button>
              )}
            </div>
            {step === 'pagamento' && pricing ? (
              <p className="v-note" role="status" data-part="pricing-note">
                {priceError ? (
                  <>
                    Não deu para calcular o total com {payLabel ?? 'esta forma de pagamento'}.{' '}
                    <button
                      type="button"
                      className="v-btn v-btn-ghost"
                      onClick={() => {
                        setPriceFailed('');
                        setPriceTry((n) => n + 1);
                      }}
                    >
                      Tentar de novo
                    </button>
                  </>
                ) : (
                  `Calculando o total com ${payLabel ?? 'esta forma de pagamento'}…`
                )}
              </p>
            ) : null}
          </form>
        </Slot>
        <Slot
          name="checkout.Summary"
          cart={pricedTotals ? { ...cart, totals: pricedTotals } : cart}
          currency={currency}
          vocabulary={vocabulary}
          {...(pricedTotals && payLabel ? { paymentLabel: payLabel } : {})}
        />
      </div>
    </main>
  );
}
