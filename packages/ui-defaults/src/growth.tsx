import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SlotProps } from '@vendua/kernel';
import {
  adjustmentKind,
  countdown,
  couponMessage,
  DEFAULT_VOCABULARY,
  formatCents,
  formatDay,
  lineSummary,
  localNow,
  maskPhone,
  mediaSrcSet,
  plural,
  qrMatrix,
  qrSvgPath,
  slotFull,
  slotHint,
  slotMissing,
  slotUnits,
} from '@vendua/kernel/rules';
import { Calendar } from './calendar.tsx';
import { zoneOr } from './format.ts';

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
        const chosen = slotUnits(slot, value);
        const full = slotFull(slot, chosen);
        return (
          <fieldset
            key={slot.id}
            className="v-mod-group"
            data-part="slot"
            data-complete={slotMissing(slot, chosen) === 0 || undefined}
            data-invalid={errors[slot.id] ? true : undefined}
          >
            <legend className="v-legend">
              {slot.name} <span className="v-muted">— {slotHint(slot)}</span>{' '}
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
                  item.stockLeft ?? item.stockQuantity ?? Number.POSITIVE_INFINITY,
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
                          {formatCents(Math.abs(item.priceDeltaCents), currency)}
                        </span>
                      ) : null}
                      {soldOut ? (
                        <span className="v-muted" data-part="availability">
                          {' · '}
                          {item.availabilityLabel ?? 'esgotado'}
                        </span>
                      ) : item.stockLeft === 0 && q === 0 ? (
                        // the Kernel's stock left after the sacola: none for this kit
                        <span className="v-muted" data-part="availability">
                          {' · sem mais unidades'}
                        </span>
                      ) : null}
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
  const track = useRef<HTMLUListElement>(null);
  const n = images.length;
  // the scroll position is the source of truth: a swipe, a thumb tap and an arrow key all land here
  useEffect(() => {
    const el = track.current;
    if (!el || n < 2) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = el.clientWidth;
        if (w) setI(Math.max(0, Math.min(n - 1, Math.round(el.scrollLeft / w))));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [n]);
  if (!n)
    return (
      <span className="v-card-initial" aria-hidden="true" data-figure={figureVariant}>
        <span>{name.slice(0, 1).toUpperCase()}</span>
      </span>
    );
  const go = (k: number) => {
    const el = track.current;
    const to = Math.max(0, Math.min(n - 1, k));
    setI(to);
    if (!el) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: to * el.clientWidth, behavior: still ? 'auto' : 'smooth' });
  };
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const to =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    go(to);
  };
  return (
    <div
      className="v-gallery"
      data-vendua="gallery"
      data-part="root"
      role="region"
      aria-label={`Fotos: ${name}`}
    >
      <ul
        ref={track}
        className="v-gallery-track"
        data-part="main"
        tabIndex={n > 1 ? 0 : undefined}
        onKeyDown={n > 1 ? onKey : undefined}
      >
        {images.map((img, k) => (
          <li
            key={`${k}:${img.url}`}
            className="v-gallery-slide"
            data-part="slide"
            aria-label={n > 1 ? `Foto ${k + 1} de ${n}` : undefined}
          >
            <img
              src={img.url}
              {...(mediaSrcSet(img.url)
                ? { srcSet: mediaSrcSet(img.url), sizes: '(max-width: 859px) 100vw, 560px' }
                : {})}
              alt={img.alt ?? name}
              loading={k === 0 ? 'eager' : 'lazy'}
              {...{ fetchpriority: k === 0 ? 'high' : 'auto' }}
              decoding="async"
              draggable={false}
            />
          </li>
        ))}
      </ul>
      {n > 1 ? (
        <>
          <span className="v-gallery-dots" data-part="dots" aria-hidden="true">
            {images.map((img, k) => (
              <span key={`${k}:${img.url}`} data-current={k === i || undefined} />
            ))}
          </span>
          <ol className="v-gallery-thumbs" data-part="thumbs" aria-label="Fotos">
            {images.map((img, k) => (
              <li key={`${k}:${img.url}`}>
                <button
                  type="button"
                  aria-label={`Foto ${k + 1} de ${n}`}
                  aria-current={k === i || undefined}
                  onClick={() => go(k)}
                >
                  <img src={img.url} alt="" loading="lazy" decoding="async" draggable={false} />
                </button>
              </li>
            ))}
          </ol>
        </>
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
            <span className="v-num"> (−{formatCents(discountCents, currency)})</span>
          ) : null}
        </p>
        {!coupon.applies && coupon.reason ? (
          <p className="v-muted" role="status" data-part="reason">
            {couponMessage(coupon.reason, coupon.details, currency)}
          </p>
        ) : null}
        {error ? (
          <p className="v-field-error" id="v-coupon-error" role="alert">
            {error}
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
  timezone,
  error,
}: SlotProps['checkout.SchedulePicker']) {
  return (
    <fieldset className="v-fieldset v-schedule" data-vendua="schedule" data-part="root">
      <legend className="v-legend">
        {required ? 'Data da encomenda' : 'Agendar pedido (opcional)'}
      </legend>
      {required && leadDays > 0 ? (
        <p className="v-muted">
          Encomendas pedem {leadDays} {plural(leadDays, 'dia', 'dias')} de antecedência.
        </p>
      ) : null}
      {dates.length === 0 ? (
        <p className="v-alert" role="status">
          Sem datas disponíveis agora.
        </p>
      ) : (
        <Calendar
          available={dates}
          value={value}
          onChange={onChange}
          label={required ? 'Data da encomenda' : 'Data do pedido'}
          {...(timezone ? { timeZone: timezone } : {})}
        />
      )}
      <p className="v-note" data-part="selected" role="status" aria-live="polite">
        {value ? `Encomenda para ${formatDay(value)}` : 'Escolha um dia disponível no calendário.'}
      </p>
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

/** Re-renders every `ms` (0 = never) — the Pix countdown's clock. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ms) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** On a phone the buyer can't scan their own screen, so copy comes first and the QR
 *  is the "another device" fallback; from 720px the QR leads (scan with the phone). */
export function PixPayment({
  copyPaste,
  beneficiary,
  keyLabel,
  amountCents,
  currency,
  online,
  expiresAt,
}: SlotProps['checkout.PixPayment']) {
  const [copied, setCopied] = useState(false);
  const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
  const now = useNow(Number.isFinite(deadline) ? 1000 : 0);
  const left = Number.isFinite(deadline) ? deadline - now : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked — the code stays selectable in the field */
    }
  };
  return (
    <section
      className="v-panel v-pix"
      data-vendua="pix"
      data-part="root"
      aria-labelledby="v-pix-title"
    >
      <header className="v-pix-head" data-part="head">
        <h2 className="v-eyebrow" id="v-pix-title">
          Pague com Pix
        </h2>
        {amountCents ? (
          <p className="v-pix-amount v-num" data-part="amount">
            {formatCents(amountCents, currency)}
          </p>
        ) : null}
        {beneficiary ? (
          <p className="v-muted v-pix-to" data-part="beneficiary">
            Para <strong>{beneficiary}</strong>
            {/* PIX_KEY_LABEL's random key already reads "chave aleatória" */}
            {keyLabel ? ` · chave ${keyLabel.replace(/^chave /, '')}` : ''}
          </p>
        ) : null}
        {left !== null ? (
          <p
            className="v-pix-timer v-num"
            data-part="expires"
            data-urgent={left < 5 * 60_000 || undefined}
          >
            {left > 0 ? (
              <>
                Vale por mais{' '}
                <time dateTime={expiresAt ?? undefined}>{countdown(deadline, now)}</time>
              </>
            ) : (
              'Código expirado'
            )}
          </p>
        ) : null}
      </header>
      <div className="v-pix-copy" data-part="copy-block">
        <button
          type="button"
          className="v-btn v-btn-accent v-btn-block"
          data-part="copy"
          data-copied={copied || undefined}
          onClick={() => void copy()}
        >
          {copied ? 'Código copiado' : 'Copiar código Pix'}
        </button>
        <span className="v-sr" role="status">
          {copied ? 'Código Pix copiado' : ''}
        </span>
        <label className="v-label" htmlFor="v-pix-code">
          Pix copia e cola
        </label>
        <input
          id="v-pix-code"
          className="v-input v-pix-code"
          readOnly
          value={copyPaste}
          onFocus={(e) => e.currentTarget.select()}
        />
        <ol className="v-pix-steps" data-part="steps">
          <li>
            <span>Copie o código</span>
          </li>
          <li>
            <span>
              No app do banco, abra <strong>Pix copia e cola</strong>
            </span>
          </li>
          <li>
            <span>Cole, confira o valor e confirme</span>
          </li>
        </ol>
        {online ? (
          <p className="v-pix-wait" data-part="waiting">
            <span className="v-pix-wait-dot" aria-hidden="true" />
            Aguardando o pagamento — a confirmação aparece aqui na hora, sem mandar comprovante.
          </p>
        ) : null}
      </div>
      <div className="v-pix-qr" data-part="qr">
        <p className="v-pix-or">
          <span>ou pague de outro aparelho</span>
        </p>
        <div className="v-pix-qr-tile">
          <PixQr payload={copyPaste} label="QR code Pix" />
        </div>
      </div>
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
  paymentAdjustmentCents,
  paymentLabel,
  onReorder,
  reorderPending,
  vocabulary = DEFAULT_VOCABULARY,
}: SlotProps['order.Items']) {
  const adjustKind = adjustmentKind({ fixedCents: paymentAdjustmentCents ?? 0 });
  return (
    <section className="v-panel v-order-items" data-vendua="order-items" data-part="root">
      <h2 className="v-panel-title">Itens</h2>
      <ul className="v-summary-lines" data-part="lines">
        {items.map((i, k) => (
          <li key={`${i.slug}-${k}`} className="v-summary-line">
            <span>
              {i.qty}× {i.name}
              {i.modifiers.length || i.combo.length ? (
                <span className="v-muted v-line-mods"> — {lineSummary(i, currency)}</span>
              ) : null}
              {i.note ? (
                <span className="v-line-note" data-part="item-note">
                  <span className="v-sr">Observação: </span>
                  {i.note}
                </span>
              ) : null}
            </span>
            <span className="v-num">{formatCents(i.lineTotalCents, currency)}</span>
          </li>
        ))}
        {discountCents ? (
          <li className="v-summary-line" data-part="discount">
            <span>Desconto{couponCode ? ` (${couponCode})` : ''}</span>
            <span className="v-num">−{formatCents(discountCents, currency)}</span>
          </li>
        ) : null}
        {adjustKind && paymentAdjustmentCents ? (
          <li className="v-summary-line" data-part="payment-adjustment" data-kind={adjustKind}>
            <span>
              {adjustKind === 'discount' ? 'Desconto' : 'Acréscimo'}
              {paymentLabel ? ` (${paymentLabel})` : ' do pagamento'}
            </span>
            <span className="v-num">
              {adjustKind === 'discount' ? '−' : '+'}
              {formatCents(Math.abs(paymentAdjustmentCents), currency)}
            </span>
          </li>
        ) : null}
      </ul>
      {scheduledFor ? (
        <p className="v-note" data-part="scheduled">
          Encomenda para {formatDay(scheduledFor)}
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
          {reorderPending ? `Colocando ${vocabulary.inBag}…` : 'Pedir de novo'}
        </button>
      ) : null}
    </section>
  );
}

export function LoyaltyCard({ card, currency, timeZone }: SlotProps['customer.LoyaltyCard']) {
  if (!card.enabled) return null;
  return (
    <section className="v-panel v-loyalty" data-vendua="loyalty-card" data-part="root">
      <h2 className="v-panel-title">Cartão fidelidade</h2>
      <p className="v-muted">
        A cada {card.stampsRequired} pedidos entregues
        {card.minOrderCents > 0
          ? ` (a partir de ${formatCents(card.minOrderCents, currency)})`
          : ''}
        : {card.rewardLabel}.
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
                  · até {formatDay(localNow(zoneOr(timeZone), new Date(r.expiresAt)).date)}
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
  const [p, setP] = useState(() => maskPhone(phone));
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
            onChange={(e) => setP(maskPhone(e.target.value))}
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
