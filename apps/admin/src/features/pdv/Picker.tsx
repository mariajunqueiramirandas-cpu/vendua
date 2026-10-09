import { Clock, MagnifyingGlass, Stack, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { forwardRef, useMemo, useState, type KeyboardEvent } from 'react';
import { api, type Product } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk } from '../../lib/query.ts';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState } from '../../ui/feedback.tsx';
import { TextInput } from '../../ui/fields.tsx';
import { ArtSearch, NoPhoto } from '../../ui/illustrations.tsx';
import { availability } from '../../ui/ProductTile.tsx';
import { Bone } from '../../ui/skeletons.tsx';
import type { PickedLine } from './data.ts';
import { OptionsSheet } from './OptionsSheet.tsx';

// The counter's product grid: the store's own menu, by category or by search, one tap per item.
// A product with options (or a kit) asks for them first. Enter in the search takes the first hit.

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export const Picker = forwardRef<
  HTMLInputElement,
  {
    onPick: (line: Omit<PickedLine, 'key'>) => void;
    /** how many of each product the ticket holds (the tile's badge) */
    counts: Record<string, number>;
    /** Enter in an empty search (the screen charges) */
    onEmptyEnter?: () => void;
    className?: string;
    /** a narrower grid (inside a sheet) */
    compact?: boolean;
  }
