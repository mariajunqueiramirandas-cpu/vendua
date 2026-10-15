import { CaretRight, WhatsappLogo } from '@phosphor-icons/react';
import { localNow, todayHours } from '@vendua/kernel/rules';
import type { ReactNode } from 'react';
import type { SpecialDay } from '../../lib/api.ts';
import { hhmm, WEEKDAYS } from '../../lib/format.ts';
import { cn } from '../../ui/cn.ts';
import { fromWeek } from '../../ui/TimeRangeField.tsx';
import type { Spot } from './flow.ts';
import type { Draft } from './MiniStore.tsx';

/** "Hoje: 9h–18h" for the store's own day, or "Sáb: fechado". */
export function todayLine(draft: Draft, timeZone: string, specialDays: SpecialDay[]) {
  if (!draft.week.some((d) => d.length)) return null;
  const hours = todayHours({
    timezone: timeZone,
    windows: fromWeek(draft.week),
    specialDays,
  }).windows;
  return hours.length
    ? `Hoje: ${hours.map((h) => `${hhmm(h.open)}–${hhmm(h.close)}`).join(', ')}`
    : `${WEEKDAYS[localNow(timeZone).weekday]}: fechado`;
}

/**
 * The store, live, at the top of every question on phones and tablets: what the customer sees
 * first (avatar, name, a line under it). The part the open question changes wears a lime
 * marker, and an answer that changed the store sparks its edge. A tap opens the whole store.
 */
export function StoreCard({
  draft,
  products,
  whatsapp,
  timeZone,
  specialDays,
  spot,
  spark,
  onOpen,
}: {
  draft: Draft;
  products: number;
  whatsapp: boolean;
  timeZone: string;
  specialDays: SpecialDay[];
  spot: Spot | null;
  /** changes when an answer changed the store: the card lights up once */
  spark: number;
  onOpen: () => void;
}) {
  const name = draft.name.trim();
  const today = todayLine(draft, timeZone, specialDays);
  const how = [draft.pickup && 'retirada', draft.delivery && 'entrega'].filter(Boolean).join(' e ');
  const mark = (s: Spot, node: ReactNode) =>
    spot === s ? (
      <mark className="-mx-1 rounded-[4px] bg-spark px-1 text-on-spark [box-decoration-break:clone]">
        {node}
      </mark>
    ) : (
      node
    );
  // the line under the name says what the open question is about, else the most telling fact
  const line: ReactNode =
    spot === 'tagline'
      ? mark('tagline', draft.tagline.trim() || <span className="italic">sua frase aqui</span>)
      : spot === 'hours'
        ? mark('hours', today ?? 'Seus horários aqui')
        : spot === 'how'
          ? mark('how', how ? how[0]!.toUpperCase() + how.slice(1) : 'Retirada ou entrega?')
          : spot === 'whatsapp'
            ? mark(
                'whatsapp',
                <span className="inline-flex items-center gap-1">
                  <WhatsappLogo weight="fill" className="size-3.5 text-success" />
                  {whatsapp ? 'Fale com a gente' : 'Seu WhatsApp aqui'}
                </span>,
              )
            : spot === 'products'
              ? mark(
                  'products',
                  products
                    ? `${products} ${products === 1 ? 'produto' : 'produtos'} no cardápio`
                    : 'Seu cardápio aqui',
                )
              : draft.tagline.trim() || today || 'Toque para ver a loja inteira';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Sua loja ao vivo: ${name || 'sem nome ainda'}. Ver a loja inteira`}
      className="press relative flex w-full items-center gap-3 rounded-lg bg-surface py-3 pl-3 pr-2 text-left ring-1 ring-line depth-1"
    >
      {spark ? (
        <span
          key={spark}
          aria-hidden
          className="animate-spark-ring pointer-events-none absolute inset-0 rounded-lg"
        />
      ) : null}
      <span
        className={cn(
          'grid size-12 shrink-0 place-items-center overflow-hidden rounded-full font-display text-lg font-semibold transition-[background-color,box-shadow] duration-(--duration-smooth)',
          (spot === 'logo' || spot === 'color') &&
            'ring-2 ring-spark ring-offset-2 ring-offset-surface',
          !draft.accent && 'bg-primary text-on-primary',
        )}
        style={draft.accent ? { background: draft.accent, color: draft.onAccent ?? undefined } : {}}
        aria-hidden
      >
        {draft.logoUrl ? (
          <img src={draft.logoUrl} alt="" className="size-full object-cover" />
        ) : (
          (name.slice(0, 1) || '?').toUpperCase()
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-caption flex items-center gap-1.5 text-muted">
          <span
            aria-hidden
            className="animate-pulse-dot size-1.5 shrink-0 rounded-full bg-[var(--chart)]"
          />
          sua loja, ao vivo
        </span>
        <span className="mt-0.5 block truncate font-display text-[1.0625rem] font-semibold leading-6">
          {mark('name', name || <span className="text-muted">Nome da loja</span>)}
        </span>
        <span className="t-caption block truncate text-muted">{line}</span>
      </span>
      <span className="t-label inline-flex shrink-0 items-center gap-0.5 rounded-full bg-sunken py-1.5 pl-3 pr-2">
        ver <CaretRight weight="bold" className="size-3.5" aria-hidden />
      </span>
    </button>
  );
}
