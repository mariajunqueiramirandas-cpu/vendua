import { CheckCircle } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../../ui/cn.ts';
import { Mascote, type Pose } from '../../ui/Mascote.tsx';

// The friendly voice of the wizard: the mascot that bobs beside a speech bubble. It "types"
// for a beat whenever the question changes, so each step feels like someone talking. While
// typing, the reply's own lines show as blank bars, so the bubble already has its final size
// and the page below doesn't jump when the words land.
const still = () =>
  navigator.webdriver || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Guide({ turn, pose, children }: { turn: string; pose: Pose; children: ReactNode }) {
  const [typing, setTyping] = useState(() => !still());
  useEffect(() => {
    if (still()) return setTyping(false);
    setTyping(true);
    const t = setTimeout(() => setTyping(false), 520);
    return () => clearTimeout(t);
  }, [turn]);
  return (
    // a size smaller on phones, so the question and its answer stay above the fold
    <div className="flex items-end gap-3">
      <div
        aria-hidden
        className="animate-bob grid size-16 shrink-0 place-items-center rounded-lg bg-spark-soft sm:size-20"
      >
        <Mascote pose={pose} size={76} className="size-[60px] sm:size-[76px]" />
      </div>
      <div
        aria-live="polite"
        className="t-body sm:t-body-lg min-h-12 min-w-0 rounded-lg rounded-bl-sm bg-surface px-4 py-3 depth-1"
      >
        {typing ? (
          <span aria-hidden className="typing-lines skeleton">
            {children}
          </span>
        ) : (
          <span className="animate-fade-up block">{children}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Duá reacting to the answer just given, above the next question: a small face and one line.
 * Only after an answer (a question opened from the map or by "voltar" has nothing to react
 * to), so the question itself stays the one thing to read. When the answer opened a new part,
 * Duá shows up in that part's pose instead (the brush for the look, the parcel for the service…).
 */
export function Reaction({
  children,
  done,
  pose,
}: {
  children: ReactNode;
  done?: string | null;
  /** a part begins: Duá at work on it */
  pose?: Pose | null;
}) {
  return (
    <div className={cn('flex gap-3', pose ? 'items-end' : 'items-center')}>
      <span
        aria-hidden
        className={cn(
          'dua-disc animate-pop grid shrink-0 place-items-center bg-spark-soft',
          pose ? 'size-[5.5rem] sm:size-24' : 'size-12',
        )}
      >
        <Mascote
          pose={pose ?? 'avatar-feliz'}
          size={pose ? 96 : 48}
          className={pose ? 'size-[5rem] sm:size-[5.5rem]' : 'size-11'}
        />
      </span>
      <p
        role="status"
        className={cn(
          't-body min-w-0 rounded-lg bg-surface px-4 py-2.5 depth-1',
          pose ? 'mb-2 rounded-bl-sm' : 'rounded-bl-sm',
        )}
      >
        {done ? (
          <span className="t-caption mb-0.5 flex items-center gap-1 font-semibold text-success">
            <CheckCircle weight="fill" className="size-4 shrink-0" aria-hidden /> {done}
          </span>
        ) : null}
        <span className="font-semibold">{children}</span>
      </p>
    </div>
  );
}
