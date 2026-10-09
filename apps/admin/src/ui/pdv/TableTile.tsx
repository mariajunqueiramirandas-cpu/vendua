import { PencilSimple, Plus } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { money } from '../../lib/format.ts';
import { cn } from '../cn.ts';
import { tableName } from '../orderMode.ts';

/** "há 25 min", "há 1 h 10" — how long a comanda has been open */
export function openFor(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
}

/**
 * A table on the floor: free (dashed, "livre") or taken, with its comanda's total (Core's),
 * how long it's been open and its rounds. A comanda without a table uses the same tile.
 */
export function TableTile({
  label,
  tab,
  now,
  editing,
  onClick,
  className,
  extra,
}: {
  label: string;
  tab?: {
    totalCents: number;
    openedAt: string;
    rounds: number;
    customerName: string | null;
  } | null;
  now?: number;
  editing?: boolean;
  onClick?: () => void;
  className?: string;
  extra?: ReactNode;
}) {
  const busy = !!tab;
  const name = tableName(label);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        editing
          ? `editar ${name}`
          : busy
            ? `${name}, ocupada, ${money(tab.totalCents)}`
            : `${name}, livre: abrir comanda`
      }
      className={cn(
        'press relative flex min-h-28 w-full flex-col items-start gap-1 overflow-hidden rounded-lg p-3.5 text-left',
        busy
          ? 'bg-surface ring-1 ring-line depth-1 hover:bg-hover'
          : 'border-2 border-dashed border-line-strong hover:bg-hover',
        editing && 'ring-2 ring-primary',
        className,
      )}
    >
      {busy ? <span aria-hidden className="absolute inset-x-0 top-0 h-1.5 bg-spark" /> : null}
      <span className="flex w-full items-start justify-between gap-2">
        <span className="t-title-2 min-w-0 break-words leading-tight">{name}</span>
        {editing ? (
          <PencilSimple className="mt-1 size-5 shrink-0 text-muted" aria-hidden />
        ) : !busy ? (
          <Plus weight="bold" className="mt-1 size-5 shrink-0 text-muted" aria-hidden />
        ) : null}
      </span>
      {busy ? (
        <>
          <span className="tnum t-body-lg font-semibold">{money(tab.totalCents)}</span>
          <span className="t-caption tnum text-muted">
            {openFor(tab.openedAt, now)} · {tab.rounds} {tab.rounds === 1 ? 'rodada' : 'rodadas'}
          </span>
          {tab.customerName ? (
            <span className="t-caption w-full truncate text-muted">{tab.customerName}</span>
          ) : null}
        </>
      ) : (
        <span className="t-caption mt-auto text-muted">
          {editing ? 'toque para editar' : 'livre'}
        </span>
      )}
      {extra}
    </button>
  );
}
