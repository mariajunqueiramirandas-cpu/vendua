import { useState } from 'react';
import type { SlotProps } from '@vendua/kernel';
import { dateTime, dayLabel, money, ORDER_STATE_LABEL, PAYMENT_LABEL, time } from './format.ts';

const TERMINAL = new Set(['delivered', 'cancelled', 'refunded']);

// cart.*, order.*, store.*, catalog.* defaults.

export function QtyControl({
  qty,
  min = 0,
  max = 99,
  pending,
  onChange,
  label = 'quantidade',
}: {
  qty: number;
  min?: number;
  max?: number;
  pending?: boolean;
  onChange: (n: number) => void;
  label?: string;
}) {
  return (
    <span
      className="v-qty"
      data-vendua="qty-stepper"
      data-part="qty"
      role="group"
      aria-label={label}
      data-pending={pending || undefined}
    >
      <button
        type="button"
        aria-label="diminuir"
        disabled={pending || qty <= min}
        onClick={() => onChange(qty - 1)}
      >
        −
      </button>
      <output aria-live="polite">{qty}</output>
      <button
        type="button"
        aria-label="aumentar"
        disabled={pending || qty >= max}
        onClick={() => onChange(qty + 1)}
      >
        +
      </button>
    </span>
  );
}

export function CartDrawer({
  cart,
  presentation,
  checkout,
  lines,
  summary,
  onClose,
}: SlotProps['cart.Drawer']) {
  return (
    <section
      className="v-cart"
      data-part="root"
      data-presentation={presentation}
      aria-label="Sacola"
    >
      <header className="v-cart-head" data-part="head">
        <h1 className="v-page-title">Sacola</h1>
        <p className="v-muted">
          {cart.totals.itemCount} {cart.totals.itemCount === 1 ? 'item' : 'itens'}
        </p>
        {presentation === 'drawer' ? (
          <button
            type="button"
            className="v-btn v-btn-ghost"
            onClick={onClose}
            aria-label="Fechar sacola"
          >
            ×
          </button>
        ) : null}
      </header>
      <div className="v-cart-grid">
        <ol className="v-cart-lines" data-part="lines">
          {lines}
        </ol>
        <aside className="v-cart-aside" data-part="aside">
          {summary}
          {checkout}
          <button
            type="button"
            className="v-btn v-btn-ghost v-btn-block"
            data-part="continue"
            onClick={onClose}
          >
            Continuar escolhendo
          </button>
        </aside>
      </div>
    </section>
  );
}

export function CartLineItem({
  item,
  currency,
  pending,
  onQty,
  onRemove,
}: SlotProps['cart.LineItem']) {
  const unavailable = item.productStatus !== 'active';
  return (
    <li
      className="v-line"
      data-vendua="cart-line"
      data-part="root"
      data-unavailable={unavailable || undefined}
    >
      <div className="v-line-main">
        <p className="v-line-name" data-part="name">
          {item.name}
        </p>
        {item.modifiers.length > 0 ? (
          <p className="v-muted v-line-mods" data-part="modifiers">
            {item.modifiers
              .map((m) =>
                m.priceDeltaCents > 0
                  ? `${m.name} (+${money(m.priceDeltaCents, currency)})`
                  : m.name,
              )
              .join(', ')}
          </p>
        ) : null}
        {item.combo?.length ? (
          <p className="v-muted v-line-mods" data-part="combo">
            {item.combo.map((c) => `${c.qty}× ${c.name}`).join(', ')}
          </p>
        ) : null}
        {item.requiresPreorder ? (
          <p className="v-badge" data-part="preorder">
            Encomenda
          </p>
        ) : null}
        {unavailable ? (
          <p className="v-alert" role="status">
            Indisponível agora — remova para continuar.
          </p>
        ) : null}
        <div className="v-line-actions" data-part="actions">
          <QtyControl
            qty={item.qty}
            pending={pending}
            onChange={onQty}
            label={`quantidade de ${item.name}`}
          />
          <button
            type="button"
            className="v-link-btn"
            data-part="remove"
            aria-label={`Remover ${item.name}`}
            disabled={pending}
            onClick={onRemove}
          >
            Remover
          </button>
        </div>
      </div>
      <p className="v-line-total v-num" data-part="total">
        {money(item.lineTotalCents, currency)}
      </p>
    </li>
  );
}

