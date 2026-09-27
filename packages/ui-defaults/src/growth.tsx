import { useMemo, useState } from 'react';
import type { SlotProps } from '@vendua/kernel';
import { COUPON_REASON, dayLabel, money } from './format.ts';
import { qrMatrix, qrSvgPath } from './qr.ts';

// Kernel 1.2 slot defaults — kits, gallery, coupons, encomendas, notes, Pix,
// order items, loyalty card, phone verification. Presentational only.

export function ComboPicker({
  slots,
  value,
  onChange,
  currency,
  errors,
}: SlotProps['catalog.ComboPicker']) {
  const qtyOf = (slotId: string, productId: string) =>
    value.find((v) => v.slotId === slotId && v.productId === productId)?.qty ?? 0;
  const set = (slotId: string, productId: string, qty: number) => {
    const rest = value.filter((v) => !(v.slotId === slotId && v.productId === productId));
    onChange(qty > 0 ? [...rest, { slotId, productId, qty }] : rest);
  };
  return (
    <div className="v-combo" data-vendua="combo-picker" data-part="root">
      {slots.map((slot) => {
        const chosen = value.filter((v) => v.slotId === slot.id).reduce((n, v) => n + v.qty, 0);
        const full = chosen >= slot.maxSelect;
        const hint =
          slot.minSelect === slot.maxSelect
            ? `escolha ${slot.maxSelect}`
            : `escolha de ${slot.minSelect} a ${slot.maxSelect}`;
        return (
          <fieldset
            key={slot.id}
            className="v-mod-group"
            data-part="slot"
            data-complete={chosen >= slot.minSelect || undefined}
            data-invalid={errors[slot.id] ? true : undefined}
          >
            <legend className="v-legend">
              {slot.name} <span className="v-muted">— {hint}</span>{' '}
              <span className="v-combo-count v-num" data-part="count" aria-live="polite">
                {chosen}/{slot.maxSelect}
              </span>
            </legend>
            <ul className="v-combo-list">
              {slot.items.map((item) => {
                const q = qtyOf(slot.id, item.productId);
                const soldOut = item.status !== 'active';
                const cap = Math.min(
                  slot.qtyPerItem,
                  item.stockQuantity ?? Number.POSITIVE_INFINITY,
                );
                return (
                  <li
                    key={item.productId}
                    className="v-combo-item"
                    data-part="item"
                    data-selected={q > 0 || undefined}
                    data-status={item.status}
                  >
                    <span className="v-combo-name">
                      {item.name}
                      {item.priceDeltaCents !== 0 ? (
                        <span className="v-muted v-num">
                          {' '}
                          {item.priceDeltaCents > 0 ? '+' : '−'}
                          {money(Math.abs(item.priceDeltaCents), currency)}
                        </span>
                      ) : null}
                      {soldOut ? <span className="v-muted"> · esgotado</span> : null}
                    </span>
                    <span className="v-qty" role="group" aria-label={`quantidade de ${item.name}`}>
                      <button
                        type="button"
                        aria-label={`menos ${item.name}`}
                        disabled={q === 0}
                        onClick={() => set(slot.id, item.productId, q - 1)}
                      >
                        −
                      </button>
                      <output aria-live="polite">{q}</output>
                      <button
                        type="button"
                        aria-label={`mais ${item.name}`}
                        disabled={soldOut || full || q >= cap}
                        onClick={() => set(slot.id, item.productId, q + 1)}
                      >
                        +
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
            {errors[slot.id] ? (
              <p className="v-field-error" role="alert">
                {errors[slot.id]}
              </p>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}

export function Gallery({
  images,
  productName: name,
  figureVariant,
}: SlotProps['catalog.Gallery']) {
  const [i, setI] = useState(0);
  const cur = images[Math.min(i, images.length - 1)];
  if (!cur)
    return (
      <span className="v-card-initial" aria-hidden="true" data-figure={figureVariant}>
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  return (
    <div className="v-gallery" data-vendua="gallery" data-part="root">
      <img
        src={cur.url}
        alt={cur.alt ?? name}
        {...{ fetchpriority: i === 0 ? 'high' : 'auto' }}
        decoding="async"
        data-part="main"
      />
      {images.length > 1 ? (
        <ol className="v-gallery-thumbs" data-part="thumbs" aria-label="Fotos">
          {images.map((img, k) => (
            <li key={img.url}>
              <button
                type="button"
                aria-label={`Foto ${k + 1} de ${images.length}`}
                aria-current={k === i || undefined}
                onClick={() => setI(k)}
              >
                <img src={img.url} alt="" loading="lazy" decoding="async" />
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function CouponField({
  coupon,
  discountCents,
  currency,
  pending,
  error,
  onApply,
  onRemove,
}: SlotProps['checkout.CouponField']) {
  const [code, setCode] = useState('');
  if (coupon)
    return (
      <div
        className="v-coupon"
        data-vendua="coupon"
        data-part="root"
        data-applies={coupon.applies || undefined}
      >
        <p>
          <strong className="v-coupon-code">{coupon.code}</strong> · {coupon.label}
          {coupon.applies && discountCents > 0 ? (
            <span className="v-num"> (−{money(discountCents, currency)})</span>
          ) : null}
        </p>
        {!coupon.applies && coupon.reason ? (
          <p className="v-muted" role="status" data-part="reason">
            {coupon.reason === 'COUPON_MIN_SUBTOTAL' &&
            typeof coupon.details?.remainingCents === 'number'
              ? `Faltam ${money(coupon.details.remainingCents, currency)} para usar este cupom.`
              : (COUPON_REASON[coupon.reason] ?? 'Este cupom não vale agora.')}
          </p>
        ) : null}
        <button
          type="button"
          className="v-link-btn"
          data-part="remove"
          disabled={pending}
          onClick={onRemove}
        >
          Remover cupom
        </button>
      </div>
    );
  // not a <form>: this renders inside the checkout form, and nested forms submit the order
  const apply = () => {
    if (code.trim()) onApply(code.trim());
  };
  return (
    <div className="v-coupon" data-vendua="coupon" data-part="root" role="group" aria-label="Cupom">
      <label className="v-label" htmlFor="v-coupon-code">
        Cupom de desconto
      </label>
      <div className="v-notify-row">
        <input
          id="v-coupon-code"
          name="coupon"
          className="v-input"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={32}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'v-coupon-error' : undefined}
        />
        <button
          type="button"
          className="v-btn v-btn-ghost"
          disabled={pending || !code.trim()}
          onClick={apply}
        >
          Aplicar
        </button>
      </div>
      {error ? (
        <p className="v-field-error" id="v-coupon-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SchedulePicker({
  dates,
  value,
  onChange,
  required,
  leadDays,
  error,
}: SlotProps['checkout.SchedulePicker']) {
  const shown = dates.slice(0, 21);
  return (
    <fieldset className="v-fieldset" data-vendua="schedule" data-part="root">
      <legend className="v-legend">
        {required ? 'Data da encomenda' : 'Agendar pedido (opcional)'}
      </legend>
      {required && leadDays > 0 ? (
        <p className="v-muted">
          Encomendas pedem {leadDays} {leadDays === 1 ? 'dia' : 'dias'} de antecedência.
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className="v-alert" role="status">
          Sem datas disponíveis agora.
        </p>
      ) : (
        <div className="v-dates" role="radiogroup" aria-label="Datas disponíveis">
          {shown.map((d) => (
            <label key={d} className="v-option v-date" data-selected={d === value || undefined}>
              <input
                type="radio"
                name="scheduled-for"
                value={d}
                checked={d === value}
                onChange={() => onChange(d)}
              />
              <span className="v-option-label">{dayLabel(d)}</span>
            </label>
          ))}
        </div>
      )}
      {error ? (
        <p className="v-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export function Notes({ value, onChange, max }: SlotProps['checkout.Notes']) {
  return (
    <div className="v-field" data-vendua="order-notes" data-part="root">
      <label className="v-label" htmlFor="checkout-notes">
        Alguma observação? <span className="v-muted">(opcional)</span>
      </label>
      <textarea
        id="checkout-notes"
        name="notes"
        className="v-input v-textarea"
        rows={3}
        maxLength={max}
        placeholder="Ex.: sem granulado, tocar o interfone 2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="v-muted v-num v-counter" aria-live="polite">
        {value.length}/{max}
      </p>
    </div>
  );
}

export function PixQr({ payload, label }: { payload: string; label: string }) {
  const path = useMemo(() => {
    try {
      return qrSvgPath(qrMatrix(payload));
    } catch {
      return null;
    }
  }, [payload]);
  if (!path) return null;
  return (
    <svg
      className="v-qr"
      data-part="qr"
      viewBox={`0 0 ${path.size} ${path.size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

export function PixPayment({
  copyPaste,
  beneficiary,
  keyLabel,
  amountCents,
  currency,
}: SlotProps['checkout.PixPayment']) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked — the text stays selectable */
    }
  };
  return (
    <section
      className="v-panel v-pix"
      data-vendua="pix"
      data-part="root"
      aria-label="Pagar com Pix"
    >
      <h2 className="v-panel-title">
        Pix{amountCents ? <span className="v-num"> · {money(amountCents, currency)}</span> : null}
      </h2>
      <PixQr payload={copyPaste} label="QR code Pix" />
      <p className="v-muted" data-part="beneficiary">
        Para {beneficiary}
        {keyLabel ? ` · ${keyLabel}` : ''}
      </p>
      <label className="v-label" htmlFor="v-pix-code">
        Pix copia e cola
      </label>
      <textarea
        id="v-pix-code"
        className="v-input v-pix-code"
        readOnly
        rows={3}
        value={copyPaste}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" className="v-btn v-btn-accent" data-part="copy" onClick={copy}>
        {copied ? 'Copiado!' : 'Copiar código Pix'}
      </button>
    </section>
  );
}

export function OrderItems({
  items,
  currency,
  notes,
  scheduledFor,
  discountCents,
  couponCode,
  onReorder,
  reorderPending,
}: SlotProps['order.Items']) {
  return (
    <section className="v-panel v-order-items" data-vendua="order-items" data-part="root">
      <h2 className="v-panel-title">Itens</h2>
      <ul className="v-summary-lines" data-part="lines">
        {items.map((i, k) => (
          <li key={`${i.slug}-${k}`} className="v-summary-line">
            <span>
              {i.qty}× {i.name}
              {i.modifiers.length ? (
                <span className="v-muted v-line-mods">
                  {' '}
                  — {i.modifiers.map((m) => m.name).join(', ')}
                </span>
              ) : null}
              {i.combo.length ? (
                <span className="v-muted v-line-mods">
                  {' '}
                  — {i.combo.map((c) => `${c.qty}× ${c.name}`).join(', ')}
                </span>
              ) : null}
            </span>
            <span className="v-num">{money(i.lineTotalCents, currency)}</span>
          </li>
        ))}
        {discountCents ? (
          <li className="v-summary-line" data-part="discount">
            <span>Desconto{couponCode ? ` (${couponCode})` : ''}</span>
            <span className="v-num">−{money(discountCents, currency)}</span>
          </li>
        ) : null}
      </ul>
      {scheduledFor ? (
        <p className="v-note" data-part="scheduled">
          Encomenda para {dayLabel(scheduledFor)}
        </p>
      ) : null}
      {notes ? (
        <p className="v-note" data-part="notes">
          Observação: {notes}
        </p>
      ) : null}
      {onReorder ? (
        <button
          type="button"
          className="v-btn v-btn-ghost"
          data-part="reorder"
          disabled={reorderPending}
          onClick={onReorder}
        >
          {reorderPending ? 'Colocando na sacola…' : 'Pedir de novo'}
        </button>
      ) : null}
    </section>
  );
}

export function LoyaltyCard({ card, currency }: SlotProps['customer.LoyaltyCard']) {
  if (!card.enabled) return null;
  return (
    <section className="v-panel v-loyalty" data-vendua="loyalty-card" data-part="root">
      <h2 className="v-panel-title">Cartão fidelidade</h2>
      <p className="v-muted">
        A cada {card.stampsRequired} pedidos entregues
        {card.minOrderCents > 0
          ? ` (a partir de ${money(card.minOrderCents, currency)})`
          : ''}: {card.rewardLabel}.
      </p>
      <ol
        className="v-stamps"
        data-part="stamps"
        aria-label={`${card.stamps} de ${card.stampsRequired} selos`}
      >
        {Array.from({ length: card.stampsRequired }, (_, k) => (
          <li key={k} data-filled={k < card.stamps || undefined} aria-hidden="true" />
        ))}
      </ol>
      {card.rewards.length ? (
        <ul className="v-rewards" data-part="rewards">
          {card.rewards.map((r) => (
            <li key={r.code}>
              <strong className="v-coupon-code">{r.code}</strong> — {r.label}
              {r.expiresAt ? (
                <span className="v-muted">
                  {' '}
                  · até {new Date(r.expiresAt).toLocaleDateString('pt-BR')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function PhoneVerify({
  phone,
  pending,
  error,
  onSubmit,
}: SlotProps['customer.PhoneVerify']) {
  const [p, setP] = useState(phone);
  const [n, setN] = useState('');
  return (
    <form
      className="v-panel v-verify"
      data-vendua="phone-verify"
      data-part="root"
      onSubmit={(e) => {
        e.preventDefault();
        const num = Number(n.replace(/\D/g, ''));
        if (p.trim() && num > 0) onSubmit(p.trim(), num);
      }}
    >
      <h2 className="v-panel-title">Ver pedidos de outros aparelhos</h2>
      <p className="v-muted">Sem senha: informe seu WhatsApp e o número de um pedido seu.</p>
      <div className="v-field-row">
        <div className="v-field">
          <label className="v-label" htmlFor="v-verify-phone">
            WhatsApp
          </label>
          <input
            id="v-verify-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="v-input"
            maxLength={20}
            value={p}
            onChange={(e) => setP(e.target.value)}
          />
        </div>
        <div className="v-field">
          <label className="v-label" htmlFor="v-verify-number">
            Nº do pedido
          </label>
          <input
            id="v-verify-number"
            inputMode="numeric"
            className="v-input v-input-short"
            maxLength={8}
            value={n}
            onChange={(e) => setN(e.target.value)}
          />
        </div>
      </div>
      {error ? (
        <p className="v-field-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="v-btn v-btn-accent" disabled={pending}>
        {pending ? 'Conferindo…' : 'Ver meus pedidos'}
      </button>
    </form>
  );
}
