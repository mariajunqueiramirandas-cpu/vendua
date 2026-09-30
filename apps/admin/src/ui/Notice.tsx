import { CheckCircle, Info, WarningCircle, WarningOctagon, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from './cn.ts';

type Tone = 'info' | 'warning' | 'danger' | 'success';

const TONE: Record<Tone, { box: string; ink: string; Icon: Icon }> = {
  info: { box: 'bg-info-soft', ink: 'text-info', Icon: Info },
  warning: { box: 'bg-warning-soft', ink: 'text-warning', Icon: WarningCircle },
  danger: { box: 'bg-danger-soft', ink: 'text-danger', Icon: WarningOctagon },
  success: { box: 'bg-success-soft', ink: 'text-success', Icon: CheckCircle },
};

/**
 * An inline callout inside a screen: what's going on, in words, and the next action (§2.2.2).
 * The title carries the tone's colour and icon; the body stays in ink so it reads at 7:1.
 */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  icon,
  className,
  role,
}: {
  tone?: Tone | undefined;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string | undefined;
  role?: 'status' | 'alert' | 'note' | undefined;
}) {
  const t = TONE[tone];
  return (
    <div
      role={role ?? 'note'}
      className={cn('flex items-start gap-3 rounded-md px-4 py-3.5', t.box, className)}
    >
      <span className={cn('mt-0.5 shrink-0 [&_svg]:size-5', t.ink)} aria-hidden>
        {icon ?? <t.Icon weight="fill" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('font-semibold', t.ink)}>{title}</p>
        {children ? <div className="t-body mt-0.5 text-ink">{children}</div> : null}
        {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}
