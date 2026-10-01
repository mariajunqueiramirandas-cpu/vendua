import { useState } from 'react';
import { useDeliverySummary, useProduct, useStockLeft, useStore, useWaitlist } from '../hooks.ts';
import { PixQr } from '@vendua/ui-defaults';
import { cardState } from '../rules/card.ts';
import { deliveryWords } from '../rules/delivery.ts';
import { plural } from '../rules/format.ts';
import { PIX_KEY_LABEL } from '../rules/orders.ts';
import { isValidPhone } from '../rules/phone.ts';
import { errorCopy } from '../errors.ts';
import { NotifyMeButton } from '../primitives.tsx';
import { usePageContext } from '../composition/runtime.tsx';
import type { BlockProps } from '../composition/registry.ts';
import type * as S from './schemas.ts';

// SDK blocks: category-typed pieces a template places into section areas.
// Product-aware blocks read the page's product from the route context.

function usePageProduct() {
  const { params } = usePageContext();
  return useProduct(params.slug ?? '').product;
}

/** Low stock is Core's call (`lowStock` / `lowStockThreshold` on what the bag leaves); the
 *  block's own `threshold` setting is kept for old templates and ignored since 1.14. */
export function StockCounter({ settings }: BlockProps<typeof S.stockCounter>) {
  const product = usePageProduct();
  const left = useStockLeft(product);
  if (!product) return null;
  const card = cardState(product, left);
  // a scheduled product isn't out of stock — the purchase panel says when it's back
  if (card.soldOut && card.scheduleLabel) return null;
  if (card.soldOut)
    return (
      <p className="v-stock" data-part="root" data-tone="low" role="status">
        Esgotado hoje
      </p>
    );
  // what's left after the cart; at 0 the purchase panel says it's all in the sacola
  const n = card.stockLeft;
  if (n === null || card.allInBag) return null;
  if (!card.lowStock && !settings.showWhenPlenty) return null;
  return (
    <p className="v-stock" data-part="root" data-tone={card.lowStock ? 'low' : 'ok'} role="status">
      {card.lowStock
        ? `Restam ${n} ${plural(n, 'unidade', 'unidades')}`
        : `${n} ${plural(n, 'unidade disponível', 'unidades disponíveis')}`}
    </p>
  );
}

/** Shows only when there's something to wait for: a sold-out product or a paused store.
 *  Kernel 1.2: a sold-out product joins Core's restock waitlist and shows who else waits. */
export function NotifyMe({ settings }: BlockProps<typeof S.notifyMe>) {
  const product = usePageProduct();
  const { status } = useStore();
  const [phone, setPhone] = useState('');
  const [done, setDone] = useState(false);
  // Kernel 1.7: outside its schedule (availabilityLabel) a product comes back by itself — no waitlist
  const restock = product?.status === 'sold_out' && !product.availabilityLabel;
  const waitlist = useWaitlist(restock ? product.id : undefined);
  const subject = restock ? 'product' : status === 'paused' ? 'store' : null;
  if (!subject) return null;
  if (done || waitlist.joined)
    return (
      <p className="v-note" role="status" data-part="done">
        {settings.successText}
        {waitlist.waiting && waitlist.waiting > 1
          ? ` Você e mais ${waitlist.waiting - 1} ${plural(waitlist.waiting - 1, 'pessoa', 'pessoas')} esperam.`
          : ''}
      </p>
    );
  if (subject === 'product' && product) {
    const others = product.waitlistCount ?? 0;
    return (
      <form
        className="v-notify"
        data-part="root"
        onSubmit={(e) => {
          e.preventDefault();
          if (isValidPhone(phone)) void waitlist.join(phone).catch(() => {});
        }}
      >
        <label className="v-label" htmlFor="v-notify-phone">
          {settings.title}
        </label>
        {others > 0 ? (
          <p className="v-muted" data-part="waiting">
            {others} {plural(others, 'pessoa já espera', 'pessoas já esperam')} a volta.
          </p>
        ) : null}
        <div className="v-notify-row">
          <input
            id="v-notify-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="v-input"
            placeholder="Seu WhatsApp"
            maxLength={20}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button
            type="submit"
            className="v-btn v-btn-accent"
            data-vendua="notify-me"
            disabled={waitlist.pending || !isValidPhone(phone)}
          >
            Avise-me
          </button>
        </div>
        {waitlist.error ? (
          <p className="v-field-error" role="alert">
            {errorCopy(waitlist.error.code).title}
          </p>
        ) : null}
      </form>
    );
  }
  return (
    <div className="v-notify" data-part="root">
      <label className="v-label" htmlFor="v-notify-phone">
        {settings.title}
      </label>
      <div className="v-notify-row">
        <input
          id="v-notify-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          className="v-input"
          placeholder="Seu WhatsApp"
          maxLength={20}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <NotifyMeButton
          subject={subject}
          {...(subject === 'product' && product ? { productId: product.id } : {})}
          phone={phone}
          onSubscribed={() => setDone(true)}
          asChild
        >
          <button type="button" className="v-btn v-btn-accent">
            Avise-me
          </button>
        </NotifyMeButton>
      </div>
    </div>
  );
}

