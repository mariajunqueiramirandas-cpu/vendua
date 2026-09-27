import { CaretDown } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import { cn } from './cn.ts';

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
