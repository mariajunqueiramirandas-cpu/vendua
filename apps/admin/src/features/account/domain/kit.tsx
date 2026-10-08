import type { Icon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useId, type ReactNode } from 'react';
import type { Account } from '../../../lib/api.ts';
import { haptic } from '../../../lib/haptics.ts';
import { qk, useMutation } from '../../../lib/query.ts';
import { cn } from '../../../ui/cn.ts';
import { messageOf } from '../../../ui/feedback.tsx';
import { toast } from '../../../ui/Toast.tsx';

// What Conta e plano and its domain screens share: chips, banners, steps, hosts and the write
// that puts the returned account in place.

/** Every account write answers with the whole account: put it in place, refresh what shows it. */
export function useAccountWrite<V>(
  fn: (v: V) => Promise<Account>,
  done?: (a: Account, v: V) => void,
  /** handle the error yourself (a field's message) instead of the toast */
  fail?: (e: unknown) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (a, v) => {
      qc.setQueryData(qk.account, a);
      // the plan opens and closes screens (session.plan.features): the locks follow
      void qc.invalidateQueries({ queryKey: qk.session });
      void qc.invalidateQueries({ queryKey: qk.home });
      void qc.invalidateQueries({ queryKey: qk.store });
      done?.(a, v);
    },
    onError: (e) => (fail ? fail(e) : toast.error(messageOf(e))),
  });
}

/** a host that wraps at its dots, never inside a word */
export const Host = ({ h }: { h: string }) => (
  <>
    {h.split('.').map((part, i) => (
      <span key={i}>
        {i ? '.' : ''}
        {part}
        <wbr />
      </span>
    ))}
  </>
);
export const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

// ── chips: color + icon + word (§4.2) ───────────────────────────────────────

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export const TONE: Record<Tone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  neutral: 'bg-sunken text-muted',
};

export function Chip({ tone, icon: I, children }: { tone: Tone; icon: Icon; children: ReactNode }) {
  return (
    <span
      className={cn(
        't-caption inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-semibold',
        TONE[tone],
      )}
    >
      <I weight="bold" className="size-4" aria-hidden />
      {children}
    </span>
  );
}

/** A banner that needs the merchant: what happened, and the one thing to do. */
export function Callout({
  tone,
  icon: I,
  title,
  children,
  action,
}: {
  tone: Exclude<Tone, 'neutral'>;
  icon: Icon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn('flex flex-col gap-3 rounded-lg p-4 sm:flex-row sm:items-center', TONE[tone])}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <I weight="fill" className="mt-0.5 size-6 shrink-0" aria-hidden />
        <div className="min-w-0 text-ink">
          <p className="font-semibold">{title}</p>
          {children ? <p className="t-body mt-0.5 text-muted">{children}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0 sm:ml-2">{action}</div> : null}
    </div>
  );
}

/** Steps as bars: the ones behind in green, the current one coloured (red when it failed). */
export function Progress({ steps, at, failed }: { steps: string[]; at: number; failed?: boolean }) {
  return (
    <ol
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((t, i) => {
        const done = i < at || (i === at && i === steps.length - 1 && !failed);
        const now = i === at && !done;
        return (
          <li key={t} className="min-w-0" aria-current={now ? 'step' : undefined}>
            <span
              className={cn(
                'block h-1.5 rounded-full',
                done
                  ? 'bg-success'
                  : now
                    ? failed
                      ? 'bg-danger'
                      : 'bg-[var(--chart)]'
                    : 'bg-line-strong',
              )}
            />
            <span
              className={cn(
                't-caption mt-1.5 block',
                done || now ? 'font-semibold text-ink' : 'text-muted',
              )}
            >
              {t}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** One choice of a few, each with what it means, in a bordered list. */
export function RadioRows<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; title: ReactNode; detail?: ReactNode }[];
}) {
  const group = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="divide-y divide-line overflow-hidden rounded-md ring-1 ring-line"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label
            key={o.value}
            className={cn(
              'flex min-h-16 cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-hover',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-primary',
              on && 'bg-sunken',
            )}
          >
            <input
              type="radio"
              name={group}
              value={o.value}
              checked={on}
              onChange={() => {
                haptic.tick();
                onChange(o.value);
              }}
              className="sr-only"
            />
            <span
              aria-hidden
              className={cn(
                'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ring-2 ring-inset',
                on ? 'bg-primary ring-primary' : 'bg-surface ring-line-strong',
              )}
            >
              {on ? <span className="size-2.5 rounded-full bg-on-primary" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{o.title}</span>
              {o.detail ? <span className="t-caption block text-muted">{o.detail}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
