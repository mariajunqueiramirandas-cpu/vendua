import { CaretRight, WarningCircle, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePreload } from '../app/routes.ts';
import { Card } from './Card.tsx';
import { cn } from './cn.ts';

/**
 * A screen one tap away, with what's there right now: "Horários · Hoje: 9h às 18h". A row that
 * needs attention says so in warning colour, with the reason as its line.
 */
export function LinkRow({
  to,
  Icon,
  title,
  line,
  warn,
  trailing,
  state,
}: {
  to: string;
  Icon: Icon;
  title: ReactNode;
  /** what's set there now, in a few words */
  line?: ReactNode;
  /** the line is a problem to fix (shown in warning colour) */
  warn?: boolean;
  trailing?: ReactNode;
  state?: unknown;
}) {
  const preload = usePreload();
  return (
    <li>
      <Link
        to={to}
        state={state}
        {...preload(to)}
        className="press-row flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
      >
        <span
          aria-hidden
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-full',
            warn ? 'bg-warning-soft text-warning' : 'bg-sunken text-ink',
          )}
        >
          <Icon weight="duotone" className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          {line ? (
            <span
              className={cn(
                't-caption flex items-start gap-1',
                warn ? 'font-semibold text-warning' : 'text-muted',
              )}
            >
              {warn ? <WarningCircle weight="bold" className="mt-0.5 size-4 shrink-0" /> : null}
              <span className="min-w-0">{line}</span>
            </span>
          ) : null}
        </span>
        {trailing ? <span className="shrink-0">{trailing}</span> : null}
        <CaretRight className="size-5 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}

/** LinkRows in one card, divided. */
export function LinkList({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <ul aria-label={label} className="divide-y divide-line">
        {children}
      </ul>
    </Card>
  );
}
