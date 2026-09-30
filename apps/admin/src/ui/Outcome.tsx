import { CheckCircle, MinusCircle, XCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from './cn.ts';

export type OutcomeState = 'ok' | 'failed' | 'skipped';

const META: Record<OutcomeState, { Icon: typeof CheckCircle; ink: string; word: string }> = {
  ok: { Icon: CheckCircle, ink: 'text-success', word: 'foi' },
  failed: { Icon: XCircle, ink: 'text-danger', word: 'não foi' },
  skipped: { Icon: MinusCircle, ink: 'text-muted', word: 'não enviado' },
};

/**
 * Where something went, one channel per row (an invite by WhatsApp and e-mail, a test alert
 * per device). Colour is never alone: every row has an icon and a word.
 */
export function OutcomeRow({
  channel,
  icon,
  state,
  word,
  detail,
}: {
  channel: ReactNode;
  icon: ReactNode;
  state: OutcomeState;
  /** replaces the default word ("foi", "não foi", "não enviado") */
  word?: string;
  detail?: ReactNode;
}) {
  const m = META[state];
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2.5">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken [&_svg]:size-5">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{channel}</span>
        {detail ? <span className="t-caption block text-muted">{detail}</span> : null}
      </span>
      <span className={cn('t-label inline-flex shrink-0 items-center gap-1.5', m.ink)}>
        <m.Icon weight="fill" className="size-5" aria-hidden />
        {word ?? m.word}
      </span>
    </li>
  );
}

export function OutcomeList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-line rounded-md bg-surface ring-1 ring-line">
      {children}
    </ul>
  );
}
