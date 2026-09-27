import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useCart,
  useCep,
  useCheckout,
  useCustomer,
  useDeliveryQuote,
  useDeliveryZones,
  useStore,
} from '../hooks.ts';
import { useNavigateTo } from '../primitives.tsx';
import { Slot } from '../slot.tsx';
import { errorCopy, errorCode } from '../errors.ts';
import { emit } from '../telemetry.ts';
import { useKernel } from '../provider.tsx';
import { resolvePaths } from '../config.ts';
import type { CheckoutStep, CustomerDraft, DeliveryOption, PaymentMethod } from '../slot-props.ts';
import { money } from '@vendua/ui-defaults';

// /checkout — the Kernel-owned checkout (ADR 0004): a three-step machine
// (dados → entrega → pagamento). Validation here is shape-only; every business
// rule (zone, minimum, pause) is Core's answer, surfaced as-is.

type StepId = CheckoutStep['id'];
const ORDER: StepId[] = ['dados', 'entrega', 'pagamento'];
const LABEL: Record<StepId, string> = {
  dados: 'Seus dados',
  entrega: 'Entrega',
  pagamento: 'Pagamento',
};

const METHODS: PaymentMethod[] = [
  { id: 'pix', label: 'Pix' },
  { id: 'card_on_delivery', label: 'Cartão na entrega' },
  { id: 'cash', label: 'Dinheiro' },
];

const NOTES_MAX = 500;
const COUPON_CODES = new Set([
  'COUPON_NOT_FOUND',
  'INVALID_COUPON',
  'COUPON_EXPIRED',
  'COUPON_NOT_STARTED',
  'COUPON_EXHAUSTED',
  'COUPON_MIN_SUBTOTAL',
  'COUPON_NOT_YOURS',
  'COUPON_ALREADY_USED',
  'COUPON_FIRST_ORDER_ONLY',
]);

