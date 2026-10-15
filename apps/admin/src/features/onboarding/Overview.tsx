import { ArrowRight, Check, Confetti } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Button } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { Mascote } from '../../ui/Mascote.tsx';
import { CHAPTERS, type ChapterId } from './flow.ts';

export interface ChapterProgress {
  id: ChapterId;
  /** answered or left for later */
  done: number;
  total: number;
  /** of `done`, left for later */
  later?: number;
}

/**
 * The four parts of the store as one path, each with how much of it is ready, ending where the
 * store goes live.
 */
export function ChapterList({
  progress,
  current,
}: {
  progress?: ChapterProgress[];
  current?: ChapterId | null;
}) {
  const shown = CHAPTERS.filter((c) => !progress || progress.find((x) => x.id === c.id)?.total);
  return (
    <ol className="relative">
      {shown.map((c, i) => {
        const p = progress?.find((x) => x.id === c.id);
        const full = !!p && p.total > 0 && p.done >= p.total;
        const now = current === c.id;
        return (
          <li
            key={c.id}
            className="relative flex gap-4 pb-5"
            aria-current={now ? 'step' : undefined}
          >
            {/* the path from this part to the next */}
            <span
              aria-hidden
              className={cn(
                'absolute bottom-0 left-[1.375rem] top-12 w-0.5 -translate-x-1/2 rounded-full',
                full ? 'bg-success/50' : 'bg-line-strong',
              )}
            />
            <span
              className={cn(
                'relative grid size-11 shrink-0 place-items-center rounded-full',
                full
                  ? 'bg-success-soft text-success'
                  : now
                    ? 'bg-primary text-on-primary ring-4 ring-spark/60'
                    : 'bg-surface text-ink ring-1 ring-line-strong depth-1',
              )}
            >
              {full ? (
                <Check weight="bold" className="size-5" aria-label="pronto" />
              ) : (
                <c.Icon weight="duotone" className="size-6" aria-hidden />
              )}
            </span>
            <span className="min-w-0 flex-1 pt-0.5">
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">
                  <span className="t-caption tnum mr-1.5 text-muted">Parte {i + 1}</span>
                  {c.label}
                </span>
                {full && p.later ? (
                  <span className="t-caption tnum shrink-0 font-semibold text-warning">
                    {p.later} para depois
                  </span>
                ) : full ? (
                  <span className="t-caption shrink-0 font-semibold text-success">pronto</span>
                ) : p && p.done > 0 ? (
                  <span className="t-caption tnum shrink-0 font-semibold text-ink">
                    {p.done} de {p.total}
                  </span>
                ) : p ? (
                  <span className="t-caption tnum shrink-0 text-muted">
                    {p.total} {p.total === 1 ? 'pergunta' : 'perguntas'}
                  </span>
                ) : null}
              </span>
              <span className="t-body block text-muted">{c.blurb}</span>
              {now ? (
                <span className="t-caption mt-1.5 inline-flex rounded-full bg-spark px-2 py-0.5 font-semibold text-on-spark">
                  você parou aqui
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
      <li className="flex items-center gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-spark text-on-spark">
          <Confetti weight="duotone" className="size-6" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold">Loja no ar</span>
          <span className="t-body block text-muted">O link, o QR code e a primeira venda</span>
        </span>
      </li>
    </ol>
  );
}

/**
 * The wizard's first screen. A store that never started gets the welcome; one that comes back
 * gets the same path with what's ready ticked and a button to the next open question.
 */
export function Welcome({
  first,
  questions,
  minutes,
  progress,
  resume,
  complete,
  later,
  onStart,
  onReview,
  onLeave,
}: {
  first: string;
  questions: number;
  /** a rough time for all of it */
  minutes: number;
  progress: ChapterProgress[];
  /** where a returning merchant picks up: the question's own words */
  resume: { label: string; chapter: ChapterId } | null;
  /** back with every question answered (or left for later) */
  complete: boolean;
  /** how many were left for later */
  later: number;
  onStart: () => void;
  /** a complete store goes over its answers from the first */
  onReview: () => void;
  onLeave: () => void;
}) {
  const again = !!resume || complete;
  const hi = first ? `, ${first}` : '';
  return (
    <div className="space-y-7">
      <div className="flex items-center gap-4 sm:gap-5">
        <span
          aria-hidden
          className="dua-disc animate-bob grid size-20 shrink-0 place-items-center bg-spark-soft sm:size-24"
        >
          <Mascote pose="avatar-ola" size={96} className="size-[72px] sm:size-[88px]" />
        </span>
        <div className="min-w-0">
          <p className="t-moment text-[1.75rem] leading-8 text-ink sm:text-[2rem] sm:leading-9">
            {again ? `Que bom te ver${hi}!` : `Oi${hi}!`}
          </p>
          <p className="t-body text-muted">
            {again
              ? 'Guardei tudo o que você já fez.'
              : 'Eu sou o Duá. Vou montar a loja com você.'}
          </p>
        </div>
      </div>
      <div>
        <h1 className="t-title-1 text-balance md:text-[2.25rem] md:leading-[2.75rem]">
          {complete
            ? 'Sua loja já está montada'
            : resume
              ? 'Bora continuar a sua loja?'
              : 'Vamos montar a sua loja?'}
        </h1>
        <p className="t-body-lg mt-2 text-pretty text-muted">
          {complete
            ? later
              ? `Você passou por todas as perguntas, e ${later} ${later === 1 ? 'ficou' : 'ficaram'} para depois: o final mostra ${later === 1 ? 'qual' : 'quais'}. Dá para rever qualquer resposta.`
              : 'Todas as perguntas estão respondidas. Dá para rever qualquer resposta, ou ir direto para o fim.'
            : resume
              ? 'Falta pouco. Você continua de onde parou.'
              : `São ${questions} perguntas rápidas, uma por vez: uns ${minutes} minutos. Se precisar parar, é só sair. Eu guardo tudo.`}
        </p>
      </div>
      <ChapterList progress={progress} current={resume?.chapter ?? null} />
      <div className="space-y-1">
        <Button size="lg" block onClick={onStart}>
          {complete ? 'Ver a loja pronta' : resume ? `Continuar: ${resume.label}` : 'Bora começar'}{' '}
          <ArrowRight />
        </Button>
        {complete ? (
          <Button variant="ghost" block onClick={onReview}>
            rever as respostas desde o começo
          </Button>
        ) : null}
        <Link
          to="/"
          onClick={onLeave}
          className="t-label flex min-h-12 items-center justify-center text-muted underline underline-offset-2"
        >
          {again ? 'agora não, ir para o painel' : 'já sei mexer, ir direto ao painel'}
        </Link>
      </div>
    </div>
  );
}
