import { useState } from 'react';
import { useDeliveryZones, useProduct, useStore, useWaitlist } from '../hooks.ts';
import { money, PixQr } from '@vendua/ui-defaults';
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

export function StockCounter({ settings }: BlockProps<typeof S.stockCounter>) {
  const product = usePageProduct();
  if (!product) return null;
  if (product.status === 'sold_out')
    return (
      <p className="v-stock" data-part="root" data-tone="low" role="status">
        Esgotado hoje
      </p>
    );
  const n = product.stockQuantity;
  if (typeof n !== 'number') return null;
  const low = n > 0 && n <= settings.threshold;
  if (!low && !settings.showWhenPlenty) return null;
  return (
    <p className="v-stock" data-part="root" data-tone={low ? 'low' : 'ok'} role="status">
      {low ? `Restam ${n} ${n === 1 ? 'unidade' : 'unidades'}` : `${n} unidades disponíveis`}
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
  const waitlist = useWaitlist(product?.status === 'sold_out' ? product.id : undefined);
  const subject = product?.status === 'sold_out' ? 'product' : status === 'paused' ? 'store' : null;
  if (!subject) return null;
  if (done || waitlist.joined)
    return (
      <p className="v-note" role="status" data-part="done">
        {settings.successText}
        {waitlist.waiting && waitlist.waiting > 1
          ? ` Você e mais ${waitlist.waiting - 1} ${waitlist.waiting === 2 ? 'pessoa esperam' : 'pessoas esperam'}.`
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
          if (phone.replace(/\D/g, '').length >= 10) void waitlist.join(phone).catch(() => {});
        }}
      >
        <label className="v-label" htmlFor="v-notify-phone">
          {settings.title}
        </label>
        {others > 0 ? (
          <p className="v-muted" data-part="waiting">
            {others} {others === 1 ? 'pessoa já espera' : 'pessoas já esperam'} a volta.
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
            disabled={waitlist.pending || phone.replace(/\D/g, '').length < 10}
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

/** Kernel 1.1: "Entrega em 30–80 min · a partir de R$ 5,00 · Retirada em ~40 min" — Core's zones and prep time. */
export function DeliveryEta({ settings }: BlockProps<typeof S.deliveryEta>) {
  const { store } = useStore();
  const { zones } = useDeliveryZones();
  if (!store) return null;
  const parts: string[] = [];
  if (store.deliveryEnabled && zones.length > 0) {
    const min = Math.min(...zones.map((z) => z.etaMin));
    const max = Math.max(...zones.map((z) => z.etaMax));
    const fee = Math.min(...zones.map((z) => z.feeCents));
    parts.push(`Entrega em ${min}–${max} min`);
    if (settings.showFee)
      parts.push(fee > 0 ? `a partir de ${money(fee, store.currency)}` : 'entrega grátis');
  }
  if (settings.showPickup && store.pickupEnabled)
    parts.push(`Retirada em ~${store.prepTimeMinutes} min`);
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
        <span className="v-muted">Chave ({KEY_LABEL[pix.keyType] ?? pix.keyType}):</span>{' '}
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

const KEY_LABEL: Record<string, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'e-mail',
  phone: 'celular',
  random: 'aleatória',
};

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
