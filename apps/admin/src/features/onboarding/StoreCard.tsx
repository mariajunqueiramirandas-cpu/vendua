import { CaretRight, WhatsappLogo } from '@phosphor-icons/react';
import { localNow, todayHours } from '@vendua/kernel/rules';
import type { ReactNode } from 'react';
import type { SpecialDay } from '../../lib/api.ts';
import { hhmm, WEEKDAYS } from '../../lib/format.ts';
import { cn } from '../../ui/cn.ts';
import { fromWeek } from '../../ui/TimeRangeField.tsx';
import type { Spot } from './flow.ts';
import type { Draft } from './MiniStore.tsx';
import { glowOf } from './Vitrine.tsx';

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
 * The shop window on phones and tablets: a forest strip under the header with the store as the
 * customer meets it (its icon, its name, a line under it). The part the open question changes
 * wears a lime highlighter, and an answer that changed the store lights it up. A tap opens the
 * whole store.
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
  /** changes when an answer changed the store: the strip lights up once */
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
                  <WhatsappLogo weight="fill" className="size-3.5" />
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
              : spot === 'pay'
                ? mark('pay', 'Pagamento na sacola')
                : draft.tagline.trim() || today || 'Toque para ver a loja inteira';
  const lit = spot === 'logo' || spot === 'color';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Sua loja ao vivo: ${name || 'sem nome ainda'}. Ver a loja inteira`}
      className="relative block w-full overflow-hidden bg-stage text-left text-on-stage"
    >
      <span className="press relative isolate mx-auto flex max-w-xl items-center gap-3.5 px-4 py-3.5 md:px-0">
        {/* the store's colour as the light behind its icon; it swells when an answer lands */}
        <span
          key={spark}
          aria-hidden
          className={cn(
            'pointer-events-none absolute -left-20 top-1/2 -z-10 size-56 -translate-y-1/2 rounded-full opacity-55',
            spark > 0 && 'animate-lamp',
          )}
          style={{
            background: `radial-gradient(closest-side, color-mix(in srgb, ${glowOf(draft.accent)} 45%, transparent), transparent)`,
          }}
        />
        <span
          aria-hidden
          className={cn(
            'grid size-12 shrink-0 place-items-center overflow-hidden rounded-[15px] font-display text-[1.375rem] font-semibold tracking-[-0.04em] transition-[background-color,box-shadow] duration-(--duration-smooth)',
            lit && 'ring-2 ring-spark ring-offset-2 ring-offset-stage',
            !draft.accent && 'bg-spark text-on-spark',
          )}
          style={
            draft.accent ? { background: draft.accent, color: draft.onAccent ?? undefined } : {}
          }
        >
          {draft.logoUrl ? (
            <img src={draft.logoUrl} alt="" className="size-full bg-white object-cover" />
          ) : (
            (name.slice(0, 1) || '?').toUpperCase()
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="t-caption flex items-center gap-1.5 text-on-stage-muted">
            <span
              aria-hidden
              className="animate-pulse-dot size-1.5 shrink-0 rounded-full bg-spark"
            />
            sua loja, ao vivo
          </span>
          <span className="mt-0.5 block truncate font-display text-[1.125rem] font-semibold leading-6 tracking-[-0.015em]">
            {mark('name', name || <span className="text-on-stage-muted">Nome da loja</span>)}
          </span>
          <span className="t-caption block truncate text-on-stage-muted">{line}</span>
        </span>
        <span className="t-label inline-flex shrink-0 items-center gap-0.5 rounded-full bg-on-stage/10 py-1.5 pl-3 pr-2 text-on-stage">
          ver <CaretRight weight="bold" className="size-3.5" aria-hidden />
        </span>
      </span>
    </button>
  );
}
