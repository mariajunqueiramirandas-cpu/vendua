import { Camera, CheckSquare, EyeSlash, Square, Stack } from '@phosphor-icons/react';
import type { Product } from '../lib/api.ts';
import { money } from '../lib/format.ts';
import { cn } from './cn.ts';
import { ArtPudim } from './illustrations.tsx';

export function availability(p: Product): 'available' | 'sold_out' | 'hidden' {
  if (p.status === 'archived') return 'hidden';
  if (p.status === 'sold_out' || p.stockQuantity === 0) return 'sold_out';
  return 'available';
}

/**
 * Photo-first (§6.6): edge to edge 4:3 on a placeholder in the photo's dominant
 * colour; sold out goes monochrome with a stamped "esgotado" visible across the
 * room; hidden fades. No photo = a warm illustration + "adicionar foto".
 */
export function ProductTile({
  p,
  selecting,
  selected,
  lifted,
}: {
  p: Product;
  selecting?: boolean | undefined;
  selected?: boolean | undefined;
  lifted?: boolean | undefined;
}) {
  const a = availability(p);
  const low =
    p.stockQuantity != null &&
    p.stockQuantity > 0 &&
    p.lowStockThreshold != null &&
    p.stockQuantity <= p.lowStockThreshold;
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-surface depth-1 transition-[transform,box-shadow] duration-(--duration-smooth) ease-(--ease-soft)',
        lifted && 'z-10 scale-[1.03] -rotate-1 depth-2',
        selected && 'ring-3 ring-primary',
      )}
    >
      <div
        className={cn(
          'relative aspect-[4/3] bg-sunken',
          // the photo goes monochrome; the stamp keeps its red
          a === 'sold_out' && '[&>img]:grayscale',
          a === 'hidden' && '[&>img]:opacity-50',
        )}
        style={p.dominant ? { background: p.dominant } : undefined}
      >
        {p.imageUrl ? (
          <img
            src={p.imageUrl}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-faint">
            <ArtPudim className="h-2/3 w-auto text-ink opacity-50" />
            <span className="t-caption inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 font-semibold text-ink">
              <Camera className="size-4" /> adicionar foto
            </span>
          </div>
        )}
        {a === 'sold_out' ? (
          <span
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-sm border-[3px] border-danger bg-surface/85 px-3 py-0.5 font-display text-lg font-bold uppercase tracking-wider text-danger"
            aria-hidden
          >
            esgotado
          </span>
        ) : null}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {a === 'hidden' ? (
            <Badge>
              <EyeSlash className="size-3.5" /> escondido
            </Badge>
          ) : null}
          {p.kind === 'combo' ? (
            <Badge>
              <Stack className="size-3.5" /> kit
            </Badge>
          ) : null}
          {p.requiresPreorder ? <Badge>encomenda</Badge> : null}
          {low ? <Badge tone="warn">só {p.stockQuantity}</Badge> : null}
        </div>
        {selecting ? (
          <span className="absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-surface depth-1">
            {selected ? (
              <CheckSquare weight="fill" className="size-6" />
            ) : (
              <Square className="size-6 text-muted" />
            )}
          </span>
        ) : null}
      </div>
      <div className="p-3">
        <p className="t-body line-clamp-2 min-h-[2.75em] font-semibold leading-snug">{p.name}</p>
        <p className="tnum t-body mt-1 flex items-center justify-between text-muted">
          <span className="font-semibold text-ink">{money(p.priceCents)}</span>
          {p.stockQuantity != null && !low && a !== 'sold_out' ? (
            <span className="t-caption">{p.stockQuantity} un.</span>
          ) : null}
        </p>
      </div>
      <span className="sr-only">
        {a === 'sold_out' ? 'esgotado' : a === 'hidden' ? 'escondido da loja' : 'disponível'}
      </span>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <span
      className={cn(
        't-caption inline-flex h-6 items-center gap-1 rounded-full px-2 font-semibold depth-1',
        tone === 'warn' ? 'bg-warning-soft text-warning' : 'bg-surface/90 text-ink',
      )}
    >
      {children}
    </span>
  );
}
