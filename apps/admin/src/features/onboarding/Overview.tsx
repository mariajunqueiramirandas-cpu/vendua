import { ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Button } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { CHAPTERS, type ChapterId } from './flow.ts';

export interface ChapterProgress {
  id: ChapterId;
  done: number;
  total: number;
}

/** The four parts of the store, each with how much of it is ready. */
export function ChapterList({
  progress,
  current,
}: {
  progress?: ChapterProgress[];
  current?: ChapterId | null;
}) {
  return (
    <ol className="space-y-2">
      {CHAPTERS.map((c, i) => {
        const p = progress?.find((x) => x.id === c.id);
        if (progress && !p?.total) return null;
        const full = !!p && p.total > 0 && p.done >= p.total;
        const now = current === c.id;
        return (
          <li
            key={c.id}
            className={cn(
              'flex min-h-18 items-center gap-4 rounded-lg px-4 py-3',
              now ? 'bg-spark-soft ring-2 ring-primary' : 'bg-surface depth-1',
            )}
            aria-current={now ? 'step' : undefined}
          >
            <span
              className={cn(
                'grid size-12 shrink-0 place-items-center rounded-full',
                now ? 'bg-primary text-on-primary' : 'bg-sunken',
              )}
            >
              <c.Icon weight="duotone" className="size-6" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="t-caption tnum block text-muted">Parte {i + 1}</span>
              <span className="block font-semibold">{c.label}</span>
              <span className="t-caption block text-muted">{c.blurb}</span>
            </span>
            {full ? (
              <CheckCircle
                weight="fill"
                className="size-7 shrink-0 text-success"
                aria-label="pronto"
              />
            ) : p && p.done > 0 ? (
              <span className="t-caption tnum shrink-0 font-semibold text-muted">
                {p.done}/{p.total}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The wizard's first screen. A store that never started gets the welcome; one that comes back
 * gets the same map with what's ready ticked and a button to the next open question.
 */
export function Welcome({
  first,
  questions,
  progress,
  resume,
  onStart,
  onLeave,
}: {
  first: string;
  questions: number;
  progress: ChapterProgress[];
  /** where a returning merchant picks up: the question's own words */
  resume: { label: string; chapter: ChapterId } | null;
  onStart: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="t-title-1 md:text-[2rem] md:leading-[2.5rem]">
          {resume ? `Bora continuar, ${first}?` : 'Vamos montar a sua loja?'}
        </h1>
        <p className="t-body-lg mt-2 text-muted">
          {resume
            ? 'O que você já fez está guardado. Falta pouco.'
            : `São ${questions} perguntinhas em quatro partes, uma de cada vez. Se cansar, pode sair: eu guardo tudo.`}
        </p>
      </div>
      <ChapterList progress={progress} current={resume?.chapter ?? null} />
      <Button size="lg" block onClick={onStart}>
        {resume ? `Continuar: ${resume.label}` : 'Bora começar'} <ArrowRight />
      </Button>
      <Link
        to="/"
        onClick={onLeave}
        className="t-label flex min-h-12 items-center justify-center text-muted underline underline-offset-2"
      >
        {resume ? 'agora não, ir para o painel' : 'já sei mexer, ir direto ao painel'}
      </Link>
    </div>
  );
}