export function OrderTimeline({ events }: SlotProps['order.Timeline']) {
  return (
    <ol className="v-timeline" data-vendua="order-timeline" data-part="root">
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`} className="v-timeline-item" data-part="event" data-state={e.to}>
          <span className="v-timeline-label">{ORDER_STATE_LABEL[e.to] ?? e.to}</span>
          <time className="v-muted" dateTime={e.at}>
            {dateTime(e.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

export function OrderStatusPage({ order, currency, timeline }: SlotProps['order.StatusPage']) {
  const d = order.delivery;
  return (
    <section
      className="v-order"
      data-vendua="order-status"
      data-part="root"
      data-state={order.state}
    >
      <header className="v-order-head" data-part="head">
        <p className="v-eyebrow">Pedido #{order.number}</p>
        <h1 className="v-page-title" data-part="state">
          {ORDER_STATE_LABEL[order.state] ?? order.state}
        </h1>
        {order.scheduledFor ? (
          <p className="v-muted" data-part="scheduled">
            Encomenda para {dayLabel(order.scheduledFor)}
          </p>
        ) : d.promisedTo && !TERMINAL.has(order.state) ? (
          <p className="v-muted" data-part="promise">
            {d.mode === 'delivery' ? 'Chega' : 'Pronto para retirar'}{' '}
            {d.promisedFrom && d.promisedFrom !== d.promisedTo
              ? `entre ${time(d.promisedFrom)} e ${time(d.promisedTo)}`
              : `por volta de ${time(d.promisedTo)}`}
          </p>
        ) : d.etaMin != null && d.etaMax != null && d.mode === 'delivery' ? (
          <p className="v-muted">
            Entrega em {d.etaMin}–{d.etaMax} min
          </p>
        ) : null}
      </header>
      <div className="v-order-grid">
        <div data-part="timeline">{timeline}</div>
        <dl className="v-order-facts" data-part="facts">
          <div>
            <dt>{d.mode === 'delivery' ? 'Entrega' : 'Retirada'}</dt>
            <dd>
              {d.mode === 'delivery'
                ? [typeof d.address === 'string' ? d.address : null, d.neighborhood]
                    .filter(Boolean)
                    .join(' — ') || 'Endereço informado'
                : 'Na loja'}
            </dd>
          </div>
          <div>
            <dt>Pagamento</dt>
            <dd>{PAYMENT_LABEL[order.payment.method] ?? order.payment.method}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd className="v-num">{money(order.totalCents, currency)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

const DAY = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function HoursTable({ hours }: SlotProps['store.HoursTable']) {
  const rows = DAY.map((label, day) => ({
    label,
    windows: hours.windows.filter((w) => w.days.includes(day)).map((w) => `${w.open}–${w.close}`),
  }));
  return (
    <table className="v-hours" data-vendua="hours-table" data-part="root">
      <caption className="v-sr">Horário de funcionamento</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} data-part="row">
            <th scope="row">{r.label}</th>
            <td className="v-num">{r.windows.length ? r.windows.join(', ') : 'Fechado'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProductCard({ product, currency, link }: SlotProps['catalog.ProductCard']) {
  const soldOut = product.status !== 'active';
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <article className="v-card" data-part="root" data-status={product.status}>
      {link(
        <>
          <div className="v-card-media" data-part="media" aria-hidden="true">
            {product.imageUrl && !imgFailed ? (
              <img
                src={product.imageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <span className="v-card-initial" data-figure={product.figureVariant}>
                {product.name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <h3 className="v-card-name" data-part="name">
            {product.name}
          </h3>
          {product.description ? (
            <p className="v-card-desc v-muted" data-part="description">
              {product.description}
            </p>
          ) : null}
          <p className="v-card-price v-num" data-part="price">
            {soldOut ? (
              <span className="v-flag">Esgotado</span>
            ) : (
              money(product.basePriceCents, currency)
            )}
          </p>
        </>,
      )}
    </article>
  );
}

export function ModifierPicker({
  groups,
  value,
  onChange,
  currency,
  errors,
}: SlotProps['catalog.ModifierPicker']) {
  return (
    <div className="v-mods" data-vendua="modifier-picker" data-part="root">
      {groups.map((g) => {
        const single = g.maxSelect === 1;
        const sel = value[g.id] ?? [];
        const hint = g.required
          ? single
            ? 'obrigatório'
            : `escolha ${Math.max(1, g.minSelect)}–${g.maxSelect}`
          : single
            ? 'opcional'
            : `até ${g.maxSelect}`;
        return (
          <fieldset
            key={g.id}
            className="v-mod-group"
            data-part="group"
            data-invalid={errors[g.id] ? true : undefined}
          >
            <legend className="v-legend">
              {g.name} <span className="v-muted">— {hint}</span>
            </legend>
            <ul className="v-mod-list" role={single ? 'radiogroup' : 'group'} aria-label={g.name}>
              {g.modifiers.map((m) => {
                const on = sel.includes(m.id);
                const soldOut = m.status !== 'active';
                const capped = !on && !single && sel.length >= g.maxSelect;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      role={single ? 'radio' : 'checkbox'}
                      aria-checked={on}
                      disabled={soldOut || capped}
                      className="v-mod"
                      data-part="modifier"
                      data-selected={on || undefined}
                      onClick={() =>
                        onChange(
                          g.id,
                          on ? sel.filter((x) => x !== m.id) : single ? [m.id] : [...sel, m.id],
                        )
                      }
                    >
                      <span>{m.name}</span>
                      {soldOut ? <span className="v-muted"> · esgotado</span> : null}
                      {m.priceDeltaCents !== 0 ? (
                        <span className="v-muted v-num">
                          {' '}
                          {m.priceDeltaCents > 0 ? '+' : '−'}
                          {money(Math.abs(m.priceDeltaCents), currency)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {errors[g.id] ? (
              <p className="v-field-error" role="alert">
                {errors[g.id]}
              </p>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}
