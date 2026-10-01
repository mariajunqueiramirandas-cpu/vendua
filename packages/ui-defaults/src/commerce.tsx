import { useState } from 'react';
import type { SlotProps } from '@vendua/kernel';
import {
  dateTime,
  dayLabel,
  mediaSrcSet,
  money,
  ORDER_STATE_LABEL,
  PAYMENT_LABEL,
  time,
} from './format.ts';

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
  const drawer = presentation === 'drawer';
  const Title = drawer ? 'h2' : 'h1';
  return (
    <section
      className="v-cart"
      data-part="root"
      data-presentation={presentation}
      aria-label="Sacola"
    >
      <header className="v-cart-head" data-part="head">
        <Title className="v-page-title">Sacola</Title>
        <p className="v-muted">
          {cart.totals.itemCount} {cart.totals.itemCount === 1 ? 'item' : 'itens'}
        </p>
        {drawer ? (
          <button
            type="button"
            className="v-cart-close"
            data-part="close"
            onClick={onClose}
            aria-label="Fechar sacola"
          >
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
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
  max,
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
      <span className="v-line-thumb" data-part="thumb" aria-hidden="true">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <span>{item.name.slice(0, 1).toUpperCase()}</span>
        )}
      </span>
      <div className="v-line-main">
        <p className="v-line-name" data-part="name">
          {item.name}
        </p>
        {item.modifiers.length > 0 ? (
          <p className="v-muted v-line-mods" data-part="modifiers">
            {item.modifiers
              .map((m) => {
                const name = (m.qty ?? 1) > 1 ? `${m.qty}× ${m.name}` : m.name;
                return m.priceDeltaCents > 0
                  ? `${name} (+${money(m.priceDeltaCents, currency)})`
                  : name;
              })
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
            max={max ?? Math.max(item.qty, Math.min(99, item.stockQuantity ?? 99))}
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
        <li
          key={`${e.at}-${i}`}
          className="v-timeline-item"
          data-part="event"
          data-state={e.to}
          data-current={i === events.length - 1 || undefined}
        >
          <span className="v-timeline-label">{ORDER_STATE_LABEL[e.to] ?? e.to}</span>
          <time className="v-muted" dateTime={e.at}>
            {dateTime(e.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

const PAYMENT_STATUS: Record<string, string> = {
  paid: 'pago',
  pending: 'aguardando pagamento',
  failed: 'não aprovado',
  expired: 'expirado',
  refunded: 'devolvido',
  partially_refunded: 'devolvido em parte',
  in_mediation: 'em análise',
  charged_back: 'contestado',
};

export function OrderStatusPage({
  order,
  currency,
  timeline,
  pickup,
}: SlotProps['order.StatusPage']) {
  const d = order.delivery;
  const pay = order.payment;
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
      <OrderProgress state={order.state} mode={d.mode} />
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
                : (pickup?.address ?? 'Na loja')}
              {d.mode === 'pickup' && pickup?.instructions ? (
                <span className="v-order-fact-note v-muted" data-part="pickup-instructions">
                  {pickup.instructions}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Pagamento</dt>
            <dd>
              {PAYMENT_LABEL[pay.method] ?? pay.method}
              {/* online payments move on their own — say where it stands */}
              {pay.online && PAYMENT_STATUS[pay.status] ? (
                <span className="v-muted" data-part="payment-status">
                  {' '}
                  · {PAYMENT_STATUS[pay.status]}
                </span>
              ) : null}
            </dd>
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

/** The happy path as a glanceable track; cancelled/refunded orders skip it. */
function OrderProgress({ state, mode }: { state: string; mode: string }) {
  const path =
    mode === 'delivery'
      ? ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered']
      : ['placed', 'confirmed', 'preparing', 'ready', 'delivered'];
  const at = path.indexOf(state === 'ready' && mode === 'delivery' ? 'preparing' : state);
  if (at < 0) return null;
  const short: Record<string, string> = {
    placed: 'Recebido',
    confirmed: 'Confirmado',
    preparing: 'Preparo',
    ready: 'Pronto',
    out_for_delivery: 'A caminho',
    delivered: mode === 'delivery' ? 'Entregue' : 'Retirado',
  };
  return (
    <ol className="v-order-progress" data-part="progress" aria-hidden="true">
      {path.map((s, i) => (
        <li key={s} data-state={i < at ? 'done' : i === at ? 'current' : 'todo'}>
          <span>{short[s]}</span>
        </li>
      ))}
    </ol>
  );
}

const DAY = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
// Monday first — how a Brazilian storefront reads its week
const WEEK = [1, 2, 3, 4, 5, 6, 0];

function todayIn(timeZone: string | undefined): number {
  try {
    const wd = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date());
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  } catch {
    return new Date().getDay();
  }
}

/** Consecutive days with the same windows fold into one row ("Seg – Sex"). */
export function HoursTable({ hours }: SlotProps['store.HoursTable']) {
  const today = todayIn(hours.timezone);
  const text = (day: number) =>
    hours.windows
      .filter((w) => w.days.includes(day))
      .map((w) => `${w.open}–${w.close}`)
      .join(', ') || 'Fechado';
  const rows: { days: number[]; text: string }[] = [];
  for (const day of WEEK) {
    const t = text(day);
    const last = rows[rows.length - 1];
    if (last && last.text === t) last.days.push(day);
    else rows.push({ days: [day], text: t });
  }
  const label = (days: number[]) =>
    days.length === 7
      ? 'Todos os dias'
      : days.length === 1
        ? DAY[days[0]!]
        : `${DAY_SHORT[days[0]!]} – ${DAY_SHORT[days[days.length - 1]!]}`;
  return (
    <table className="v-hours" data-vendua="hours-table" data-part="root">
      <caption className="v-sr">Horário de funcionamento</caption>
      <tbody>
        {rows.map((r) => {
          const isToday = r.days.includes(today);
          return (
            <tr
              key={r.days.join()}
              data-part="row"
              data-today={isToday || undefined}
              data-closed={r.text === 'Fechado' || undefined}
            >
              <th scope="row">
                {label(r.days)}
                {isToday && r.days.length < 7 ? (
                  <span className="v-hours-today"> · hoje</span>
                ) : null}
              </th>
              <td className="v-num">{r.text}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const CARD_WIDTHS = [320, 480, 640];

export function ProductCard({
  product,
  currency,
  link,
  quickAdd,
  stockLeft,
}: SlotProps['catalog.ProductCard']) {
  const soldOut = product.status !== 'active';
  const [imgFailed, setImgFailed] = useState(false);
  const left = stockLeft ?? product.stockQuantity;
  const compareAt =
    product.compareAtPriceCents != null && product.compareAtPriceCents > product.basePriceCents
      ? product.compareAtPriceCents
      : null;
  const badge = soldOut
    ? null
    : product.requiresPreorder
      ? { tone: 'surface', text: 'Encomenda' }
      : left === 0
        ? { tone: 'surface', text: 'Tudo na sacola' }
        : product.lowStock && typeof left === 'number' && left > 0
          ? { tone: 'danger', text: left === 1 ? 'Última unidade' : `Últimas ${left}` }
          : null;
  return (
    <article className="v-card" data-part="root" data-status={product.status}>
      {link(
        <>
          <div
            className="v-card-media"
            data-part="media"
            data-vt-src={`product:${product.slug}`}
            aria-hidden="true"
          >
            {badge ? (
              <span className="v-card-badge" data-part="badge" data-tone={badge.tone}>
                {badge.text}
              </span>
            ) : null}
            {product.imageUrl && !imgFailed ? (
              <img
                src={product.imageUrl}
                {...(mediaSrcSet(product.imageUrl, CARD_WIDTHS)
                  ? {
                      srcSet: mediaSrcSet(product.imageUrl, CARD_WIDTHS),
                      sizes: '(max-width: 599px) 50vw, 240px',
                    }
                  : {})}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <span className="v-card-initial" data-figure={product.figureVariant}>
                <span>{product.name.slice(0, 1).toUpperCase()}</span>
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
            {soldOut && product.availabilityLabel ? (
              <span className="v-flag" data-part="availability">
                {product.availabilityLabel}
              </span>
            ) : soldOut ? (
              <span className="v-flag">Esgotado</span>
            ) : (
              <>
                <span className="v-card-amount">
                  {compareAt !== null ? (
                    <>
                      <s className="v-compare-at" data-part="compare-at">
                        <span className="v-sr">de </span>
                        {money(compareAt, currency)}
                      </s>{' '}
                      <span className="v-sr">por </span>
                    </>
                  ) : null}
                  {money(product.basePriceCents, currency)}
                </span>
                {quickAdd ? null : (
                  <span className="v-card-go" aria-hidden="true">
                    +
                  </span>
                )}
              </>
            )}
          </p>
        </>,
      )}
      {quickAdd
        ? quickAdd(
            <span className="v-card-quick" data-part="quick-add" aria-hidden="true">
              +
            </span>,
          )
        : null}
    </article>
  );
}

const PRICING_RULE_HINT: Record<string, string> = {
  most_expensive: 'Vale o preço da opção mais cara.',
  average: 'Vale a média dos preços escolhidos.',
};

export function ModifierPicker({
  groups,
  value,
  onChange,
  currency,
  errors,
  quantities = {},
  onQtyChange,
}: SlotProps['catalog.ModifierPicker']) {
  const delta = (cents: number) =>
    cents !== 0 ? (
      <span className="v-muted v-num">
        {' '}
        {cents > 0 ? '+' : '−'}
        {money(Math.abs(cents), currency)}
      </span>
    ) : null;
  return (
    <div className="v-mods" data-vendua="modifier-picker" data-part="root">
      {groups.map((g) => {
        const single = g.maxSelect === 1;
        const sel = value[g.id] ?? [];
        // a group's min/max count units: an option picked twice takes two
        const units = sel.reduce((n, id) => n + (quantities[id] ?? 1), 0);
        const hint = g.required
          ? single
            ? 'obrigatório'
            : `escolha ${Math.max(1, g.minSelect)}–${g.maxSelect}`
          : single
            ? 'opcional'
            : `até ${g.maxSelect}`;
        const rule =
          g.pricingRule && !single && g.modifiers.some((m) => m.priceDeltaCents !== 0)
            ? PRICING_RULE_HINT[g.pricingRule]
            : undefined;
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
            {rule ? (
              <p className="v-mod-rule v-muted" data-part="pricing-rule">
                {rule}
              </p>
            ) : null}
            <ul className="v-mod-list" role={single ? 'radiogroup' : 'group'} aria-label={g.name}>
              {g.modifiers.map((m) => {
                const on = sel.includes(m.id);
                const soldOut = m.status !== 'active';
                const text = (
                  <>
                    {m.imageUrl ? (
                      <img
                        className="v-mod-thumb"
                        data-part="option-image"
                        src={m.imageUrl}
                        alt=""
                        width={40}
                        height={40}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                    <span className="v-mod-text">
                      <span>
                        {m.name}
                        {soldOut ? <span className="v-muted"> · esgotado</span> : null}
                      </span>
                      {m.description ? (
                        <span className="v-mod-desc v-muted" data-part="option-description">
                          {m.description}
                        </span>
                      ) : null}
                    </span>
                  </>
                );
                if (onQtyChange && (m.maxQty ?? 1) > 1 && !single) {
                  const q = on ? (quantities[m.id] ?? 1) : 0;
                  return (
                    <li key={m.id}>
                      <div
                        className="v-mod"
                        data-part="modifier"
                        data-kind="qty"
                        data-selected={q > 0 || undefined}
                        data-disabled={soldOut || undefined}
                      >
                        {text}
                        <span className="v-mod-end">
                          {delta(m.priceDeltaCents)}
                          <span
                            className="v-qty v-mod-qty"
                            role="group"
                            aria-label={`Quantidade de ${m.name}`}
                            data-part="option-qty"
                          >
                            <button
                              type="button"
                              aria-label={`Tirar um ${m.name}`}
                              disabled={q <= 0}
                              onClick={() => onQtyChange(g.id, m.id, q - 1)}
                            >
                              −
                            </button>
                            <output aria-live="polite">{q}</output>
                            <button
                              type="button"
                              aria-label={`Mais um ${m.name}`}
                              disabled={soldOut || q >= (m.maxQty ?? 1) || units >= g.maxSelect}
                              onClick={() => onQtyChange(g.id, m.id, q + 1)}
                            >
                              +
                            </button>
                          </span>
                        </span>
                      </div>
                    </li>
                  );
                }
                const capped = !on && !single && units >= g.maxSelect;
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
                      {text}
                      {delta(m.priceDeltaCents)}
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
