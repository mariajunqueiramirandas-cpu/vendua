import { Check } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '../cn.ts';
import { PersonaAvatar } from './PersonaAvatar.tsx';

export type AgentPart = 'conhecer' | 'ensinar' | 'testar' | 'comecar';

export const AGENT_PARTS: { id: AgentPart; label: string }[] = [
  { id: 'conhecer', label: 'Conhecer' },
  { id: 'ensinar', label: 'Ensinar' },
  { id: 'testar', label: 'Testar' },
  { id: 'comecar', label: 'Começar' },
];

/**
 * The header of "Treinar a Ana" (sales-agent-ux §3.12): the store onboarding's journey bar
 * with the Vendedor's four parts, her name and avatar, and the way out ("continuar depois").
 */
export function AgentJourney({
  name,
  part,
  progress,
  status,
  exit,
}: {
  name: string;
  part: AgentPart;
  /** 0..1 inside the current part */
  progress: number;
  /** "3 de 7", "pronto!" */
  status: string;
  exit?: ReactNode | undefined;
}) {
  const at = AGENT_PARTS.findIndex((p) => p.id === part);
  const fill = Math.min(1, Math.max(0, progress));
  const overall = Math.round(((at + fill) / AGENT_PARTS.length) * 100);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/95 pt-[env(safe-area-inset-top)] backdrop-blur-sm kb:static">
      <div className="mx-auto max-w-6xl px-4 pb-2.5 pt-2 md:px-8">
        <div className="flex min-h-12 items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-2 font-display text-[1.0625rem] font-semibold">
            <PersonaAvatar name={name} size="xs" />
            <span className="truncate">Treinar a {name}</span>
          </p>
          {exit}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={overall}
          aria-valuetext={`${AGENT_PARTS[at]?.label ?? ''}: ${status}`}
          aria-label="andamento"
        >
          <ol className="grid grid-cols-4 gap-1.5">
            {AGENT_PARTS.map((p, i) => {
              const done = i < at || (i === at && fill >= 1);
              const now = i === at;
              return (
                <li key={p.id} className="min-w-0">
                  <span className="block h-1.5 overflow-hidden rounded-full bg-line-strong">
                    <span
                      className="block h-full rounded-full bg-primary transition-[width] duration-(--duration-smooth) ease-(--ease-soft)"
                      style={{ width: `${i < at ? 100 : now ? Math.max(fill, 0.06) * 100 : 0}%` }}
                    />
                  </span>
                  <span
                    className={cn(
                      'mt-1 flex items-center gap-1 truncate text-[0.75rem] leading-4',
                      now ? 'font-semibold text-ink' : 'text-muted',
                    )}
                  >
                    {done ? <Check weight="bold" className="size-3 shrink-0 text-success" /> : null}
                    <span className="truncate">{p.label}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </header>
  );
}

const still = () =>
  navigator.webdriver || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Ana guiding her own onboarding, in first person: her avatar beside a speech bubble (the
 * store onboarding's `Guide`, with the persona instead of Duá). It "types" for a beat when
 * the turn changes; the bubble keeps its final size meanwhile, so nothing below jumps.
 */
export function AgentGuide({
  name,
  turn,
  children,
}: {
  name: string;
  /** changes with each question: replays the typing beat */
  turn: string;
  children: ReactNode;
}) {
  const [typing, setTyping] = useState(() => !still());
  useEffect(() => {
    if (still()) return setTyping(false);
    setTyping(true);
    const t = setTimeout(() => setTyping(false), 520);
    return () => clearTimeout(t);
  }, [turn]);
  return (
    <div className="flex items-end gap-3">
      <PersonaAvatar name={name} size="md" />
      <div
        aria-live="polite"
        className="t-body-lg min-h-12 min-w-0 rounded-lg rounded-bl-sm bg-surface px-4 py-3 depth-1"
      >
        <span className="sr-only">{name}: </span>
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
