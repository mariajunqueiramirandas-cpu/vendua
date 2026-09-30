import { Bike, Clock, Instagram, MapPin, MessageCircle, ShoppingBag, Store } from 'lucide-react';
import {
  BlockArea,
  defineSection,
  formatCents,
  image,
  text,
  useDeliveryZones,
  useStore,
  type SectionProps,
} from '@vendua/kernel';
import { DishGlyph, type Dish } from './_shared/DishArt.tsx';
import { daysLabel, hoursHint } from './_shared/hours.ts';

// The store's front door, the way a delivery app opens a restaurant: cover, logo, live status,
// and the three facts people decide on (how long, how much to deliver, the minimum).
export const schema = defineSection({
  type: 'store:menu-hero',
  settings: {
    cover: image(),
    openLabel: text({ max: 30, default: 'Aberto agora' }),
    closedLabel: text({ max: 30, default: 'Fechado agora' }),
    pausedLabel: text({ max: 60, default: 'Pausado por alguns minutos' }),
    untilLabel: text({ max: 20, default: 'até' }),
    opensLabel: text({ max: 20, default: 'abre' }),
    deliveryLabel: text({ max: 30, default: 'Entrega' }),
    fromLabel: text({ max: 20, default: 'a partir de' }),
    freeDeliveryLabel: text({ max: 30, default: 'Entrega grátis' }),
    pickupLabel: text({ max: 30, default: 'Retirada na loja' }),
    minOrderLabel: text({ max: 30, default: 'Pedido mínimo' }),
    moreLabel: text({ max: 40, default: 'Endereço e horários' }),
    everyDayLabel: text({ max: 30, default: 'todos os dias' }),
  },
  areas: { aside: { accepts: ['promo', 'badge', 'info'], max: 2 } },
});

const COVER_DISHES: Dish[] = ['flan', 'cup', 'bowl', 'pop', 'pizza', 'burger', 'box', 'cloche'];

export default function MenuHero({ settings: s }: SectionProps<typeof schema>) {
  const { store, status, loading } = useStore();
  const { zones } = useDeliveryZones();
  const currency = store?.currency ?? 'BRL';
  const hint = hoursHint(store?.hours, status);

  const delivery = store?.deliveryEnabled && zones.length > 0;
  const etaMin = delivery ? Math.min(...zones.map((z) => z.etaMin)) : null;
  const etaMax = delivery ? Math.max(...zones.map((z) => z.etaMax)) : null;
  const fees = delivery ? zones.map((z) => z.feeCents) : [];
  const lowestFee = fees.length ? Math.min(...fees) : null;
  const sameFee = fees.every((f) => f === lowestFee);

  const statusLabel =
    status === 'open' ? s.openLabel : status === 'paused' ? s.pausedLabel : s.closedLabel;
  const hintText = !hint
    ? ''
    : hint.kind === 'until'
      ? `${s.untilLabel} ${hint.time}`
      : `${s.opensLabel} ${hint.day ? `${hint.day} ` : ''}${hint.time}`;

  const instagram = store?.instagram?.replace(/^@/, '');

  return (
    <section className="hero" aria-busy={loading && !store ? true : undefined}>
      <div className="hero-cover" data-photo={s.cover ? true : undefined}>
        {s.cover ? (
          <img src={s.cover} alt="" {...{ fetchpriority: 'high' }} />
        ) : (
          <span className="hero-doodles" aria-hidden="true">
            {COVER_DISHES.map((d) => (
              <DishGlyph key={d} dish={d} spark={false} />
            ))}
          </span>
        )}
      </div>

      <div className="hero-card">
        <div className="hero-top">
          <span className="hero-avatar" aria-hidden="true">
            {store?.logoUrl ? (
              <img src={store.logoUrl} alt="" />
            ) : (
              <span>{store?.name.trim().charAt(0) ?? ''}</span>
            )}
          </span>
          <div className="hero-id">
            <h1 className="hero-name">{store?.name ?? ' '}</h1>
            {store?.tagline ? <p className="hero-tagline">{store.tagline}</p> : null}
            {status ? (
              <p className="hero-status" data-status={status} role="status">
                <span className="hero-dot" aria-hidden="true" />
                <strong>{statusLabel}</strong>
                {hintText ? <span> · {hintText}</span> : null}
              </p>
            ) : null}
          </div>
        </div>

        {store ? (
          <ul className="hero-facts">
            {etaMin !== null && etaMax !== null ? (
              <li>
                <Clock size={18} aria-hidden="true" />
                <span className="tnum">
                  {etaMin === etaMax ? etaMin : `${etaMin}–${etaMax}`} min
                </span>
              </li>
            ) : (
              <li>
                <Clock size={18} aria-hidden="true" />
                <span className="tnum">~{store.prepTimeMinutes} min</span>
              </li>
            )}
            {lowestFee !== null ? (
              <li>
                <Bike size={18} aria-hidden="true" />
                <span>
                  {lowestFee === 0 && sameFee
                    ? s.freeDeliveryLabel
                    : `${s.deliveryLabel} ${sameFee ? '' : `${s.fromLabel} `}${formatCents(lowestFee, currency)}`}
                </span>
              </li>
            ) : null}
            {store.pickupEnabled ? (
              <li>
                <Store size={18} aria-hidden="true" />
                <span>{s.pickupLabel}</span>
              </li>
            ) : null}
            {store.minOrderCents > 0 ? (
              <li>
                <ShoppingBag size={18} aria-hidden="true" />
                <span>
                  {s.minOrderLabel} {formatCents(store.minOrderCents, currency)}
                </span>
              </li>
            ) : null}
          </ul>
        ) : null}

        <BlockArea name="aside" className="hero-aside" />

        {store && (store.address || store.hours.windows.length || store.whatsapp || instagram) ? (
          <details className="hero-more">
            <summary>{s.moreLabel}</summary>
            <div className="hero-more-body">
              {store.address ? (
                <p className="hero-line">
                  <MapPin size={18} aria-hidden="true" />
                  <span>{store.address}</span>
                </p>
              ) : null}
              {store.hours.windows.length ? (
                <dl className="hero-hours">
                  {store.hours.windows.map((w, i) => (
                    <div key={i}>
                      <dt>{daysLabel(w.days, s.everyDayLabel)}</dt>
                      <dd className="tnum">
                        {w.open}–{w.close}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <p className="hero-contacts">
                {store.whatsapp ? (
                  <a href={`https://wa.me/${store.whatsapp.replace(/\D/g, '')}`} rel="noopener">
                    <MessageCircle size={18} aria-hidden="true" />
                    WhatsApp
                  </a>
                ) : null}
                {instagram ? (
                  <a href={`https://instagram.com/${instagram}`} rel="noopener">
                    <Instagram size={18} aria-hidden="true" />@{instagram}
                  </a>
                ) : null}
              </p>
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
