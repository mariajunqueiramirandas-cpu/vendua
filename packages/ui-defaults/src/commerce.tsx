import { useId, useState } from 'react';
import type { SlotProps } from '@vendua/kernel';
import {
  cardState,
  DEFAULT_VOCABULARY,
  dietaryBadges,
  foldText,
  formatCents,
  formatDateTime,
  formatDay,
  formatTime,
  groupFull,
  groupHint,
  hoursRows,
  lineSummary,
  MAX_LINE_QTY,
  mediaSrcSet,
  modifierMax,
  modifierUnits,
  orderProgress,
  orderStateLabel,
  orderStepLabel,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  plural,
  priceDisplay,
  TERMINAL_ORDER_STATES,
  todayHours,
} from '@vendua/kernel/rules';
import { capitalize } from './format.ts';

// cart.*, order.*, store.*, catalog.* defaults.

export function QtyControl({
  qty,
  min = 0,
  max = MAX_LINE_QTY,
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
  vocabulary = DEFAULT_VOCABULARY,
}: SlotProps['cart.Drawer']) {
  const drawer = presentation === 'drawer';
  const Title = drawer ? 'h2' : 'h1';
  const n = cart.totals.itemCount;
  return (
    <section
      className="v-cart"
      data-part="root"
      data-presentation={presentation}
      aria-label={capitalize(vocabulary.bag)}
    >
      <header className="v-cart-head" data-part="head">
        <Title className="v-page-title">{capitalize(vocabulary.bag)}</Title>
        <p className="v-muted">
          {n} {plural(n, vocabulary.itemSingular, vocabulary.itemPlural)}
        </p>
        {drawer ? (
          <button
            type="button"
            className="v-cart-close"
            data-part="close"
            onClick={onClose}
            aria-label={`Fechar ${vocabulary.bag}`}
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
  onNote,
  noteMax = 140,
}: SlotProps['cart.LineItem']) {
  const unavailable = item.productStatus !== 'active';
  // Kernel 1.21 — the line's note, edited in place
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const noteId = useId();
  const save = () => {
    setEditing(false);
    onNote?.(note);
  };
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
            {lineSummary({ modifiers: item.modifiers }, currency)}
          </p>
        ) : null}
        {item.combo?.length ? (
          <p className="v-muted v-line-mods" data-part="combo">
            {lineSummary({ modifiers: [], combo: item.combo }, currency)}
          </p>
        ) : null}
        {item.note && !editing ? (
          <p className="v-line-note" data-part="note">
            <span className="v-sr">Observação: </span>
            {item.note}
          </p>
        ) : null}
        {editing ? (
          <div className="v-line-note-edit" data-part="note-edit">
            <label className="v-label" htmlFor={noteId}>
              Observação
            </label>
            <textarea
              id={noteId}
              className="v-input v-textarea"
              rows={2}
              maxLength={noteMax}
              placeholder="Ex.: sem cebola"
              value={note}
              autoFocus
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
              }}
            />
            <div className="v-line-note-bar">
              <span className="v-muted v-num v-counter" aria-hidden="true">
                {note.length}/{noteMax}
              </span>
              <button type="button" className="v-link-btn" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="v-btn v-btn-ghost"
                data-part="note-save"
                disabled={pending}
                onClick={save}
              >
                Salvar
              </button>
            </div>
          </div>
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
            max={
              max ?? Math.max(item.qty, Math.min(MAX_LINE_QTY, item.stockQuantity ?? MAX_LINE_QTY))
            }
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
          {onNote && !editing ? (
            <button
              type="button"
              className="v-link-btn"
              data-part="note-toggle"
              aria-label={`${item.note ? 'Editar a observação de' : 'Adicionar observação a'} ${item.name}`}
              disabled={pending}
              onClick={() => {
                setNote(item.note ?? '');
                setEditing(true);
              }}
            >
              {item.note ? 'Editar observação' : 'Observação'}
            </button>
          ) : null}
        </div>
      </div>
      <p className="v-line-total v-num" data-part="total">
        {formatCents(item.lineTotalCents, currency)}
      </p>
    </li>
  );
}

export function OrderTimeline({ events, mode, timeZone }: SlotProps['order.Timeline']) {
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
          <span className="v-timeline-label">{orderStateLabel(e.to, mode)}</span>
          <time className="v-muted" dateTime={e.at}>
            {formatDateTime(e.at, timeZone)}
          </time>
        </li>
      ))}
    </ol>
  );
}

