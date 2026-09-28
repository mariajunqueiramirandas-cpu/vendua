import { useEffect, useState, type ReactNode } from 'react';
import { ArtPudim } from '../../ui/illustrations.tsx';

// The friendly voice of the wizard: a pudim that bobs beside a speech bubble. It "types"
// for a beat whenever the question changes, so each step feels like someone talking.
const still = () =>
  navigator.webdriver || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Guide({ turn, children }: { turn: string; children: ReactNode }) {
  const [typing, setTyping] = useState(() => !still());
  useEffect(() => {
    if (still()) return setTyping(false);
    setTyping(true);
    const t = setTimeout(() => setTyping(false), 520);
    return () => clearTimeout(t);
  }, [turn]);
  return (
    <div className="flex items-end gap-3">
      <div
        aria-hidden
        className="animate-bob grid h-16 w-20 shrink-0 place-items-center rounded-lg bg-spark-soft text-ink [&_svg]:w-full"
      >
        <ArtPudim />
      </div>
      <div
        aria-live="polite"
        className="t-body-lg min-h-12 min-w-0 rounded-lg rounded-bl-sm bg-surface px-4 py-3 depth-1"
      >
        {typing ? (
          <span className="flex h-6 items-center gap-1.5" aria-label="digitando">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="animate-dot size-2 rounded-full bg-faint"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
        ) : (
          <span className="animate-fade-up block">{children}</span>
        )}
      </div>
    </div>
  );
}
