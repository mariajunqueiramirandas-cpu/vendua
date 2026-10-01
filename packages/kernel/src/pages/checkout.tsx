import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
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
} from '../hooks.ts';
import { useNavigateTo } from '../primitives.tsx';
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
import { couponMessage, isCouponError } from '../rules/errors.ts';
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

/** The store's rule as a label ("−5%", "+R$ 1,50") — the cents are Core's, in the totals. */
function adjustmentLabel(a: PaymentAdjustment, currency: string): PaymentMethod['adjustment'] {
  const kind = adjustmentKind(a);
  const label = adjustmentShort(a, currency);
  return kind && label ? { label, kind } : undefined;
}

/** Full-page hand-off to the provider's hosted checkout (card data never touches us). */
function leaveTo(url: string) {
  globalThis.location.assign(url);
}

type PinStatus = SlotPropsOf<'checkout.LocationPicker'>['status'];

const savedPin = (a: { lat?: number; lng?: number } | undefined): LatLng | null =>
  typeof a?.lat === 'number' && typeof a.lng === 'number' ? { lat: a.lat, lng: a.lng } : null;

function validate(step: StepId, d: CustomerDraft, mode: 'pickup' | 'delivery', located = false) {
  const e: Partial<Record<keyof CustomerDraft, string>> = {};
  if (step === 'dados') {
    if (d.name.trim().length < 2) e.name = 'Informe seu nome.';
    if (!isValidPhone(d.phone)) e.phone = 'Informe um WhatsApp com DDD.';
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

  const location = useLocation();
  const navigate = useNavigate();
  const nav = location.state as { vStep?: unknown; vFrom?: unknown } | null;
  const lastStep = useRef<StepId | null>(null);
  // a state-less entry that only adds a hash (the header's skip link) stays on its step
  const hashOnly = !nav?.vStep && location.hash !== '' && lastStep.current !== null;
  const asked = ORDER.find((s) => s === nav?.vStep) ?? (hashOnly ? lastStep.current! : 'dados');
  const [done, setDone] = useState<Set<StepId>>(new Set());
  // a reload keeps the entry but not the answers: start over from the first step
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
  const [draft, setDraft] = useState<CustomerDraft>(() => ({
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    street: customer?.address.street ?? '',
    number: customer?.address.number ?? '',
    neighborhood: customer?.address.neighborhood ?? '',
    complement: customer?.address.complement ?? '',
    cep: customer?.address.cep ?? '',
    reference: '',
    remember: true,
  }));
  // a pin the shopper confirmed (on this device's remembered address, or on the map)
  const [coords, setCoords] = useState<LatLng | null>(() => savedPin(customer?.address));
  const [locateStatus, setLocateStatus] = useState<
    'idle' | 'pending' | 'located' | 'denied' | 'out_of_zone'
  >('idle');
  const [zoneHint, setZoneHint] = useState<string | undefined>();
  const [notes, setNotes] = useState('');
  const [scheduledFor, setScheduledFor] = useState<string | undefined>();
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
    savedPin(customer?.address) ? 'confirmed' : 'idle',
  );
  const [pinHint, setPinHint] = useState<string | undefined>();
  const [pinError, setPinError] = useState<string | undefined>();
  const [deviceLocate, setDeviceLocate] = useState<'idle' | 'pending' | 'denied'>('idle');
  // the CEP's city/state, for placing the typed address
  const [cepPlace, setCepPlace] = useState<{ city: string | null; state: string | null } | null>(
    null,
  );
  const [mode, setMode] = useState<'pickup' | 'delivery'>(deliveryOk ? 'delivery' : 'pickup');
  const [pay, setPay] = useState<PaymentMethod['id']>('pix');
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerDraft, string>>>({});
  const [deliveryIssue, setDeliveryIssue] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const submitting = useRef(false);
  const stepStarted = useRef(Date.now());
  // card_online: the order exists and the shopper is on the way to Mercado Pago
  const [leaving, setLeaving] = useState<{ totalCents: number; url?: string } | null>(null);

  useEffect(() => {
    emit('checkout_step', { step, duration_ms: Date.now() - stepStarted.current });
    stepStarted.current = Date.now();
  }, [step]);

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
    if (submitting.current || leaving || loading) return;
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
  const allowed = encomenda ? schedule!.paymentMethods.join(',') : '';
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
  const methods = useMemo(
    () => (allowed ? byStore.filter((m) => allowed.split(',').includes(m.id)) : byStore),
    [allowed, byStore],
  );
  // an encomenda narrows payment (Pix-only in the reference) — keep the choice valid
  useEffect(() => {
    if (methods.length && !methods.some((m) => m.id === pay)) setPay(methods[0]!.id);
  }, [methods, pay]);
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
  const options: DeliveryOption[] = [
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
  const pinWanted = !!byDistance && step === 'entrega' && mode === 'delivery';
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

  if (leaving)
    return (
      <main id="main" className="v-page" data-vendua-page="checkout">
        <h1 className="v-page-title">Pagamento</h1>
        <Slot
          name="checkout.PaymentStatus"
          status="redirecting"
          method="card_online"
          amountCents={leaving.totalCents}
          currency={currency}
          {...(leaving.url ? { href: leaving.url } : {})}
        />
      </main>
    );

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
    mode === 'pickup'
      ? { mode }
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

  const advance = async () => {
    const e = validate(step, draft, mode, coords !== null);
    setErrors(e);
    const needPin = step === 'entrega' && mode === 'delivery' && !!byDistance && !coords;
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
    if (submitting.current || pending) return;
    if (encomenda && !scheduledFor) {
      setScheduleError('Escolha a data da encomenda.');
      return;
    }
    submitting.current = true;
    reset();
    setScheduleError(undefined);
    try {
      const order = await submit({
        customer: { name: draft.name.trim(), phone: digitsOf(draft.phone) },
        delivery: deliveryPayload(),
        payment: { method: pay },
        ...(notes.trim() ? { notes: notes.trim().slice(0, NOTES_MAX) } : {}),
        ...(scheduledFor ? { scheduledFor } : {}),
      });
      if (draft.remember)
        remember({
          name: draft.name,
          phone: draft.phone,
          address: {
            street: draft.street,
            number: draft.number,
            neighborhood: draft.neighborhood,
            complement: draft.complement,
            ...(draft.cep ? { cep: draft.cep } : {}),
            ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
          },
        });
      else forget();
      const orderPath = `${paths.order.replace(':id', order.id)}?novo=1`;
      if (pay === 'card_online') {
        // the order is placed; the card is paid on Mercado Pago's page, which returns to
        // the order page. No redirect (provider down) → the order page offers to retry.
        setLeaving({ totalCents: order.totalCents });
        try {
          const r = await api.payOrder(order.id);
          if (r.next.kind === 'redirect') {
            setLeaving({ totalCents: order.totalCents, url: r.next.url });
            leaveTo(r.next.url);
            return;
          }
        } catch {
          /* the order page shows why and how to retry */
        }
        setLeaving(null);
      }
      go(orderPath);
    } catch (err) {
      // useCheckout().error carries the typed failure; route the fixable ones to their field
      const code = errorCode(err);
      if (code === 'SCHEDULE_REQUIRED' || code === 'INVALID_SCHEDULE')
        setScheduleError(errorCopy(code).title);
      if (isCouponError(code))
        setCouponError(
          couponMessage(code, (err as { details?: Record<string, unknown> }).details, currency),
        );
      // only a failure reopens the button: after an order the page is on its way out
      submitting.current = false;
    }
  };

  const failure = error ? errorCopy(error.code) : null;
  const steps: CheckoutStep[] = ORDER.map((id) => ({ id, label: LABEL[id], done: done.has(id) }));

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
              Etapa {ORDER.indexOf(step) + 1} de {ORDER.length}: {LABEL[step]}
            </h2>
            {step === 'dados' ? (
              <Slot
                name="checkout.AddressForm"
                part="customer"
                value={draft}
                onChange={patch}
                errors={errors}
                neighborhoods={neighborhoods}
              />
            ) : null}
            {step === 'entrega' ? (
              <>
                <Slot
                  name="checkout.DeliveryOptions"
                  options={options}
                  selected={mode}
                  onSelect={setMode}
                  currency={currency}
                />
                {mode === 'delivery' ? (
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
                  />
                ) : null}
                {mode === 'delivery' && byDistance ? (
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
                {schedule && (encomenda || scheduledFor) ? (
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
                  onSelect={setPay}
                  currency={currency}
                />
                {encomenda && methods.length < byStore.length ? (
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
                  disabled={pending || pricing}
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
