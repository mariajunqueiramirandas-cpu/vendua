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
import type { OrderState } from '../lib/api.ts';
import { cn } from './cn.ts';

// Color is never the only signal: each state has a fill, an icon and a word (§4.2).
export const STATE_META: Record<
  OrderState,
  { label: string; var: string; Icon: typeof CheckCircle; next?: OrderState; nextLabel?: string }
> = {
  placed: {
    label: 'Novo',
    var: 'novo',
    Icon: BellRinging,
    next: 'confirmed',
    nextLabel: 'aceitar',
  },
  confirmed: {
    label: 'Aceito',
    var: 'aceito',
    Icon: CheckCircle,
    next: 'preparing',
    nextLabel: 'começar preparo',
  },
  preparing: {
    label: 'Preparando',
    var: 'preparando',
    Icon: CookingPot,
    next: 'ready',
    nextLabel: 'marcar pronto',
  },
  ready: { label: 'Pronto', var: 'pronto', Icon: Bag },
  out_for_delivery: {
    label: 'Saiu',
    var: 'pronto',
    Icon: Moped,
    next: 'delivered',
    nextLabel: 'entregue',
  },
  delivered: { label: 'Entregue', var: 'entregue', Icon: SealCheck },
  cancelled: { label: 'Cancelado', var: 'cancelado', Icon: XCircle },
  refunded: { label: 'Estornado', var: 'cancelado', Icon: ArrowCounterClockwise },
};

/** "ready" advances differently for delivery (sai) and pickup (entregue/retirado). */
export function nextStep(
  state: OrderState,
  mode: 'pickup' | 'delivery',
): { to: OrderState; label: string } | null {
  if (state === 'ready')
    return mode === 'delivery'
      ? { to: 'out_for_delivery', label: 'saiu para entrega' }
      : { to: 'delivered', label: 'retirado' };
  const m = STATE_META[state];
  return m.next ? { to: m.next, label: m.nextLabel! } : null;
}

export function StateChip({
  state,
  className,
}: {
  state: OrderState;
  className?: string | undefined;
  /** reserved: pickup/delivery wording */
  mode?: 'pickup' | 'delivery' | undefined;
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
