import type { ReactNode } from 'react';
import { cn } from './cn.ts';

export type DayPhase = 'dawn' | 'open' | 'paused' | 'dusk';

// The living store (§6.1): the hero's light follows the store's day. Dawn cream to
// pale peach before opening, fresh cream with a breathing lime halo while open,
// desaturated when paused, dusk into night once closed. Noite deepens each.
const BG: Record<DayPhase, { creme: string; noite: string; ink: 'ink' | 'light' }> = {
  dawn: {
    creme: 'linear-gradient(160deg, #fffaf0 0%, #fde6cf 55%, #f8d3bc 100%)',
    noite: 'linear-gradient(160deg, #1d1a14 0%, #2a2018 60%, #33231b 100%)',
    ink: 'ink',
  },
  open: {
    creme: 'linear-gradient(160deg, #fffdf8 0%, #f5f7e6 55%, #eaf3d6 100%)',
    noite: 'linear-gradient(160deg, #16211b 0%, #18261c 55%, #1c2d1c 100%)',
    ink: 'ink',
  },
  paused: {
    creme: 'linear-gradient(160deg, #f4f2ec 0%, #e9e6dc 100%)',
    noite: 'linear-gradient(160deg, #161a18 0%, #1c201e 100%)',
    ink: 'ink',
  },
  dusk: {
    creme: 'linear-gradient(165deg, #2b3a4f 0%, #1c2a33 45%, #0f1a17 100%)',
    noite: 'linear-gradient(165deg, #151b28 0%, #0d1411 100%)',
    ink: 'light',
  },
};

export function HeroCard({
  phase,
  children,
  className,
}: {
  phase: DayPhase;
  children: ReactNode;
  className?: string;
}) {
  const bg = BG[phase];
  return (
    <section
      className={cn(
        'relative isolate overflow-hidden rounded-xl p-6 depth-2 md:p-8',
        bg.ink === 'light' ? 'text-[#f7f4ea]' : 'text-ink',
        className,
      )}
      style={{ background: 'var(--hero-bg)' }}
      data-phase={phase}
    >
      <style>{`
        section[data-phase='${phase}']{--hero-bg:${bg.creme}}
        [data-theme='noite'] section[data-phase='${phase}']{--hero-bg:${bg.noite}}
      `}</style>
      {phase === 'open' ? (
        <div
          aria-hidden
          className="animate-breathe absolute -right-16 -top-24 -z-10 size-80 rounded-full bg-spark blur-3xl noite:[animation-name:none] noite:opacity-[0.07]"
        />
      ) : null}
      {/* the store's own accent: a faint glow in one corner */}
      <div
        aria-hidden
        className="absolute -bottom-24 -left-20 -z-10 size-72 rounded-full opacity-[0.12] blur-3xl"
        style={{ background: 'var(--store-accent)' }}
      />
      {phase === 'dusk' ? (
        <div aria-hidden className="absolute inset-0 -z-10 opacity-60">
          {[
            [12, 18],
            [28, 30],
            [70, 14],
            [84, 36],
            [56, 24],
            [92, 10],
          ].map(([x, y], i) => (
            <span
              key={i}
              className="absolute size-[3px] rounded-full bg-[#f7f4ea]"
              style={{ left: `${x}%`, top: `${y}%`, opacity: 0.5 + (i % 3) * 0.15 }}
            />
          ))}
        </div>
      ) : null}
      {children}
    </section>
  );
}
