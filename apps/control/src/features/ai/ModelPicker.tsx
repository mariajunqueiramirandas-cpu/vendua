import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import type { AiCatalogModel } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { rel } from '@/lib/format.ts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/controls.tsx';
import { Input } from '@/components/ui/input.tsx';
import { fmtContextShort, fmtPrice } from './format.ts';

const cost = (m: AiCatalogModel) => m.pricing.inputPerMTok + m.pricing.outputPerMTok;

/** Search-and-pick over OpenRouter's ZDR models, cheapest first, price on every row. */
export function ModelPicker({
  models,
  fetchedAt,
  value,
  invalid,
  onPick,
}: {
  models: AiCatalogModel[];
  fetchedAt: string;
  value: string;
  invalid?: boolean | undefined;
  onPick: (m: AiCatalogModel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const current = models.find((m) => m.id === value);

  const sorted = useMemo(
    () => [...models].sort((a, b) => cost(a) - cost(b) || a.name.localeCompare(b.name)),
    [models],
  );
  const term = q.trim().toLowerCase();
  const matches = term
    ? sorted.filter((m) => m.name.toLowerCase().includes(term) || m.id.includes(term))
    : sorted;

  useEffect(() => {
    if (!open) return;
    // the list mounts in a portal a frame after open
    const id = requestAnimationFrame(() =>
      listRef.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
    return () => cancelAnimationFrame(id);
  }, [active, open]);

  const pick = (m: AiCatalogModel) => {
    onPick(m);
    setOpen(false);
    setQ('');
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => Math.min(Math.max(i + d, 0), Math.max(matches.length - 1, 0)));
    } else if (e.key === 'Enter' && matches[active]) {
      e.preventDefault();
      pick(matches[active]);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQ('');
        // reopen on the current model, not at the top of a 200-row list
        else
          setActive(
            Math.max(
              0,
              sorted.findIndex((m) => m.id === value),
            ),
          );
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="modelo"
          aria-invalid={invalid}
          className={cn(
            'flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-card px-2.5 text-left text-base shadow-card transition-[border-color,box-shadow] focus-visible:border-ring/60 focus-visible:ring-[3px] focus-visible:ring-ring/15 focus-visible:outline-none md:h-8 md:text-[13px]',
            invalid && 'border-destructive/60',
          )}
        >
          {current ? (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate font-medium">{current.name}</span>
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                {current.id}
              </span>
            </span>
          ) : value ? (
            <span className="min-w-0 flex-1 truncate">{value}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
              escolher modelo
            </span>
          )}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        collisionPadding={8}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[30rem] max-w-[calc(100vw-1.5rem)] flex-col p-0"
      >
        <div className="relative border-b p-2">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder="buscar por nome ou id"
            aria-label="buscar modelo"
            aria-controls="model-picker-list"
            className="pl-7"
          />
        </div>
        <div className="flex items-baseline justify-between gap-3 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>mais barato primeiro</span>
          <span className="shrink-0">US$ por 1M tokens, entrada / saída</span>
        </div>
        <ul
          ref={listRef}
          id="model-picker-list"
          role="listbox"
          aria-label="modelos"
          className="max-h-[22rem] min-h-0 flex-1 overflow-auto p-1"
        >
          {!matches.length ? (
            <li className="px-2 py-2 text-xs text-muted-foreground">nenhum modelo com esse nome</li>
          ) : (
            matches.map((m, i) => (
              <li key={m.id} role="option" aria-selected={m.id === value} data-index={i}>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => pick(m)}
                  onMouseMove={() => i !== active && setActive(i)}
                  className={cn(
                    'grid w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-md px-2 py-1.5 text-left pointer-coarse:py-2.5',
                    i === active && 'bg-hover',
                  )}
                >
                  <span className="self-center">
                    {m.id === value && <Check className="size-3.5 text-primary" />}
                  </span>
                  <span className="truncate text-[13px] font-medium">{m.name}</span>
                  <span className="text-[13px] tnum">
                    {cost(m) === 0 ? (
                      'grátis'
                    ) : (
                      <>
                        {fmtPrice(m.pricing.inputPerMTok)}
                        <span className="text-muted-foreground"> / </span>
                        {fmtPrice(m.pricing.outputPerMTok)}
                      </>
                    )}
                  </span>
                  <span className="col-start-2 truncate text-xs text-muted-foreground">{m.id}</span>
                  <span className="text-xs text-muted-foreground tnum">
                    {m.contextLength ? `${fmtContextShort(m.contextLength)} de contexto` : ''}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="border-t px-3 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {models.length} modelos da OpenRouter com retenção zero e ferramentas, lista atualizada{' '}
          {rel(fetchedAt) === 'agora' ? 'agora' : `há ${rel(fetchedAt)}`}. O preço é o do provedor
          mais caro de cada modelo.
        </p>
      </PopoverContent>
    </Popover>
  );
}
