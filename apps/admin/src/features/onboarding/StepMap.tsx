import { Check, Clock } from '@phosphor-icons/react';
import { cn } from '../../ui/cn.ts';
import { CHAPTERS, LABEL, type StepId } from './flow.ts';

export type Mark = 'current' | 'done' | 'skipped' | 'open';

/**
 * Every question of the store, part by part, with what's done, what was left for later and
 * where the merchant is; a tap goes straight to any of them. The sheet behind the header's
 * status on phones, a rail beside the question from 1200 px (the rail opens only the current
 * part, so it stays one screen tall).
 */
export function StepMap({
  steps,
  mark,
  onJump,
  rail,
}: {
  /** this store's questions */
  steps: StepId[];
  mark: (s: StepId) => Mark;
  onJump: (s: StepId) => void;
  rail?: boolean;
}) {
  return (
    <ol className={cn(rail ? 'space-y-1' : 'space-y-5')}>
      {/* numbered among this store's parts (a manager has no Pagamentos) */}
      {CHAPTERS.filter((c) => c.steps.some((x) => steps.includes(x))).map((c, n) => {
        const mine = c.steps.filter((x) => steps.includes(x));
        const marks = mine.map(mark);
        const here = marks.includes('current');
        const settled = marks.filter((m) => m === 'done' || m === 'skipped').length;
        const later = marks.filter((m) => m === 'skipped').length;
        const full = settled === mine.length;
        const open = !rail || here;
        // a closed part in the rail goes to its first question still open (or its first)
        const target = mine.find((_, i) => marks[i] === 'open') ?? mine[0]!;
        const head = (
          <>
            <span
              className={cn(
                'grid shrink-0 place-items-center rounded-full transition-colors duration-(--duration-quick)',
                rail ? 'size-9' : 'size-11',
                full
                  ? 'bg-success-soft text-success'
                  : here
                    ? 'bg-primary text-on-primary'
                    : 'bg-sunken text-ink',
              )}
            >
              {full ? (
                <Check weight="bold" className={rail ? 'size-4.5' : 'size-5'} aria-hidden />
              ) : (
                <c.Icon weight="duotone" className={rail ? 'size-5' : 'size-6'} aria-hidden />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="t-caption tnum block text-muted">Parte {n + 1}</span>
              <span className={cn('block truncate font-semibold', rail && 't-body')}>
                {c.label}
              </span>
            </span>
            <span
              className={cn(
                't-caption tnum shrink-0',
                full && later ? 'text-warning' : 'text-muted',
              )}
            >
              {full ? (later ? `${later} para depois` : 'pronto') : `${settled}/${mine.length}`}
            </span>
          </>
        );
        return (
          <li key={c.id}>
            {open ? (
              <div className={cn('flex items-center gap-3', rail ? 'px-2 py-2' : 'pb-2')}>
                {head}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onJump(target)}
                className="press-row flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-hover"
                aria-label={`${c.label}: ${full ? (later ? `${later} para depois` : 'pronto') : `${settled} de ${mine.length}`}. Ir para ${LABEL[target]}`}
              >
                {head}
              </button>
            )}
            {open ? (
              <ol
                className={cn(
                  'relative space-y-0.5',
                  // the thread that ties a part's questions to its icon
                  'before:absolute before:bottom-5 before:top-1 before:w-0.5 before:rounded-full before:bg-line',
                  rail ? 'ml-[1.6rem] before:left-0 pl-3' : 'ml-[1.35rem] pl-4 before:left-0',
                )}
              >
                {mine.map((s, i) => (
                  <Row key={s} step={s} mark={marks[i]!} onJump={onJump} />
                ))}
              </ol>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Row({ step, mark, onJump }: { step: StepId; mark: Mark; onJump: (s: StepId) => void }) {
  const now = mark === 'current';
  return (
    <li>
      <button
        type="button"
        onClick={() => onJump(step)}
        aria-current={now ? 'step' : undefined}
        className={cn(
          'press-row flex min-h-11 w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left',
          now ? 'bg-spark-soft font-semibold text-ink' : 'hover:bg-hover',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'grid size-5 shrink-0 place-items-center rounded-full',
            mark === 'done' && 'bg-success text-surface noite:text-bg',
            mark === 'skipped' && 'bg-warning-soft text-warning',
            mark === 'open' && 'ring-2 ring-inset ring-line-strong',
            now && 'bg-primary ring-4 ring-spark/60',
          )}
        >
          {mark === 'done' ? <Check weight="bold" className="size-3" /> : null}
          {mark === 'skipped' ? <Clock weight="bold" className="size-3" /> : null}
        </span>
        <span className={cn('t-body min-w-0 flex-1 leading-5', mark === 'open' && 'text-muted')}>
          {LABEL[step]}
        </span>
        <span className="sr-only">
          {now
            ? ', você está aqui'
            : mark === 'done'
              ? ', feito'
              : mark === 'skipped'
                ? ', ficou para depois'
                : ''}
        </span>
        {mark === 'skipped' ? (
          <span className="t-caption shrink-0 text-warning" aria-hidden>
            para depois
          </span>
        ) : null}
      </button>
    </li>
  );
}
