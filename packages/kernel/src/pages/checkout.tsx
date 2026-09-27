import { useEffect, useMemo, useRef, useState } from 'react';
import { useCart, useCheckout, useCustomer, useDeliveryZones, useStore } from '../hooks.ts';
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

function validate(step: StepId, d: CustomerDraft, mode: 'pickup' | 'delivery') {
  const e: Partial<Record<keyof CustomerDraft, string>> = {};
  if (step === 'dados') {
    if (d.name.trim().length < 2) e.name = 'Informe seu nome.';
    const digits = d.phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) e.phone = 'Informe um WhatsApp com DDD.';
  }
  if (step === 'entrega' && mode === 'delivery') {
    if (!d.neighborhood.trim()) e.neighborhood = 'Informe o bairro.';
    if (!d.street.trim()) e.street = 'Informe a rua.';
    if (!d.number.trim()) e.number = 'Informe o número.';
  }
  return e;
}

export function CheckoutPage() {
  const { cart, loading, mutations } = useCart();
  const { store } = useStore();
  const { zones } = useDeliveryZones();
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
    remember: true,
  }));
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

  const advance = async () => {
    const e = validate(step, draft, mode);
    setErrors(e);
    if (Object.keys(e).length) return;
    if (step === 'entrega') {
      // sync the server cart so fee/min-order land in Core's totals; a zone problem
      // is shown but doesn't trap the customer — submit gets Core's final answer
      setSyncing(true);
      setDeliveryIssue(null);
      try {
        await mutations.setDelivery(
          mode === 'pickup' ? { mode } : { mode, neighborhood: draft.neighborhood.trim() },
        );
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
    submitting.current = true;
    reset();
    try {
      const address = [draft.street.trim(), draft.number.trim(), draft.complement.trim()]
        .filter(Boolean)
        .join(', ');
      const order = await submit({
        customer: { name: draft.name.trim(), phone: draft.phone.replace(/\D/g, '') },
        delivery:
          mode === 'pickup' ? { mode } : { mode, neighborhood: draft.neighborhood.trim(), address },
        payment: { method: pay },
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
          },
        });
      else forget();
      go(`${paths.order.replace(':id', order.id)}?novo=1`);
    } catch {
      /* useCheckout().error carries the typed failure */
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
                  />
                ) : null}
              </>
            ) : null}
            {step === 'pagamento' ? (
              <>
                <Slot
                  name="checkout.PaymentMethods"
                  methods={METHODS}
                  selected={pay}
                  onSelect={setPay}
                />
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
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
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
