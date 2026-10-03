import { Check, Circle, Warning, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from '../cn.ts';
import { SELLER_EDGE } from './tones.ts';

export type CheckState = 'done' | 'now' | 'todo' | 'optional' | 'miss';

const WORD: Record<CheckState, string> = {
  done: 'feito',
  now: 'agora',
  todo: 'a fazer',
  optional: 'opcional',
  miss: 'precisa de atenção',
};

/**
 * One step or check with its state in colour, icon and word: the resume map's parts, the
 * Cliente oculto checks, what she knows at the finale. `value` is a short figure ("20/20",
 * "3 de 7"); `action` a button or link. `card` draws it as its own card (the resume map).
 */
export function ChecklistRow({
  state,
  title,
  detail,
  eyebrow,
  value,
  action,
  icon,
  card,
  className,
}: {
  state: CheckState;
  title: ReactNode;
  detail?: ReactNode | undefined;
  /** "Parte 2 · agora" */
  eyebrow?: ReactNode | undefined;
  value?: ReactNode | undefined;
  action?: ReactNode | undefined;
  /** the step's own icon, shown while it isn't done */
  icon?: Icon | undefined;
  card?: boolean | undefined;
  className?: string | undefined;
}) {
  const I = state === 'done' ? Check : state === 'miss' ? Warning : (icon ?? Circle);
  return (
    <div
      className={cn(
        'flex min-h-14 items-center gap-3',
        card ? 'rounded-md p-3.5 depth-1' : 'border-t border-line py-2.5 first:border-t-0',
        card &&
          (state === 'now' ? 'bg-spark-soft ring-2 ring-primary noite:ring-spark' : 'bg-surface'),
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid shrink-0 place-items-center rounded-full',
          card ? 'size-11' : 'size-7',
          state === 'done' && 'bg-success-soft text-success',
          state === 'miss' && 'bg-warning-soft text-warning',
          state === 'now' &&
            (card ? 'bg-primary text-on-primary' : `bg-spark text-on-spark ${SELLER_EDGE}`),
          (state === 'todo' || state === 'optional') && 'bg-sunken text-muted',
        )}
      >
        <I weight="bold" className={card ? 'size-5' : 'size-4'} />
      </span>
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="t-caption text-muted">{eyebrow}</p> : null}
        <p className={cn(card ? 't-body-lg font-semibold leading-6' : 't-body')}>
          {title}
          <span className="sr-only">, {WORD[state]}</span>
        </p>
        {detail ? <p className="t-caption text-muted">{detail}</p> : null}
      </div>
      {value !== undefined && value !== null ? (
        <span
          className={cn(
            'tnum t-label shrink-0 text-right',
            state === 'done' && card
              ? 'text-success'
              : state === 'miss'
                ? 'text-warning'
                : 'text-muted',
          )}
        >
          {value}
        </span>
      ) : null}
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  );
}