function validate(step: StepId, d: CustomerDraft, mode: 'pickup' | 'delivery', located = false) {
  const e: Partial<Record<keyof CustomerDraft, string>> = {};
  if (step === 'dados') {
    if (d.name.trim().length < 2) e.name = 'Informe seu nome.';
    const digits = d.phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) e.phone = 'Informe um WhatsApp com DDD.';
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
  const { config } = useKernel();
  const go = useNavigateTo();
  const paths = resolvePaths(config);
  const currency = store?.currency ?? 'BRL';

  const [step, setStep] = useState<StepId>('dados');
  const [done, setDone] = useState<Set<StepId>>(new Set());
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
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locateStatus, setLocateStatus] = useState<
    'idle' | 'pending' | 'located' | 'denied' | 'out_of_zone'
  >('idle');
  const [zoneHint, setZoneHint] = useState<string | undefined>();
  const [notes, setNotes] = useState('');
  const [scheduledFor, setScheduledFor] = useState<string | undefined>();
  const [scheduleError, setScheduleError] = useState<string | undefined>();
  const [couponPending, setCouponPending] = useState(false);
  const [couponError, setCouponError] = useState<string | undefined>();
  const deliveryOk = store?.deliveryEnabled !== false;
  const pickupOk = store?.pickupEnabled !== false;
  const [mode, setMode] = useState<'pickup' | 'delivery'>(deliveryOk ? 'delivery' : 'pickup');
  const [pay, setPay] = useState<PaymentMethod['id']>('pix');
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerDraft, string>>>({});
  const [deliveryIssue, setDeliveryIssue] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const submitting = useRef(false);
  const stepStarted = useRef(Date.now());

  useEffect(() => {
    emit('checkout_step', { step, duration_ms: Date.now() - stepStarted.current });
    stepStarted.current = Date.now();
  }, [step]);

  const neighborhoods = useMemo(() => zones.flatMap((z) => z.neighborhoods), [zones]);
  const canLocate =
    typeof navigator !== 'undefined' &&
    'geolocation' in navigator &&
    zones.some((z) => z.kind === 'radius');
  const schedule = cart?.schedule;
  const encomenda = schedule?.required === true;
  const allowed = encomenda ? schedule!.paymentMethods.join(',') : '';
  // the store's own list (Kernel 1.4); absent on an older Core = all three
  const accepted = store?.paymentMethods?.join(',') ?? '';
  const methods = useMemo(() => {
    const byStore = accepted ? METHODS.filter((m) => accepted.split(',').includes(m.id)) : METHODS;
    return allowed ? byStore.filter((m) => allowed.split(',').includes(m.id)) : byStore;
  }, [allowed, accepted]);
  // an encomenda narrows payment (Pix-only in the reference) — keep the choice valid
  useEffect(() => {
    if (methods.length && !methods.some((m) => m.id === pay)) setPay(methods[0]!.id);
  }, [methods, pay]);
  const minFee = zones.length ? Math.min(...zones.map((z) => z.feeCents)) : null;
  const options: DeliveryOption[] = [
    {
      mode: 'delivery',
      label: 'Entrega',
      ...(minFee !== null
        ? { detail: minFee > 0 ? `a partir de ${money(minFee, currency)}` : 'grátis' }
        : {}),
      disabled: !deliveryOk,
    },
    { mode: 'pickup', label: 'Retirada', detail: store?.address ?? 'na loja', disabled: !pickupOk },
  ];

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
        <Slot name="checkout.EmptyCart" onBrowse={() => go(paths.catalog)} />
      </main>
    );

  const patch = (p: Partial<CustomerDraft>) => {
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
    setDraft((d) => ({
      ...d,
      street: d.street.trim() ? d.street : (a.street ?? ''),
      neighborhood: d.neighborhood.trim() ? d.neighborhood : (a.neighborhood ?? ''),
    }));
    setZoneHint(
      r.zone.eligible
        ? `Entrega para ${a.neighborhood ?? 'esse CEP'}: ${
            (r.zone.feeCents ?? 0) > 0 ? money(r.zone.feeCents!, currency) : 'grátis'
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
            `Entrega ${r.distanceKm != null ? `a ${r.distanceKm.toLocaleString('pt-BR')} km` : ''}: ${
              (r.feeCents ?? 0) > 0 ? money(r.feeCents!, currency) : 'grátis'
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
          ...(draft.cep && draft.cep.replace(/\D/g, '').length === 8
            ? { cep: draft.cep.replace(/\D/g, '') }
            : {}),
          ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
        };

  const applyCoupon = async (code: string) => {
    setCouponPending(true);
    setCouponError(undefined);
    try {
      await mutations.applyCoupon(code);
    } catch (err) {
      setCouponError(errorCopy(errorCode(err)).title);
    } finally {
      setCouponPending(false);
    }
  };
  const removeCoupon = async () => {
    setCouponPending(true);
    try {
      await mutations.removeCoupon();
    } catch (err) {
      setCouponError(errorCopy(errorCode(err)).title);
    } finally {
      setCouponPending(false);
    }
  };

  const advance = async () => {
    const e = validate(step, draft, mode, coords !== null);
    setErrors(e);
    if (Object.keys(e).length) return;
    if (step === 'entrega') {
      // sync the server cart so fee/min-order land in Core's totals; a zone problem
      // is shown but doesn't trap the customer — submit gets Core's final answer
      setSyncing(true);
      setDeliveryIssue(null);
      try {
        await mutations.setDelivery(deliveryPayload());
      } catch (err) {
        setDeliveryIssue(errorCopy(errorCode(err)).title);
      } finally {
        setSyncing(false);
      }
    }
    setDone((d) => new Set(d).add(step));
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
        customer: { name: draft.name.trim(), phone: draft.phone.replace(/\D/g, '') },
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
          },
        });
      else forget();
      go(`${paths.order.replace(':id', order.id)}?novo=1`);
    } catch (err) {
      // useCheckout().error carries the typed failure; route the fixable ones to their field
      const code = errorCode(err);
      if (code === 'SCHEDULE_REQUIRED' || code === 'INVALID_SCHEDULE')
        setScheduleError(errorCopy(code).title);
      if (COUPON_CODES.has(code)) setCouponError(errorCopy(code).title);
    } finally {
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
            noValidate
            data-step={step}
            onSubmit={(e) => {
              e.preventDefault();
              if (step === 'pagamento') void place();
              else void advance();
            }}
          >
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
                    {...(canLocate ? { onLocate, locateStatus } : {})}
                    {...(zoneHint ? { zoneHint } : {})}
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
                />
                {encomenda && methods.length < METHODS.length ? (
                  <p className="v-muted" data-part="payment-note">
                    Encomendas aceitam: {methods.map((m) => m.label).join(', ')}.
                  </p>
                ) : null}
                <Slot
                  name="checkout.CouponField"
                  coupon={cart.coupon ?? null}
                  discountCents={cart.totals.discountCents ?? 0}
                  currency={currency}
                  pending={couponPending}
                  {...(couponError ? { error: couponError } : {})}
                  onApply={(code) => void applyCoupon(code)}
                  onRemove={() => void removeCoupon()}
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
                  disabled={pending}
                  aria-busy={pending || undefined}
                >
                  {pending
                    ? 'Enviando…'
                    : `Confirmar pedido · ${money(cart.totals.totalCents, currency)}`}
                </button>
              ) : (
                <button type="submit" className="v-btn v-btn-accent" disabled={syncing}>
                  Continuar
                </button>
              )}
            </div>
          </form>
        </Slot>
        <Slot name="checkout.Summary" cart={cart} currency={currency} />
      </div>
    </main>
  );
}
