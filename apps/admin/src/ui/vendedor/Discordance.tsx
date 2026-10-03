import { Check } from '@phosphor-icons/react';
import { Button } from '../Button.tsx';
import { cn } from '../cn.ts';
import { Bubble } from './Bubble.tsx';
import { PersonaAvatar } from './PersonaAvatar.tsx';

/**
 * One Ensaio disagreement (sales-agent-ux §3.6): what the shopper wrote, what Duá would have
 * said (dashed, never sent) and what the owner sent, all three voices labelled in words. Ends
 * in one tap: a lesson ("ensinar como eu fiz") or a vote for him ("o Duá estava certo").
 */
export function Discordance({
  who,
  when,
  shopper,
  draft,
  merchant,
  onTeach,
  onDismiss,
  busy,
  className,
}: {
  /** the shopper's name */
  who: string;
  /** "ontem, 20h14" */
  when: string;
  shopper: string | null;
  draft: string;
  merchant: string | null;
  onTeach?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
  busy?: 'teach' | 'dismiss' | null | undefined;
  className?: string | undefined;
}) {
  return (
    <article className={cn('flex flex-col gap-3', className)} aria-label={`${who}, ${when}`}>
      <p className="t-caption text-muted">
        {who} · {when}
      </p>
      <div className="flex flex-col gap-1.5 rounded-lg bg-sunken p-3.5">
        {shopper ? (
          <Bubble voice="in" author={who}>
            {shopper}
          </Bubble>
        ) : null}
        <p className="t-caption mt-1 flex items-center gap-1.5 self-end font-semibold text-muted">
          <PersonaAvatar size="xs" />o Duá diria
        </p>
        <Bubble voice="seller" signed={false} draft>
          {draft}
        </Bubble>
        {merchant ? (
          <>
            <p className="t-caption mt-1 self-end font-semibold text-muted">você mandou</p>
            <Bubble voice="you" author="você">
              {merchant}
            </Bubble>
          </>
        ) : null}
      </div>
      {onTeach || onDismiss ? (
        <div className="flex flex-wrap items-center gap-2">
          {onTeach ? (
            <Button variant="secondary" onClick={onTeach} loading={busy === 'teach'}>
              ensinar como eu fiz
            </Button>
          ) : null}
          {onDismiss ? (
            <Button
              variant="ghost"
              icon={<Check weight="bold" />}
              onClick={onDismiss}
              loading={busy === 'dismiss'}
              className="text-muted"
            >
              o Duá estava certo
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