>(function Picker({ onPick, counts, onEmptyEnter, className, compact }, searchRef) {
  const q = useQuery({ queryKey: qk.catalog, queryFn: api.catalog });
  const [cat, setCat] = useState<string>('all');
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<Product | null>(null);

  const cats = useMemo(
    () =>
      (q.data?.categories ?? [])
        .map((c) => ({ ...c, products: c.products.filter((p) => availability(p) !== 'hidden') }))
        .filter((c) => c.products.length),
    [q.data],
  );
  const shown = useMemo(() => {
    const t = fold(term.trim());
    const all = cats.flatMap((c) => c.products);
    if (t) return all.filter((p) => fold(p.name).includes(t));
    return cat === 'all' ? all : (cats.find((c) => c.id === cat)?.products ?? []);
  }, [cats, cat, term]);

  const pick = (p: Product) => {
    if (availability(p) === 'sold_out') return;
    if (p.groupCount > 0 || p.kind === 'combo') return setOptions(p);
    haptic.tick();
    onPick({ productId: p.id, name: p.name, qty: 1, modifiers: [], combo: [], note: '' });
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && term) {
      e.preventDefault();
      setTerm('');
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = shown.find((p) => availability(p) !== 'sold_out');
    if (term.trim() && first) {
      pick(first);
      setTerm('');
    } else if (!term.trim()) onEmptyEnter?.();
  };

  if (q.error && !q.data) return <ErrorState error={q.error} retry={() => void q.refetch()} />;

  return (
    <div className={className}>
      <div className="relative">
        <TextInput
          ref={searchRef}
          type="search"
          aria-label="buscar produto"
          placeholder="buscar produto"
          value={term}
          lead={<MagnifyingGlass className="size-5" />}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={onKey}
          className="pr-12"
        />
        {term ? (
          <button
            type="button"
            aria-label="limpar busca"
            onClick={() => setTerm('')}
            className="press absolute inset-y-0 right-1 grid w-11 place-items-center rounded-full text-muted"
          >
            <X className="size-5" />
          </button>
        ) : null}
      </div>

      {!term ? (
        <div
          className="scroll-row -mx-4 mt-3 flex gap-2 px-4"
          role="tablist"
          aria-label="categorias"
        >
          {[{ id: 'all', name: 'Tudo' }, ...cats].map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={cat === c.id}
              onClick={() => {
                haptic.tick();
                setCat(c.id);
              }}
              className={cn(
                'press t-label min-h-11 shrink-0 whitespace-nowrap rounded-full px-4 ring-1',
                cat === c.id
                  ? 'bg-primary text-on-primary ring-primary'
                  : 'bg-surface text-ink ring-line-strong hover:bg-hover',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}

      {!q.data ? (
        <div
          className={cn(
            'mt-4 grid gap-3',
            compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
          )}
          aria-hidden
        >
          {Array.from({ length: 8 }, (_, i) => (
            <Bone key={i} className="h-40 rounded-md" delay={i * 40} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          art={<ArtSearch />}
          title={term ? `Nada com “${term.trim()}”` : 'Nenhum produto para vender'}
          body={
            term
              ? 'Confira a palavra ou procure por outra.'
              : 'Os produtos do cardápio aparecem aqui. Cadastre em Cardápio.'
          }
        />
      ) : (
        <ul
          className={cn(
            'mt-4 grid gap-3',
            compact
              ? 'grid-cols-2 sm:grid-cols-3'
              : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
          )}
        >
          {shown.map((p) => (
            <li key={p.id}>
              <PickTile p={p} count={counts[p.id] ?? 0} onPick={() => pick(p)} />
            </li>
          ))}
        </ul>
      )}

      <OptionsSheet
        product={options}
        onOpenChange={(o) => !o && setOptions(null)}
        onAdd={(l) => {
          haptic.tick();
          onPick(l);
          setOptions(null);
        }}
      />
    </div>
  );
});

/** A product to tap: photo, name, the menu price; sold out stays visible, stamped and off. */
export function PickTile({ p, count, onPick }: { p: Product; count: number; onPick: () => void }) {
  const a = availability(p);
  const sold = a === 'sold_out';
  const offHours = !!p.availabilitySchedule && p.availableNow === false && !sold;
  const asks = p.groupCount > 0 || p.kind === 'combo';
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={sold}
      aria-label={`${p.name}, ${money(p.priceCents)}${sold ? ', esgotado' : ''}${count ? `, ${count} na conta` : ''}${asks ? ', escolher opções' : ''}`}
      className={cn(
        'press relative flex h-full w-full flex-col overflow-hidden rounded-md bg-surface text-left ring-1 depth-1 disabled:cursor-not-allowed',
        count ? 'ring-2 ring-primary' : 'ring-line',
      )}
    >
      <span
        className={cn(
          'relative block aspect-[16/10] w-full bg-sunken',
          sold && '[&>img]:grayscale [&>img]:opacity-60',
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
          <NoPhoto className="size-full" />
        )}
        {sold ? (
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-sm border-[3px] border-danger bg-surface/90 px-2 font-display text-base font-bold uppercase tracking-wider text-danger"
          >
            esgotado
          </span>
        ) : null}
        <span className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
          {p.kind === 'combo' ? (
            <span className="t-caption inline-flex h-6 items-center gap-1 rounded-full bg-surface/90 px-2 font-semibold">
              <Stack className="size-3.5" aria-hidden /> kit
            </span>
          ) : null}
          {offHours ? (
            <span className="t-caption inline-flex h-6 items-center gap-1 rounded-full bg-warning-soft px-2 font-semibold text-warning">
              <Clock className="size-3.5" aria-hidden /> fora do horário
            </span>
          ) : null}
        </span>
        {count ? (
          <span
            key={count}
            aria-hidden
            className="animate-pop tnum absolute right-1.5 top-1.5 grid h-8 min-w-8 place-items-center rounded-full bg-spark px-2 font-display text-base font-bold text-on-spark depth-1"
          >
            {count}
          </span>
        ) : null}
      </span>
      <span className="flex flex-1 flex-col gap-1 p-2.5">
        <span className="t-body line-clamp-2 font-semibold leading-snug">{p.name}</span>
        <span className="tnum t-body mt-auto flex items-center justify-between gap-2">
          <span className="font-semibold">{money(p.priceCents)}</span>
          {asks ? <span className="t-caption text-muted">opções</span> : null}
        </span>
      </span>
    </button>
  );
}
