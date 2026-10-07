import {
  Bag,
  BellRinging,
  CheckCircle,
  CookingPot,
  Moped,
  SealCheck,
  XCircle,
  ArrowCounterClockwise,
} from '@phosphor-icons/react';
import { orderPath } from '@vendua/kernel/rules';
import type { OrderMode, OrderState } from '../lib/api.ts';
import { pathMode } from './orderMode.ts';
import { cn } from './cn.ts';

// Color is never the only signal: each state has a fill, an icon and a word (§4.2).
export const STATE_META: Record<
  OrderState,
  { label: string; var: string; Icon: typeof CheckCircle }
> = {
  placed: { label: 'Novo', var: 'novo', Icon: BellRinging },
  confirmed: { label: 'Aceito', var: 'aceito', Icon: CheckCircle },
  preparing: { label: 'Preparando', var: 'preparando', Icon: CookingPot },
  ready: { label: 'Pronto', var: 'pronto', Icon: Bag },
  out_for_delivery: { label: 'Saiu', var: 'pronto', Icon: Moped },
  delivered: { label: 'Entregue', var: 'entregue', Icon: SealCheck },
  cancelled: { label: 'Cancelado', var: 'cancelado', Icon: XCircle },
  refunded: { label: 'Estornado', var: 'cancelado', Icon: ArrowCounterClockwise },
};

// the button that moves an order to this state
const ACTION: Partial<Record<OrderState, string>> = {
  confirmed: 'aceitar',
  preparing: 'começar preparo',
  ready: 'marcar pronto',
  out_for_delivery: 'saiu para entrega',
};

/** The next state on the order's path (the Kernel's: a pickup never goes out for delivery). */
export function nextStep(
  state: OrderState,
  mode: OrderMode,
): { to: OrderState; label: string } | null {
  const path = orderPath(pathMode(mode)) as OrderState[];
  const i = path.indexOf(state);
  const to = i >= 0 ? path[i + 1] : undefined;
  if (!to) return null;
  return {
    to,
    label:
      to === 'delivered'
        ? mode === 'delivery'
          ? 'entregue'
          : mode === 'dine_in'
            ? 'servido'
            : 'retirado'
        : ACTION[to]!,
  };
}

export function StateChip({
  state,
  className,
}: {
  state: OrderState;
  className?: string | undefined;
  /** reserved: pickup/delivery wording */
  mode?: OrderMode | undefined;
}) {
  const m = STATE_META[state];
  const label = m.label;
  return (
    <span
      className={cn(
        't-caption inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-semibold',
        className,
      )}
      style={{ background: `var(--st-${m.var})`, color: `var(--st-${m.var}-ink)` }}
    >
      <m.Icon
        weight="bold"
        className={cn('size-4', state === 'placed' && 'animate-ring')}
        aria-hidden
      />
      {label}
    </span>
  );
}
