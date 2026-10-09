import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Plus, Search } from 'lucide-react';
import { useBottomBar } from '@/lib/bottomBar.ts';
import { cn } from '@/lib/cn.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { Panel } from '@/components/ui/card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/controls.tsx';
import { Input } from '@/components/ui/input.tsx';
import type { Errors } from './draft.ts';
import { useStoreRefs, type StoreRef } from './queries.ts';

export type Ns = 'routes' | 'budgets';
export const ErrorsCtx = createContext<Record<Ns, Errors>>({ routes: {}, budgets: {} });
export const useFieldError = (ns: Ns, path: string): string | undefined =>
  useContext(ErrorsCtx)[ns][path];

export function FieldMsg({ children, id }: { children: ReactNode; id?: string | undefined }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive-foreground">
      {children}
    </p>
  );
}

/** Amber = needs you; red = Duá stops answering. */
export function Notice({
  tone = 'warn',
  children,
  className,
}: {
  tone?: 'warn' | 'bad' | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md px-2.5 py-1.5 text-xs leading-relaxed',
        tone === 'warn'
          ? 'bg-warning-soft text-warning-foreground'
          : 'bg-destructive-soft text-destructive-foreground',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Decimal text input (accepts "1,5"), with its error under it. */
export function NumField({
  label,
  value,
  onChange,
  error,
  prefix,
  suffix,
  placeholder,
  className,
}: {
  label: string;
  placeholder?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  prefix?: string | undefined;
  suffix?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      <span className="relative flex items-center">
        {prefix && (
          <span className="pointer-events-none absolute left-2.5 text-xs text-muted-foreground">
            {prefix}
          </span>
        )}
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
          className={cn(
            'tnum',
            prefix && 'pl-9',
            suffix && 'pr-7',
            error && 'border-destructive/60',
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2.5 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </span>
      <FieldMsg>{error}</FieldMsg>
    </label>
  );
}

export function useStoreLookup() {
  const q = useStoreRefs();
  const map = useMemo(() => new Map((q.data ?? []).map((s) => [s.id, s])), [q.data]);
  return { query: q, get: (id: string) => map.get(id) };
}

/** Store name linking to its page; ids the list doesn't know show as the raw id. */
export function StoreName({ id, store }: { id: string; store: StoreRef | undefined }) {
  return store ? (
    <Link to={`/lojas/${id}`} className="min-w-0 truncate font-medium hover:underline">
      {store.name}
      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{store.slug}</span>
    </Link>
  ) : (
    <span className="min-w-0 truncate text-xs text-muted-foreground tnum">{id}</span>
  );
}

/** Search-and-pick a store that doesn't have an entry yet. */
export function StorePicker({
  exclude,
  onPick,
  label = 'adicionar loja',
}: {
  exclude: ReadonlySet<string>;
  onPick: (id: string) => void;
  label?: string | undefined;
}) {
  const { query } = useStoreLookup();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const matches = (query.data ?? [])
    .filter((s) => !exclude.has(s.id))
    .filter((s) => !term || s.name.toLowerCase().includes(term) || s.slug.includes(term))
    .slice(0, 40);
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQ('');
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-1.5rem)] p-0">
        <div className="relative border-b p-2">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="buscar loja"
            aria-label="buscar loja"
            className="pl-7"
          />
        </div>
        <ul className="max-h-72 overflow-auto p-1">
          {query.isPending ? (
            <li className="px-2 py-2 text-xs text-muted-foreground">carregando…</li>
          ) : query.isError ? (
            <li className="px-2 py-2 text-xs text-muted-foreground">
              não foi possível carregar as lojas
            </li>
          ) : !matches.length ? (
            <li className="px-2 py-2 text-xs text-muted-foreground">nenhuma loja encontrada</li>
          ) : (
            matches.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(s.id);
                    setOpen(false);
                    setQ('');
                  }}
                  className="flex w-full min-w-0 items-baseline gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover pointer-coarse:py-2.5"
                >
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{s.slug}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Panel whose one-line explanation sits beside the title on desktop and under it on phones. */
export function HintPanel({
  title,
  hint,
  actions,
  flush,
  children,
}: {
  title: string;
  hint: string;
  actions?: ReactNode | undefined;
  flush?: boolean | undefined;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  return (
    <Panel title={title} aside={mobile ? undefined : hint} actions={actions} flush={flush}>
      {mobile && (
        <p className={cn('text-xs text-muted-foreground', flush ? 'px-3 pt-2.5' : 'mb-3')}>
          {hint}
        </p>
      )}
      {children}
    </Panel>
  );
}

/** Rendered with a page's sticky save bar: hides the floating setup pill, which would cover "salvar". */
export function SaveBarShown() {
  useBottomBar();
  return null;
}
