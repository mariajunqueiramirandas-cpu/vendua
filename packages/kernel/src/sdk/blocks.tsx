import { useState } from 'react';
import { useProduct, useStore } from '../hooks.ts';
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

/** Shows only when there's something to wait for: a sold-out product or a paused store. */
export function NotifyMe({ settings }: BlockProps<typeof S.notifyMe>) {
  const product = usePageProduct();
  const { status } = useStore();
  const [phone, setPhone] = useState('');
  const [done, setDone] = useState(false);
  const subject = product?.status === 'sold_out' ? 'product' : status === 'paused' ? 'store' : null;
  if (!subject) return null;
  if (done)
    return (
      <p className="v-note" role="status" data-part="done">
        {settings.successText}
      </p>
    );
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