export function OrderStatusPage({
  order,
  currency,
  timeline,
  pickup,
  timeZone,
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
          {orderStateLabel(order.state, d.mode)}
        </h1>
        {order.scheduledFor ? (
          <p className="v-muted" data-part="scheduled">
            Encomenda para {formatDay(order.scheduledFor)}
          </p>
        ) : d.promisedTo && !TERMINAL_ORDER_STATES.has(order.state) ? (
          <p className="v-muted" data-part="promise">
            {d.mode === 'delivery'
              ? 'Chega'
              : d.mode === 'dine_in'
                ? 'Fica pronto'
                : 'Pronto para retirar'}{' '}
            {d.promisedFrom && d.promisedFrom !== d.promisedTo
              ? `entre ${formatTime(d.promisedFrom, timeZone)} e ${formatTime(d.promisedTo, timeZone)}`
              : `por volta de ${formatTime(d.promisedTo, timeZone)}`}
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
          {d.mode === 'dine_in' ? (
            <div data-part="table">
              <dt>Na mesa</dt>
              <dd>{d.table ?? 'No salão'}</dd>
            </div>
          ) : (
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
          )}
          <div>
            <dt>Pagamento</dt>
            <dd>
              {PAYMENT_METHOD_LABEL[pay.method] ?? pay.method}
              {/* online payments move on their own — say where it stands */}
              {pay.online && PAYMENT_STATUS_LABEL[pay.status] ? (
                <span className="v-muted" data-part="payment-status">
                  {' '}
                  · {PAYMENT_STATUS_LABEL[pay.status]}
                </span>
              ) : null}
              {pay.method === 'cash' && pay.changeForCents ? (
                <span className="v-order-fact-note v-muted v-num" data-part="change-for">
                  Troco para {formatCents(pay.changeForCents, currency)}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd className="v-num">{formatCents(order.totalCents, currency)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

/** Kernel 1.21 — the order through the link in the store's WhatsApp: where it stands and what
 *  was ordered. Nothing personal reaches this page, and no money. */
export function OrderTrackingPage({
  order,
  timeline,
  pickup,
  timeZone,
}: SlotProps['order.TrackingPage']) {
  const d = order.delivery;
  return (
    <section
      className="v-order v-tracking"
      data-vendua="order-tracking"
      data-part="root"
      data-state={order.state}
    >
      <header className="v-order-head" data-part="head">
        <p className="v-eyebrow">
          {order.storeName ? `${order.storeName} · ` : ''}Pedido #{order.number}
        </p>
        <h1 className="v-page-title" data-part="state">
          {orderStateLabel(order.state, d.mode)}
        </h1>
        {order.scheduledFor ? (
          <p className="v-muted" data-part="scheduled">
            Encomenda para {formatDay(order.scheduledFor)}
          </p>
        ) : d.promisedTo && !TERMINAL_ORDER_STATES.has(order.state) ? (
          <p className="v-muted" data-part="promise">
            {d.mode === 'delivery'
              ? 'Chega'
              : d.mode === 'dine_in'
                ? 'Fica pronto'
                : 'Pronto para retirar'}{' '}
            {d.promisedFrom && d.promisedFrom !== d.promisedTo
              ? `entre ${formatTime(d.promisedFrom, timeZone)} e ${formatTime(d.promisedTo, timeZone)}`
              : `por volta de ${formatTime(d.promisedTo, timeZone)}`}
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
        <div className="v-tracking-side">
          <div className="v-panel v-tracking-items" data-part="items">
            <h2 className="v-panel-title">Itens</h2>
            <ul className="v-summary-lines">
              {order.items.map((i, k) => (
                <li key={k} className="v-summary-line">
                  <span>
                    {i.qty}× {i.name}
                    {i.modifiers.length || i.combo.length ? (
                      <span className="v-muted v-line-mods">
                        {' '}
                        —{' '}
                        {lineSummary({
                          modifiers: i.modifiers.map((m) => ({ ...m, priceDeltaCents: 0 })),
                          combo: i.combo,
                        })}
                      </span>
                    ) : null}
                    {i.note ? (
                      <span className="v-line-note" data-part="item-note">
                        <span className="v-sr">Observação: </span>
                        {i.note}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <dl className="v-order-facts" data-part="facts">
            {d.mode === 'dine_in' ? (
              <div data-part="table">
                <dt>Na mesa</dt>
                <dd>{d.table ?? 'No salão'}</dd>
              </div>
            ) : (
              <div>
                <dt>{d.mode === 'delivery' ? 'Entrega' : 'Retirada'}</dt>
                <dd>
                  {d.mode === 'delivery' ? 'No endereço do pedido' : (pickup?.address ?? 'Na loja')}
                  {d.mode === 'pickup' && pickup?.instructions ? (
                    <span className="v-order-fact-note v-muted" data-part="pickup-instructions">
                      {pickup.instructions}
                    </span>
                  ) : null}
                </dd>
              </div>
            )}
          </dl>
          <p className="v-muted v-tracking-privacy" data-part="privacy">
            Este link mostra o andamento do pedido. Endereço e pagamento ficam só no aparelho em que
            ele foi feito.
          </p>
        </div>
      </div>
    </section>
  );
}

/** The happy path as a glanceable track; cancelled/refunded orders skip it. */
function OrderProgress({
  state,
  mode,
}: {
  state: string;
  mode: SlotProps['order.StatusPage']['order']['delivery']['mode'];
}) {
  const progress = orderProgress({ state, mode });
  if (progress.outcome || progress.current < 0) return null;
  return (
    <ol className="v-order-progress" data-part="progress" aria-hidden="true">
      {progress.steps.map((s) => (
        <li key={s.state} data-state={s.status}>
          <span>{orderStepLabel(s.state, mode)}</span>
        </li>
      ))}
    </ol>
  );
}

const hoursText = (windows: { open: string; close: string }[]) =>
  windows.map((w) => `${w.open}–${w.close}`).join(', ') || 'Fechado';

/** Consecutive days with the same windows fold into one row ("Seg – Sex"); a special day
 *  today (a holiday, a short day) gets its own row and takes "hoje" from the week. */
export function HoursTable({ hours }: SlotProps['store.HoursTable']) {
  const today = todayHours(hours);
  const special = today.special;
  return (
    <table className="v-hours" data-vendua="hours-table" data-part="root">
      <caption className="v-sr">Horário de funcionamento</caption>
      <tbody>
        {special ? (
          <tr data-part="special" data-today data-closed={today.closed || undefined}>
            <th scope="row">
              Hoje
              {special.label ? <span className="v-hours-today"> · {special.label}</span> : null}
            </th>
            <td className="v-num">{hoursText(today.windows)}</td>
          </tr>
        ) : null}
        {hoursRows(hours).map((r) => {
          const isToday = r.today && !special;
          return (
            <tr
              key={r.days.join()}
              data-part="row"
              data-today={isToday || undefined}
              data-closed={r.closed || undefined}
            >
              <th scope="row">
                {r.label}
                {isToday && r.days.length < 7 ? (
                  <span className="v-hours-today"> · hoje</span>
                ) : null}
              </th>
              <td className="v-num">{hoursText(r.windows)}</td>
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
  vocabulary = DEFAULT_VOCABULARY,
}: SlotProps['catalog.ProductCard']) {
  const [imgFailed, setImgFailed] = useState(false);
  const state = cardState(product, stockLeft ?? null);
  const price = priceDisplay(product);
  // Kernel 1.21 — what the product is (vegano, sem glúten, apimentado); allergen warnings are on
  // its page, in full
  const diets = dietaryBadges(product)
    .filter((b) => b.kind !== 'allergen')
    .slice(0, 3);
  // sold out says so in the price row instead
  const badge =
    state.badge === 'all-in-bag'
      ? { tone: 'surface', text: `Tudo ${vocabulary.inBag}` }
      : state.badge === 'low-stock'
        ? {
            tone: 'danger',
            text: state.stockLeft === 1 ? 'Última unidade' : `Últimas ${state.stockLeft}`,
          }
        : state.badge === 'preorder'
          ? { tone: 'surface', text: 'Encomenda' }
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
              <span
                className="v-card-badge"
                data-part="badge"
                data-badge={state.badge}
                data-tone={badge.tone}
              >
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
          {diets.length ? (
            <ul className="v-diet v-card-diet" data-part="dietary">
              {diets.map((b) => (
                <li key={b.tag} className="v-diet-badge" data-kind={b.kind} data-tag={b.tag}>
                  {b.label}
                </li>
              ))}
            </ul>
          ) : null}
          <p
            className="v-card-price v-num"
            data-part="price"
            data-form={state.soldOut ? undefined : price.form}
          >
            {state.scheduleLabel ? (
              <span className="v-flag" data-part="availability">
                {state.scheduleLabel}
              </span>
            ) : state.soldOut ? (
              <span className="v-flag">Esgotado</span>
            ) : (
              <>
                <span className="v-card-amount">
                  {price.struckCents !== null ? (
                    <>
                      <s className="v-compare-at" data-part="compare-at">
                        <span className="v-sr">de </span>
                        {formatCents(price.struckCents, currency)}
                      </s>{' '}
                      <span className="v-sr">por </span>
                    </>
                  ) : null}
                  {price.form === 'from' ? (
                    <span className="v-price-from" data-part="from">
                      a partir de{' '}
                    </span>
                  ) : null}
                  {formatCents(price.cents, currency)}
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

// Kernel 1.13 — a group with more options than this gets a filter above them
const FILTER_FROM = 12;

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
  const uid = useId();
  // per group; a filtered-out pick stays in `value`
  const [queries, setQueries] = useState<Record<string, string>>({});
  const setQuery = (gid: string, q: string) => setQueries((x) => ({ ...x, [gid]: q }));
  const delta = (cents: number) =>
    cents !== 0 ? (
      <span className="v-muted v-num">
        {' '}
        {cents > 0 ? '+' : '−'}
        {formatCents(Math.abs(cents), currency)}
      </span>
    ) : null;
  return (
    <div className="v-mods" data-vendua="modifier-picker" data-part="root">
      {groups.map((g) => {
        const single = g.maxSelect === 1;
        const sel = value[g.id] ?? [];
        // a group's min/max count units: an option picked twice takes two
        const picks = Object.fromEntries(sel.map((id) => [id, quantities[id] ?? 1]));
        const full = groupFull(g, modifierUnits(g, picks));
        const rule =
          g.pricingRule && !single && g.modifiers.some((m) => m.priceDeltaCents !== 0)
            ? PRICING_RULE_HINT[g.pricingRule]
            : undefined;
        const filterable = g.modifiers.length > FILTER_FROM;
        const raw = filterable ? (queries[g.id] ?? '') : '';
        const terms = foldText(raw).split(/\s+/).filter(Boolean);
        const mods = terms.length
          ? g.modifiers.filter((m) => {
              const hay = foldText(`${m.name} ${m.description ?? ''}`);
              return terms.every((t) => hay.includes(t));
            })
          : g.modifiers;
        const flavours = /sabor/.test(foldText(g.name));
        const [one, many] = flavours ? ['sabor', 'sabores'] : ['opção', 'opções'];
        const listId = `${uid}-${g.id}-list`;
        const hitsId = `${uid}-${g.id}-hits`;
        const away = terms.length
          ? g.modifiers.filter((m) => sel.includes(m.id) && !mods.includes(m)).map((m) => m.name)
          : [];
        return (
          <fieldset
            key={g.id}
            className="v-mod-group"
            data-part="group"
            data-invalid={errors[g.id] ? true : undefined}
          >
            <legend className="v-legend">
              {g.name} <span className="v-muted">— {groupHint(g)}</span>
            </legend>
            {rule ? (
              <p className="v-mod-rule v-muted" data-part="pricing-rule">
                {rule}
              </p>
            ) : null}
            {filterable ? (
              <div className="v-mod-search" data-part="option-search">
                <div className="v-search-field">
                  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                    <circle
                      cx="8.5"
                      cy="8.5"
                      r="5.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      d="m13 13 4 4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  <input
                    type="search"
                    className="v-input"
                    value={raw}
                    maxLength={60}
                    placeholder={flavours ? 'Buscar sabor' : 'Buscar opção'}
                    aria-label={`Buscar em ${g.name}`}
                    aria-controls={listId}
                    aria-describedby={hitsId}
                    autoComplete="off"
                    enterKeyHint="search"
                    onChange={(e) => setQuery(g.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.preventDefault();
                      // the first Escape clears; the next one may close the sheet
                      if (e.key === 'Escape' && raw) {
                        e.preventDefault();
                        e.stopPropagation();
                        setQuery(g.id, '');
                      }
                    }}
                  />
                  {raw ? (
                    <button
                      type="button"
                      className="v-search-clear"
                      aria-label="Limpar busca"
                      onClick={() => setQuery(g.id, '')}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <p id={hitsId} className="v-mod-hits v-muted" role="status">
                  {terms.length
                    ? `${
                        mods.length === 0
                          ? `Nenhum resultado para “${raw.trim()}”`
                          : `${mods.length} ${plural(mods.length, one, many)}`
                      }${away.length ? ` · na sua escolha: ${away.join(', ')}` : ''}`
                    : ''}
                </p>
              </div>
            ) : null}
            <ul
              id={listId}
              className="v-mod-list"
              role={single ? 'radiogroup' : 'group'}
              aria-label={g.name}
            >
              {mods.map((m) => {
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
                              disabled={soldOut || q >= modifierMax(g, m.id, picks)}
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
                const capped = !on && !single && full;
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
