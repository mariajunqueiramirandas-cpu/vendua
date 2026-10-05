import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronsUpDown, PenLine, Search } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/controls.tsx';
import { Input } from '@/components/ui/input.tsx';
import { validModelId, type ModelOption } from './draft.ts';
import { fmtContextShort, fmtPrice } from './format.ts';

const cost = (m: ModelOption) => m.pricing.inputPerMTok + m.pricing.outputPerMTok;

export const UNVERIFIED_HINT =
  'id deduzido da lista da OpenRouter: o servidor não conseguiu confirmar na API do provedor';

export function UnverifiedMark() {
  return (
    <Badge variant="outline" title={UNVERIFIED_HINT}>
      não confirmado
    </Badge>
  );
}

/**
 * Search-and-pick over one provider's models, cheapest first, price on every row. With
 * `onCustom` (direct providers) a search term that isn't listed can be used as a typed id.
 */
export function ModelPicker({
  options,
  value,
  invalid,
  open,
  onOpenChange,
  onPick,
  onCustom,
  footer,
}: {
  options: ModelOption[];
  value: string;
  invalid?: boolean | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (m: ModelOption) => void;
  onCustom?: ((id: string) => void) | undefined;
  footer: ReactNode;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const current = options.find((m) => m.model === value);

  const sorted = useMemo(
    () => [...options].sort((a, b) => cost(a) - cost(b) || a.name.localeCompare(b.name)),
    [options],
  );
  const typed = q.trim();
  const term = typed.toLowerCase();
  const matches = term
    ? sorted.filter((m) => m.name.toLowerCase().includes(term) || m.model.includes(term))
    : sorted;
  const custom = onCustom && typed && !options.some((m) => m.model === typed) ? typed : null;
  const customOk = custom !== null && validModelId(custom);
  const last = matches.length + (customOk ? 1 : 0) - 1;

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

  // reopen on the current model, not at the top of a 200-row list
  useEffect(() => {
    if (open)
      setActive(
        Math.max(
          0,
          sorted.findIndex((m) => m.model === value),
        ),
      );
    else setQ('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (m: ModelOption) => {
    onPick(m);
    onOpenChange(false);
  };
  const pickCustom = () => {
    if (!customOk || !onCustom) return;
    onCustom(custom);
    onOpenChange(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => Math.min(Math.max(i + d, 0), Math.max(last, 0)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[active]) pick(matches[active]);
      else if (active === matches.length) pickCustom();
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
                {current.model}
              </span>
            </span>
          ) : value ? (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate">{value}</span>
              {onCustom && <span className="shrink-0 text-xs text-muted-foreground">digitado</span>}
            </span>
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
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder={onCustom ? 'buscar, ou digitar o id' : 'buscar por nome ou id'}
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
          {!matches.length && !custom && (
            <li className="px-2 py-2 text-xs text-muted-foreground">
              {options.length ? 'nenhum modelo com esse nome' : 'nenhum modelo na lista'}
            </li>
          )}
          {matches.map((m, i) => (
            <li key={m.model} role="option" aria-selected={m.model === value} data-index={i}>
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
                  {m.model === value && <Check className="size-3.5 text-primary" />}
                </span>
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate text-[13px] font-medium">{m.name}</span>
                  {!m.verified && <UnverifiedMark />}
                </span>
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
                <span className="col-start-2 truncate text-xs text-muted-foreground">
                  {m.model}
                </span>
                {/* phones keep the name readable: only the context size there */}
                <span className="text-xs text-muted-foreground tnum">
                  {m.contextLength ? fmtContextShort(m.contextLength) : ''}
                  <span className="hidden sm:inline">
                    {m.contextLength ? ' de contexto' : ''}
                    {m.zdrProviders
                      ? `${m.contextLength ? ' · ' : ''}${m.zdrProviders} ${m.zdrProviders === 1 ? 'provedor' : 'provedores'}`
                      : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {custom && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled={!customOk}
              data-index={matches.length}
            >
              <button
                type="button"
                tabIndex={-1}
                disabled={!customOk}
                onClick={pickCustom}
                onMouseMove={() => active !== matches.length && setActive(matches.length)}
                className={cn(
                  'grid w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-baseline gap-x-2 rounded-md px-2 py-1.5 text-left pointer-coarse:py-2.5',
                  customOk && active === matches.length && 'bg-hover',
                  matches.length && 'mt-1',
                )}
              >
                <PenLine className="size-3.5 self-center text-muted-foreground" />
                <span className="truncate text-[13px]">
                  usar <span className="font-medium">{custom}</span> como id
                </span>
                <span className="col-start-2 text-xs text-muted-foreground">
                  {customOk
                    ? 'fora da lista: o preço você preenche à mão'
                    : 'só letras, números e . _ / : @ -, até 200 caracteres'}
                </span>
              </button>
            </li>
          )}
        </ul>
        <p className="border-t px-3 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {footer}
        </p>
      </PopoverContent>
    </Popover>
  );
}
