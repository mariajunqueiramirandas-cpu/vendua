import { useEffect, useState, type ReactNode } from 'react';
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
