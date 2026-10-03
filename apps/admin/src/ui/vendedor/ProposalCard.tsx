import { ChatText, Check, ListChecks, PencilSimple } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Button } from '../Button.tsx';
import { cn } from '../cn.ts';
import { GuaranteeChip } from './chips.tsx';

/**
 * A Resposta or a Regra Duá proposes from what the owner said (the interview, a reply to a
 * handed-off shopper). Nothing is kept until "está certo"; a Regra wears its guarantee chip.
 */
export function ProposalCard({
  kind,
  source,
  question,
  answer,
  guaranteed,
  onAccept,
  onEdit,
  busy,
  className,
}: {
  kind: 'answer' | 'rule';
  /** "Da sua resposta anterior" */
  source?: ReactNode | undefined;
  /** the question an answer answers; a rule's own text */
  question: string;
  /** an answer's words; unused for a rule */
  answer?: string | null | undefined;
  /** for a rule: the system enforces it */
  guaranteed?: boolean | undefined;
  onAccept?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  busy?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <article
      className={cn(
        'flex flex-col gap-2 rounded-lg bg-surface p-4 ring-2 ring-spark depth-2',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="t-caption min-w-0 text-muted">{source}</p>
        <span className="t-caption inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-sunken px-2.5 font-semibold">
          {kind === 'answer' ? (
            <ChatText weight="bold" className="size-4" aria-hidden />
          ) : (
            <ListChecks weight="bold" className="size-4" aria-hidden />
          )}
          {kind === 'answer' ? 'resposta' : 'regra'}
        </span>
      </div>
      <p className="t-body-lg font-semibold leading-6">{question}</p>
      {kind === 'answer' && answer ? <p className="t-body-lg leading-6">{answer}</p> : null}
      {kind === 'rule' ? <GuaranteeChip guaranteed={!!guaranteed} className="self-start" /> : null}
      <p className="t-caption text-muted">Só vale depois do seu ok.</p>
      {onAccept || onEdit ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {onAccept ? (
            <Button icon={<Check weight="bold" />} onClick={onAccept} loading={!!busy}>
              está certo
            </Button>
          ) : null}
          {onEdit ? (
            <Button variant="secondary" icon={<PencilSimple weight="bold" />} onClick={onEdit}>
              editar
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
