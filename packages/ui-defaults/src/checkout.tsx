import type { SlotProps } from '@vendua/kernel';
import { money, ORDER_STATE_LABEL, PAYMENT_LABEL } from './format.ts';

// checkout.* defaults. Validation and the step machine live in the Kernel's
// checkout page; these only render. Field names/labels follow the conformance
// conventions (name/phone/neighborhood/street/number, radios, "Continuar").

export function CheckoutLayout({ steps, current, onStep, children }: SlotProps['checkout.Layout']) {
  return (
    <div className="v-checkout" data-part="root">
      <ol className="v-steps" data-part="steps" aria-label="Etapas do pedido">
        {steps.map((s, i) => (
          <li
            key={s.id}
            className="v-step"
            data-part="step"
            data-state={s.id === current ? 'current' : s.done ? 'done' : 'todo'}
            aria-current={s.id === current ? 'step' : undefined}
          >
            {s.done && s.id !== current ? (
              <button type="button" className="v-step-btn" onClick={() => onStep(s.id)}>
                <span className="v-step-n">{i + 1}</span> {s.label}
              </button>
            ) : (
              <span className="v-step-btn">
                <span className="v-step-n">{i + 1}</span> {s.label}
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="v-checkout-body" data-part="body">
        {children}
      </div>
    </div>
  );
}

export function CheckoutSummary({ cart, currency, paymentLabel }: SlotProps['checkout.Summary']) {
  const t = cart.totals;
  const adjustment = t.paymentAdjustmentCents ?? 0;
  return (
    <section
      className="v-summary"
      data-vendua="checkout-summary"
      data-part="root"
      aria-label="Resumo do pedido"
    >
      <ul className="v-summary-lines" data-part="lines">
        {cart.items.map((i) => (
          <li key={i.id} className="v-summary-line">
            <span>
              {i.qty}× {i.name}
              {i.combo?.length ? (
                <span className="v-muted v-line-mods">
                  {' '}
                  — {i.combo.map((c) => `${c.qty}× ${c.name}`).join(', ')}
                </span>
              ) : null}
            </span>
            <span className="v-num">{money(i.lineTotalCents, currency)}</span>
          </li>
        ))}
      </ul>
      <dl className="v-summary-totals" data-part="totals">
        <div>
          <dt>Subtotal</dt>
          <dd className="v-num" data-vendua="subtotal">
            {money(t.subtotalCents, currency)}
          </dd>
        </div>
        {cart.delivery?.mode === 'delivery' ? (
          <div>
            <dt>Entrega{cart.delivery.neighborhood ? ` · ${cart.delivery.neighborhood}` : ''}</dt>
            <dd className="v-num" data-vendua="delivery-fee">
              {t.deliveryFeeCents > 0 ? money(t.deliveryFeeCents, currency) : 'grátis'}
            </dd>
          </div>
        ) : null}
        {t.discountCents ? (
          <div data-part="discount">
            <dt>Desconto{cart.coupon ? ` · ${cart.coupon.code}` : ''}</dt>
            <dd className="v-num" data-vendua="discount">
              −{money(t.discountCents, currency)}
            </dd>
          </div>
        ) : null}
        {adjustment ? (
          <div data-part="payment-adjustment">
            <dt>
              {adjustment < 0 ? 'Desconto' : 'Acréscimo'}
              {paymentLabel ? ` · ${paymentLabel}` : ' do pagamento'}
            </dt>
            <dd className="v-num" data-vendua="payment-adjustment">
              {adjustment < 0 ? '−' : '+'}
              {money(Math.abs(adjustment), currency)}
            </dd>
          </div>
        ) : null}
        <div className="v-summary-total">
          <dt>Total</dt>
          <dd className="v-num" data-vendua="total">
            {money(t.totalCents, currency)}
          </dd>
        </div>
      </dl>
      {cart.delivery?.mode === 'delivery' &&
      t.freeDeliveryRemainingCents != null &&
      t.freeDeliveryThresholdCents != null ? (
        t.freeDeliveryRemainingCents > 0 ? (
          <div className="v-progress" data-part="free-delivery" role="status">
            <p>
              Faltam {money(t.freeDeliveryRemainingCents, currency)} para{' '}
              <strong>entrega grátis</strong>.
            </p>
            <progress
              max={t.freeDeliveryThresholdCents}
              value={t.freeDeliveryThresholdCents - t.freeDeliveryRemainingCents}
            />
          </div>
        ) : (
          <p className="v-note" data-part="free-delivery" role="status">
            Você ganhou entrega grátis!
          </p>
        )
      ) : null}
      {t.belowMinOrder ? (
        <p className="v-alert" role="status" data-part="min-order">
          Faltam {money(t.remainingMinOrderCents, currency)} para o pedido mínimo de{' '}
          {money(t.minOrderCents, currency)}.
        </p>
      ) : null}
    </section>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="v-field" data-part="field" data-invalid={error ? true : undefined}>
      <label className="v-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="v-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AddressForm({
  value,
  onChange,
  errors,
  part,
  neighborhoods,
  onCep,
  cepStatus,
  onLocate,
  locateStatus,
  zoneHint,
}: SlotProps['checkout.AddressForm']) {
  const err = (k: keyof typeof errors) => errors[k];
  const aria = (k: keyof typeof errors) =>
    errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': `checkout-${k}-error` } : {};
  if (part === 'customer') {
    return (
      <fieldset className="v-fieldset" data-part="root">
        <legend className="v-legend">Seus dados</legend>
        <Field id="checkout-name" label="Nome" error={err('name')}>
          <input
            id="checkout-name"
            name="name"
            className="v-input"
            autoComplete="name"
            maxLength={120}
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            {...aria('name')}
          />
        </Field>
        <Field id="checkout-phone" label="WhatsApp" error={err('phone')}>
          <input
            id="checkout-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            className="v-input"
            autoComplete="tel"
            maxLength={20}
            placeholder="(00) 00000-0000"
            value={value.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            {...aria('phone')}
          />
        </Field>
        <label className="v-check" data-part="remember">
          <input
            type="checkbox"
            checked={value.remember}
            onChange={(e) => onChange({ remember: e.target.checked })}
          />{' '}
          Lembrar meus dados neste aparelho
        </label>
      </fieldset>
    );
  }
  return (
    <fieldset className="v-fieldset" data-part="root">
      <legend className="v-legend">Endereço de entrega</legend>
      {onLocate ? (
        <div className="v-locate" data-part="locate">
          <button
            type="button"
            className="v-btn v-btn-ghost"
            onClick={onLocate}
            disabled={locateStatus === 'pending'}
          >
            {locateStatus === 'pending' ? 'Localizando…' : 'Usar minha localização'}
          </button>
          {locateStatus === 'denied' ? (
            <span className="v-muted" role="status">
              Sem acesso à localização — preencha o endereço.
            </span>
          ) : locateStatus === 'out_of_zone' ? (
            <span className="v-muted" role="status">
              Sua localização fica fora da área de entrega.
            </span>
          ) : locateStatus === 'located' ? (
            <span className="v-muted" role="status">
              Localização usada para calcular a entrega.
            </span>
          ) : null}
        </div>
      ) : null}
      {onCep ? (
        <Field id="checkout-cep" label="CEP" error={err('cep')}>
          <input
            id="checkout-cep"
            name="cep"
            className="v-input v-input-short"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={9}
            placeholder="00000-000"
            value={value.cep ?? ''}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
              onChange({
                cep: digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits,
              });
              if (digits.length === 8) onCep(digits);
            }}
            aria-describedby="checkout-cep-status"
          />
          <span id="checkout-cep-status" className="v-muted" role="status">
            {cepStatus === 'pending'
              ? 'Buscando endereço…'
              : cepStatus === 'not_found'
                ? 'CEP não encontrado — preencha à mão.'
                : cepStatus === 'unavailable'
                  ? 'Busca de CEP indisponível — preencha à mão.'
                  : ''}
          </span>
        </Field>
      ) : null}
      <Field id="checkout-neighborhood" label="Bairro" error={err('neighborhood')}>
        <input
          id="checkout-neighborhood"
          name="neighborhood"
          className="v-input"
          list="checkout-neighborhoods"
          maxLength={80}
          value={value.neighborhood}
          onChange={(e) => onChange({ neighborhood: e.target.value })}
          {...aria('neighborhood')}
        />
        <datalist id="checkout-neighborhoods">
          {neighborhoods.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Field>
      <div className="v-field-row">
        <Field id="checkout-street" label="Rua" error={err('street')}>
          <input
            id="checkout-street"
            name="street"
            className="v-input"
            autoComplete="address-line1"
            maxLength={120}
            value={value.street}
            onChange={(e) => onChange({ street: e.target.value })}
            {...aria('street')}
          />
        </Field>
        <Field id="checkout-number" label="Número" error={err('number')}>
          <input
            id="checkout-number"
            name="number"
            className="v-input v-input-short"
            inputMode="numeric"
            maxLength={10}
            value={value.number}
            onChange={(e) => onChange({ number: e.target.value })}
            {...aria('number')}
          />
        </Field>
      </div>
      <Field id="checkout-complement" label="Complemento (opcional)" error={err('complement')}>
        <input
          id="checkout-complement"
          name="complement"
          className="v-input"
          autoComplete="address-line2"
          maxLength={80}
          value={value.complement}
          onChange={(e) => onChange({ complement: e.target.value })}
        />
      </Field>
      {value.reference !== undefined ? (
        <Field
          id="checkout-reference"
          label="Ponto de referência (opcional)"
          error={err('reference')}
        >
          <input
            id="checkout-reference"
            name="reference"
            className="v-input"
            maxLength={120}
            value={value.reference}
            onChange={(e) => onChange({ reference: e.target.value })}
          />
        </Field>
      ) : null}
      {zoneHint ? (
        <p className="v-note" data-part="zone" role="status">
          {zoneHint}
        </p>
      ) : null}
    </fieldset>
  );
}

export function DeliveryOptions({
  options,
  selected,
  onSelect,
}: SlotProps['checkout.DeliveryOptions']) {
  return (
    <fieldset className="v-fieldset" data-part="root">
      <legend className="v-legend">Como você quer receber?</legend>
      <div className="v-options" role="radiogroup" aria-label="Entrega ou retirada">
        {options.map((o) => (
          <label
            key={o.mode}
            className="v-option"
            data-part="option"
            data-selected={o.mode === selected || undefined}
          >
            <input
              type="radio"
              name="delivery-mode"
              value={o.mode}
              checked={o.mode === selected}
              disabled={o.disabled}
              onChange={() => onSelect(o.mode)}
            />
            <span className="v-option-label">{o.label}</span>
            {o.detail ? <span className="v-option-detail v-muted">{o.detail}</span> : null}
            {o.note && o.mode === selected ? (
              <span className="v-option-note" data-part="option-note">
                {o.note}
              </span>
            ) : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PaymentMethods({
  methods,
  selected,
  onSelect,
}: SlotProps['checkout.PaymentMethods']) {
  return (
    <fieldset className="v-fieldset" data-part="root">
      <legend className="v-legend">Pagamento</legend>
      <div className="v-options" role="radiogroup" aria-label="Forma de pagamento">
        {methods.map((m) => (
          <label
            key={m.id}
            className="v-option"
            data-part="option"
            data-selected={m.id === selected || undefined}
          >
            <input
              type="radio"
              name="payment-method"
              value={m.id}
              checked={m.id === selected}
              onChange={() => onSelect(m.id)}
            />
            <span className="v-option-label">
              {m.label}
              {m.adjustment ? (
                <span
                  className="v-option-adjust v-num"
                  data-part="adjustment"
                  data-kind={m.adjustment.kind}
                >
                  <span className="v-sr">
                    {m.adjustment.kind === 'discount'
                      ? ' desconto de '
                      : m.adjustment.kind === 'surcharge'
                        ? ' acréscimo de '
                        : ' ajuste de '}
                  </span>
                  {m.adjustment.label}
                </span>
              ) : null}
            </span>
            {m.detail ? <span className="v-option-detail v-muted">{m.detail}</span> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SuccessPage({ order, currency }: SlotProps['checkout.SuccessPage']) {
  // the Pix card right below carries the how-to; here only what's left to do
  const pay = order.payment;
  const pixDue =
    pay.method === 'pix' && pay.status === 'pending' && (!!pay.pix || pay.online === true);
  const cardDue =
    pay.method === 'card_online' && ['pending', 'failed', 'expired'].includes(pay.status);
  return (
    <section
      className="v-panel v-success"
      data-vendua="checkout-success"
      data-part="root"
      role="status"
    >
      <svg
        className="v-success-icon"
        data-part="icon"
        viewBox="0 0 24 24"
        width="40"
        height="40"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="11" fill="currentColor" />
        <path
          d="m7 12.5 3.2 3.2L17 9"
          fill="none"
          stroke="var(--v-color-surface, #fff)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <h1 className="v-page-title" data-part="title">
        Pedido #{order.number} recebido!
      </h1>
      <p className="v-muted" data-part="body">
        {/* the title already says "recebido" — the state only earns a mention once it moves on */}
        {[
          order.state === 'placed' ? null : (ORDER_STATE_LABEL[order.state] ?? order.state),
          money(order.totalCents, currency),
          PAYMENT_LABEL[order.payment.method] ?? order.payment.method,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {pixDue ? (
        <p className="v-success-next" data-part="next">
          {pay.online
            ? 'Falta só o Pix — a confirmação aparece aqui assim que o pagamento cair.'
            : 'Falta só o Pix — assim que o pagamento cair, o pedido vai para a loja.'}
        </p>
      ) : cardDue ? (
        <p className="v-success-next" data-part="next">
          Falta só o pagamento no cartão.
        </p>
      ) : order.payment.instructions ? (
        <p className="v-note" data-part="instructions">
          {order.payment.instructions}
        </p>
      ) : null}
    </section>
  );
}

export function EmptyCart({ onBrowse }: SlotProps['checkout.EmptyCart']) {
  return (
    <div className="v-panel v-empty" data-vendua="empty-cart" data-part="root">
      <BagIcon />
      <p className="v-panel-title" data-part="title">
        Sua sacola está vazia.
      </p>
      <p className="v-muted" data-part="body">
        Escolha algo no cardápio — a sacola fica guardada neste aparelho.
      </p>
      <button type="button" className="v-btn v-btn-accent" data-part="browse" onClick={onBrowse}>
        Ver cardápio
      </button>
    </div>
  );
}

function BagIcon() {
  return (
    <svg
      className="v-empty-icon"
      data-part="icon"
      viewBox="0 0 48 48"
      width="56"
      height="56"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 16h28l-2.2 22.4A4 4 0 0 1 31.8 42H16.2a4 4 0 0 1-4-3.6z" />
      <path d="M18 20v-6a6 6 0 0 1 12 0v6" />
    </svg>
  );
}
