import { CashRegister, LockSimple } from '@phosphor-icons/react';
import type { PdvMethod } from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { cn } from '../cn.ts';
import { PDV_METHOD_LABEL } from '../PaymentChip.tsx';
import { PDV_METHOD_ICON, PDV_METHODS } from './methods.ts';

/** The five counter methods as big buttons; the picked ones carry the primary fill. */
export function MethodPicker({
  value,
  onPick,
  label = 'forma de pagamento',
  className,
}: {
  value: PdvMethod[];
  onPick: (m: PdvMethod) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('grid grid-cols-3 gap-2', className)}>
      {PDV_METHODS.map((m) => {
        const Icon = PDV_METHOD_ICON[m];
        const on = value.includes(m);
        return (
          <button
            key={m}
            type="button"
            aria-pressed={on}
            onClick={() => {
              haptic.tick();
              onPick(m);
            }}
            className={cn(
              'press t-label flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-md px-1 text-center ring-1',
              on
                ? 'bg-primary text-on-primary ring-primary depth-1'
                : 'bg-surface text-ink ring-line-strong hover:bg-hover',
            )}
          >
            <Icon weight={on ? 'fill' : 'duotone'} className="size-7" aria-hidden />
            <span className="leading-tight">{PDV_METHOD_LABEL[m]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The caixa in a word: open (alive, so lime) or closed (a sale needs it opened first). */
export function CaixaBadge({
  open,
  detail,
  className,
}: {
  open: boolean;
  detail?: string | undefined;
  className?: string;
}) {
  return (
    <span
      className={cn(
        't-caption inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 font-semibold',
        open ? 'bg-spark-soft text-ink' : 'bg-warning-soft text-warning',
        className,
      )}
    >
      {open ? (
        <CashRegister weight="bold" className="size-4" aria-hidden />
      ) : (
        <LockSimple weight="bold" className="size-4" aria-hidden />
      )}
      {open ? 'Caixa aberto' : 'Caixa fechado'}
      {detail ? <span className="font-medium text-muted">· {detail}</span> : null}
    </span>
  );
}
