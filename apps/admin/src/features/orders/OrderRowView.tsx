import { Bag, Moped } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import type { OrderRow } from '../../lib/api.ts';
import { money, when } from '../../lib/format.ts';
import { cn } from '../../ui/cn.ts';
import { paymentMeta } from '../../ui/PaymentChip.tsx';
import { StateChip } from '../../ui/StateChip.tsx';
import { usePreload } from '../../app/routes.ts';

export function OrderRowView({ o }: { o: OrderRow }) {
  const preload = usePreload();
  // paid is the norm in a list; only a payment that needs a look gets a word
  const pay =
    o.paymentStatus === 'paid'
      ? null
      : paymentMeta({ method: o.paymentMethod, status: o.paymentStatus }, true);
  return (
    <li className="border-b border-line last:border-0">
      <Link
        to={`/pedidos/${o.id}`}
        {...preload(`/pedidos/${o.id}`)}
        data-vt-src={`order:${o.id}`}
        className="press-row flex min-h-18 items-center gap-3 px-4 py-3 hover:bg-hover"
      >
        <span className="tnum w-12 shrink-0 font-display text-lg font-semibold">#{o.number}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{o.name}</span>
          <span className="t-caption flex items-center gap-1.5 text-muted">
            {o.mode === 'delivery' ? (
              <Moped className="size-4 shrink-0" />
            ) : (
              <Bag className="size-4 shrink-0" />
            )}
            <span className="truncate">
              {when(o.placedAt)} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'itens'}
            </span>
            {pay ? (
              <span
                className={cn(
                  'shrink-0 font-semibold',
                  pay.tone === 'danger'
                    ? 'text-danger'
                    : pay.tone === 'warning'
                      ? 'text-warning'
                      : pay.tone === 'info'
                        ? 'text-info'
                        : 'text-muted',
                )}
              >
                · {pay.label}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="tnum font-semibold">{money(o.totalCents)}</span>
          <StateChip state={o.state} mode={o.mode} />
        </span>
      </Link>
    </li>
  );
}
