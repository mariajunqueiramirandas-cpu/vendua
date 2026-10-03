import { CaretRight, Receipt } from '@phosphor-icons/react';
import type { SacolaStep } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { cn } from '../cn.ts';
import { SELLER_EDGE } from './tones.ts';

export const SACOLA_STEPS: { id: SacolaStep; label: string }[] = [
  { id: 'montar', label: 'montar' },
  { id: 'endereco', label: 'endereço' },
  { id: 'pagamento', label: 'pagamento' },
  { id: 'confirmar', label: 'confirmar' },
  { id: 'feito', label: 'feito' },
];

/**
 * The live sacola pinned over a conversation: item count, Core's total and the five-step
 * stage. A list to screen readers, with the current step marked. Tapping opens the sacola
 * sheet (`onOpen`).
 */
export function SacolaBar({
  count,
  totalCents,
  step,
  onOpen,
  className,
}: {
  count: number;
  totalCents: number;
  step: SacolaStep;
  onOpen?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const at = SACOLA_STEPS.findIndex((s) => s.id === step);
  const done = step === 'feito';
  const top = (
    <span className="flex items-center gap-2.5">
      <Receipt weight="bold" className="size-5 shrink-0" aria-hidden />
      <span className="t-label min-w-0 flex-1 text-left">
        Sacola · {count} {count === 1 ? 'item' : 'itens'}
      </span>
      <span className="tnum font-display text-[1rem] font-semibold">{money(totalCents)}</span>
      {onOpen ? (
        <CaretRight weight="bold" className="size-4 shrink-0 text-muted" aria-hidden />
      ) : null}
    </span>
  );
  return (
    <div className={cn('rounded-md bg-surface px-3.5 py-3 depth-1', className)}>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="press -mx-1 -my-1 block min-h-10 w-[calc(100%+0.5rem)] rounded-sm px-1 py-1 hover:bg-hover"
          aria-label={`ver a sacola: ${count} ${count === 1 ? 'item' : 'itens'}, ${money(totalCents)}`}
        >
          {top}
        </button>
      ) : (
        top
      )}
      <ol className="mt-2.5 grid grid-cols-5 gap-1" aria-label="etapa do pedido">
        {SACOLA_STEPS.map((s, i) => {
          const past = i < at || done;
          const now = i === at && !done;
          return (
            <li
              key={s.id}
              aria-current={now ? 'step' : undefined}
              className={cn(
                'flex min-w-0 flex-col gap-1.5 text-[0.6875rem] leading-[0.875rem]',
                now ? 'font-semibold text-ink' : 'text-muted',
              )}
            >
              <i
                aria-hidden
                className={cn(
                  'block h-1 rounded-full',
                  past
                    ? 'bg-primary'
                    : now
                      ? `bg-spark ${SELLER_EDGE}`
                      : 'bg-sunken noite:bg-line-strong',
                )}
              />
              <span className="truncate">
                {s.label}
                {past ? <span className="sr-only"> (feito)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
