import { Bag, Moped } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import type { OrderRow } from '../../lib/api.ts';
import { money, when } from '../../lib/format.ts';
import { StateChip } from '../../ui/StateChip.tsx';

export function OrderRowView({ o }: { o: OrderRow }) {
  return (
    <li className="border-b border-line last:border-0">
      <Link
        to={`/pedidos/${o.id}`}
        className="flex min-h-18 items-center gap-3 px-4 py-3 hover:bg-hover"
      >
        <span className="tnum w-14 shrink-0 font-display text-lg font-semibold">#{o.number}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{o.name}</span>
          <span className="t-caption flex items-center gap-1.5 text-muted">
            {o.mode === 'delivery' ? <Moped className="size-4" /> : <Bag className="size-4" />}
            {when(o.placedAt)} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'itens'}
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
