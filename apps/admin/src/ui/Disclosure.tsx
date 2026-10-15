import { CaretDown } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import { cn } from './cn.ts';

/**
 * Inside a card: the fields most stores never touch, folded under the ones every store needs.
 * The summary says what's set in there ("taxa mínima R$ 8"), so a fold never hides a choice.
 */
export function MoreOptions({
  label = 'Mais opções',
  summary,
  children,
  defaultOpen,
}: {
  label?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const panel = `${useId()}-more`;
  return (
    <div className="border-t border-line pt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((v) => !v)}
        className="press-row -mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-hover"
      >
        <span className="min-w-0 flex-1">
          <span className="t-label block font-semibold">{label}</span>
          {summary ? <span className="t-caption block text-muted">{summary}</span> : null}
        </span>
        <CaretDown
          aria-hidden
          className={cn(
            'size-5 shrink-0 text-muted transition-transform duration-(--duration-quick)',
            open && 'rotate-180',
          )}
        />
      </button>
      <div id={panel} hidden={!open} className="animate-fade-up space-y-5 pb-1 pt-3">
        {children}
      </div>
    </div>
  );
}

/** Collapsed groups carry a one-line summary ("2 grupos, 7 opções") so nothing hides (§8 Cardápio). */
export function Disclosure({
  title,
  summary,
  icon,
  children,
  defaultOpen,
  id,
}: {
  title: ReactNode;
  summary?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const auto = useId();
  const panel = `${id ?? auto}-panel`;
  return (
    <section id={id} className="scroll-mt-24 rounded-lg bg-surface depth-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left"
      >
        {icon ? (
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken [&_svg]:size-5">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          {summary ? <span className="t-caption block truncate text-muted">{summary}</span> : null}
        </span>
        <CaretDown
          className={cn('size-5 shrink-0 text-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      <div id={panel} hidden={!open} className="border-t border-line px-4 pb-4 pt-4">
        {children}
      </div>
    </section>
  );
}