export function PromoBadge({ settings }: BlockProps<typeof S.promoBadge>) {
  if (!settings.text) return null;
  return (
    <span className="v-badge" data-part="root" data-tone={settings.tone}>
      {settings.text}
    </span>
  );
}

/** Kernel 1.1: "Entrega a partir de R$ 5,00 · 30–80 min · Retirada em ~40 min" — Core's zones
 *  and prep time, summed up by `deliverySummary` (a per-km zone is never "grátis"). */
export function DeliveryEta({ settings }: BlockProps<typeof S.deliveryEta>) {
  const { store } = useStore();
  const summary = useDeliverySummary();
  if (!store) return null;
  const words = deliveryWords(summary, store.currency);
  const parts: string[] = [];
  if (words)
    parts.push(
      settings.showFee
        ? `${words.fee.charAt(0).toUpperCase()}${words.fee.slice(1)} · ${words.eta}`
        : `Entrega em ${words.eta}`,
    );
  if (settings.showPickup && summary.pickup)
    parts.push(`Retirada em ~${summary.pickup.prepMinutes} min`);
  if (parts.length === 0) return null;
  return (
    <p className="v-info v-eta" data-part="root">
      {parts.join(' · ')}
    </p>
  );
}

/** Kernel 1.2 — renders nothing until the store configures a Pix key. */
export function PixInfo({ settings }: BlockProps<typeof S.pixInfo>) {
  const { store } = useStore();
  const [copied, setCopied] = useState(false);
  const pix = store?.pix;
  if (!pix) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pix.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked — the key stays visible */
    }
  };
  return (
    <div className="v-info v-pix-info" data-part="root">
      <p className="v-panel-title">{settings.title}</p>
      {settings.showQr ? (
        <PixQr payload={pix.copyPaste} label={`QR code Pix de ${pix.beneficiary}`} />
      ) : null}
      <p>
        <span className="v-muted">{keyLabel(pix.keyType)}:</span>{' '}
        <code data-part="key">{pix.key}</code>{' '}
        <button type="button" className="v-link-btn" onClick={copy}>
          {copied ? 'Copiada!' : 'Copiar'}
        </button>
      </p>
      <p className="v-muted" data-part="beneficiary">
        {pix.beneficiary}
      </p>
    </div>
  );
}

// "Chave aleatória: …", "CPF: …"
function keyLabel(type: string): string {
  const label = PIX_KEY_LABEL[type] ?? type;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

/** Kernel 1.2 — the stamp card pitch; nothing when the store runs no program. */
export function LoyaltyTeaser({ settings }: BlockProps<typeof S.loyaltyTeaser>) {
  const { store } = useStore();
  const l = store?.loyalty;
  if (!l) return null;
  return (
    <p className="v-badge v-loyalty-teaser" data-part="root" data-tone="accent">
      {settings.text ||
        `Cartão fidelidade: a cada ${l.stampsRequired} pedidos, ${l.rewardLabel.toLowerCase()}.`}
    </p>
  );
}
