import { CaretRight, Motorcycle, Storefront, WhatsappLogo } from '@phosphor-icons/react';
import { localNow, todayHours } from '@vendua/kernel/rules';
import type { ReactNode } from 'react';
import type { SpecialDay } from '../../lib/api.ts';
import { hhmm, WEEKDAYS } from '../../lib/format.ts';
import { cn } from '../../ui/cn.ts';
import { fromWeek } from '../../ui/TimeRangeField.tsx';
import { DishPrint } from './dishes.tsx';
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
 * The store as a card, on phones and tablets: the same living card the merchant will meet on
 * Início every day, in the store's own colour with its dishes printed on it, the icon, the name
 * set like the sign, the line under it and what's known so far as chips. The part the open
 * question changes wears a lime highlighter (or sits as a dashed slot, waiting), and an answer
 * that changed the store sweeps a light across it once. A tap opens the whole store.
 */
export function StoreCard({
  draft,
  products,
  whatsapp,
  timeZone,
  specialDays,
  spot,
  spark,
  url,
  onOpen,
}: {
  draft: Draft;
  products: number;
  whatsapp: boolean;
  /** the store's address, the line under the name until there's a phrase */
  url?: string | undefined;
  timeZone: string;
  specialDays: SpecialDay[];
  spot: Spot | null;
  /** changes when an answer changed the store: the light sweeps once */
  spark: number;
  onOpen: () => void;
}) {
  const name = draft.name.trim();
  const tagline = draft.tagline.trim();
  const today = todayLine(draft, timeZone, specialDays);
  const how = [draft.pickup ? 'Retirada' : null, draft.delivery ? 'Entrega' : null].filter(
    (x): x is string => !!x,
  );
  const lit = (s: Spot) => spot === s;
  const mark = (s: Spot, node: ReactNode) =>
    lit(s) ? (
      <mark className="-mx-1.5 rounded-[6px] bg-spark px-1.5 text-on-spark [box-decoration-break:clone]">
        {node}
      </mark>
    ) : (
      node
    );
  // a chip for what's known, or a dashed slot where the open question's answer will land
  const chip = (s: Spot, value: ReactNode, waiting: string, Icon?: typeof Storefront) =>
    value ? (
      <span
        className={cn(
          'inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] font-medium leading-4',
          lit(s)
            ? 'bg-spark text-on-spark'
            : 'bg-[color-mix(in_srgb,currentColor_14%,transparent)] text-current',
        )}
      >
        {Icon ? <Icon weight={lit(s) ? 'fill' : 'bold'} className="size-3.5" aria-hidden /> : null}
        {value}
      </span>
    ) : lit(s) ? (
      <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-spark px-2.5 text-[0.8125rem] font-medium leading-4 text-spark">
        {Icon ? <Icon weight="bold" className="size-3.5" aria-hidden /> : null}
        {waiting}
      </span>
    ) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Sua loja ao vivo: ${name || 'sem nome ainda'}. Ver a loja inteira`}
      className={cn(
        'press relative block w-full overflow-hidden rounded-xl text-left transition-[background-color,box-shadow] duration-(--duration-smooth) depth-2',
        lit('color') && 'ring-[3px] ring-inset ring-spark',
      )}
      style={{
        background: draft.accent ?? 'var(--stage)',
        color: draft.onAccent ?? 'var(--on-stage)',
      }}
    >
      {/* the dishes printed on the cover, in the ink the cover's text uses */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ color: 'color-mix(in srgb, currentColor 12%, transparent)' }}
      >
        <DishPrint scale={0.5} />
      </span>
      {/* the store's light: a lamp over the sign, and a sweep across the card when an answer lands */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-28 size-72 rounded-full"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in srgb, currentColor 20%, transparent), transparent)',
        }}
      />
      <span
        key={spark}
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-2/5 opacity-0',
          spark > 0 && 'animate-sweep',
        )}
        style={{
          background:
            'linear-gradient(90deg, transparent, color-mix(in srgb, currentColor 32%, transparent), transparent)',
        }}
      />

      <span className="relative flex flex-col gap-3.5 p-5">
        <span className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-[0.8125rem] font-semibold leading-4 opacity-90">
            <span aria-hidden className="animate-pulse-dot size-2 shrink-0 rounded-full bg-spark" />
            sua loja, ao vivo
          </span>
          <span className="inline-flex min-h-8 items-center gap-0.5 rounded-full bg-[color-mix(in_srgb,currentColor_14%,transparent)] py-1 pl-3 pr-2 text-[0.8125rem] font-semibold leading-4">
            ver a loja <CaretRight weight="bold" className="size-3.5" aria-hidden />
          </span>
        </span>

        <span className="flex items-end gap-4">
          <span
            aria-hidden
            className={cn(
              'grid size-16 shrink-0 place-items-center overflow-hidden rounded-[19px] bg-spark font-display text-[1.75rem] font-semibold leading-none tracking-[-0.04em] text-on-spark shadow-[0_0_0_3px_color-mix(in_srgb,currentColor_22%,transparent),0_10px_24px_-10px_rgb(0_0_0/0.45)] transition-shadow duration-(--duration-smooth)',
              lit('logo') &&
                'animate-settle shadow-[0_0_0_3px_var(--bg),0_0_0_6px_var(--spark),0_10px_24px_-10px_rgb(0_0_0/0.45)]',
            )}
          >
            {draft.logoUrl ? (
              <img src={draft.logoUrl} alt="" className="size-full bg-white object-cover" />
            ) : (
              (name.slice(0, 1) || '?').toUpperCase()
            )}
          </span>
          <span className="min-w-0 flex-1 pb-0.5">
            <span
              className={cn(
                'line-clamp-2 font-display font-semibold tracking-[-0.03em] [text-wrap:balance]',
                name.length > 16 ? 'text-[1.25rem] leading-6' : 'text-[1.5rem] leading-7',
              )}
            >
              {mark('name', name || <span className="opacity-60">Nome da loja</span>)}
            </span>
            <span className="mt-1 block truncate text-[0.9375rem] leading-5 opacity-85">
              {lit('tagline')
                ? mark('tagline', tagline || <span className="italic">sua frase aqui</span>)
                : tagline || (
                    <span className="opacity-70">
                      {products
                        ? `${products} ${products === 1 ? 'produto' : 'produtos'} no cardápio`
                        : (url ?? 'Toque para ver a loja inteira')}
                    </span>
                  )}
            </span>
          </span>
        </span>

        <span className="flex flex-wrap items-center gap-1.5">
          {chip('hours', today, 'Seus horários aqui')}
          {chip(
            'how',
            how.length ? how.join(' e ') : null,
            'Retirada ou entrega?',
            draft.delivery && !draft.pickup ? Motorcycle : Storefront,
          )}
          {chip('whatsapp', whatsapp ? 'WhatsApp' : null, 'Seu WhatsApp aqui', WhatsappLogo)}
          {lit('products')
            ? chip('products', products ? `${products} no cardápio` : null, 'Seu cardápio aqui')
            : null}
          {lit('pay') ? chip('pay', 'Pagamento na sacola', 'Pagamento na sacola') : null}
        </span>
      </span>
    </button>
  );
}
