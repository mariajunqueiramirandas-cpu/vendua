import { Link } from 'react-router-dom';
import {
  BlockArea,
  defineSection,
  formatTime,
  formatWhen,
  text,
  url,
  useLinks,
  useStore,
  useStoreStatus,
  type SectionProps,
  type StatusHint,
} from '@vendua/kernel';
import { DishGlyph } from './_shared/DishArt.tsx';

// The front of the box: a blush label framed in gold, the store's name set as the wordmark.
export const schema = defineSection({
  type: 'store:hero',
  title: 'Abertura',
  settings: {
    kicker: text({ max: 40 }),
    title: text({ max: 60 }),
    text: text({ max: 220 }),
    ctaLabel: text({ max: 40, default: 'Ver o cardápio' }),
    ctaHref: url(),
    openLabel: text({ max: 30, default: 'Aberto agora' }),
    closedLabel: text({ max: 30, default: 'Fechado agora' }),
    pausedLabel: text({ max: 60, default: 'Pausado por alguns minutos' }),
    untilLabel: text({ max: 20, default: 'até' }),
    opensLabel: text({ max: 20, default: 'abre' }),
  },
  areas: { aside: { accepts: ['promo', 'badge', 'info'], max: 2 } },
});

type Settings = SectionProps<typeof schema>['settings'];

function hintText(hint: StatusHint | null, timeZone: string, s: Settings): string {
  if (!hint?.at) return '';
  if (hint.kind === 'open-until') return `${s.untilLabel} ${formatTime(hint.at, timeZone)}`;
  if (hint.kind === 'opens') return `${s.opensLabel} ${formatWhen(hint.at, timeZone)}`;
  if (hint.kind === 'paused-until') return `${s.untilLabel} ${formatWhen(hint.at, timeZone)}`;
  return '';
}

export default function Hero({ settings: s }: SectionProps<typeof schema>) {
  const { store } = useStore();
  const { status, hint, timeZone } = useStoreStatus();
  const links = useLinks();
  const name = s.title || store?.name || '';
  const when = hintText(hint, timeZone, s);
  const statusLabel =
    status === 'open' ? s.openLabel : status === 'paused' ? s.pausedLabel : s.closedLabel;
  const href = s.ctaHref || links.catalog;

  return (
    <section className="hero">
      <div className="hero-label">
        <span className="hero-emblem" aria-hidden="true">
          <DishGlyph dish="flan" spark={false} />
        </span>
        {s.kicker ? <p className="hero-kicker">{s.kicker}</p> : null}
        <h1 className="hero-name">{name}</h1>
        <span className="rule" aria-hidden="true" />
        {s.text ? <p className="hero-text">{s.text}</p> : null}
        <div className="hero-actions">
          {href.startsWith('#') ? (
            <a className="btn-ink" href={href}>
              {s.ctaLabel}
            </a>
          ) : (
            <Link className="btn-ink" to={href}>
              {s.ctaLabel}
            </Link>
          )}
          {status ? (
            <p className="hero-status" data-status={status} role="status">
              <span className="hero-dot" aria-hidden="true" />
              <span>
                {statusLabel}
                {when ? `, ${when}` : ''}
              </span>
            </p>
          ) : null}
        </div>
        <BlockArea name="aside" className="hero-aside" />
      </div>
    </section>
  );
}
