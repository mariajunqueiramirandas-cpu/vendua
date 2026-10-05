import { Question, User } from '@phosphor-icons/react';
import { useCan } from '../../lib/session.ts';
import type { ReactNode } from 'react';
import type { ClassReason, ClassSource, ThreadRow } from '../../lib/api.ts';
import { Button } from '../../ui/Button.tsx';

export type ClassifyAs = 'shopper' | 'personal';

/**
 * Why a contact has its class, from Core's code. Never the contact's words: the messages Duá read
 * to decide are gone once it decided.
 */
export function classWhy(
  reason: ClassReason | null,
  source: ClassSource | null,
  cls: ThreadRow['class'],
): string | null {
  const read = source === 'history';
  switch (reason) {
    case 'ordered_before':
      return 'Já fez pedido na loja.';
    case 'owner_marked':
      return source === 'command'
        ? 'Você marcou pelo seu WhatsApp.'
        : cls === 'personal'
          ? 'Você marcou como pessoal.'
          : 'Você marcou como cliente.';
    case 'no_prior_chat':
      return 'Número novo: vocês nunca tinham conversado.';
    case 'looks_personal':
      return read
        ? 'Pelas últimas mensagens de vocês, parece conversa pessoal.'
        : 'Pela mensagem, parece conversa pessoal.';
    case 'looks_customer':
      return read
        ? 'Pelas últimas mensagens de vocês, parece cliente.'
        : 'Pela mensagem, parece cliente.';
    case 'unclear':
      return 'As últimas mensagens de vocês não deixam claro.';
    case 'history_unavailable':
      return 'Ele não conseguiu ler as mensagens anteriores de vocês.';
    case 'known_only':
      return 'Você escolheu que o Duá só atende quem já é cliente.';
    case 'everyone':
      return 'Você escolheu que o Duá atende todo mundo.';
    case 'not_a_shopper':
      return 'A mensagem não parece de cliente.';
    default:
      return null;
  }
}

/**
 * The floor while Duá stays out of a contact (checking, ask, personal): where he stands, why, and
 * the owner's call. It replaces the composer, like a muted number: the owner answers these from
 * their own phone.
 */
export function TriageFloor({
  t,
  onClassify,
  busy,
}: {
  t: ThreadRow;
  onClassify: (as: ClassifyAs) => void;
  /** the decision in flight */
  busy: ClassifyAs | null;
}) {
  const why = classWhy(t.classReason, t.classSource, t.class);
  let icon: ReactNode;
  let title: string;
  let hint: string | null;
  let actions: ClassifyAs[];
  // "é pessoal" erases the contact's messages: Core takes it from managers and up only
  const canPersonal = useCan('manager');
  if (t.class === 'checking') {
    icon = <span aria-hidden className="animate-pulse-dot size-2 rounded-full bg-ink" />;
    title = 'O Duá está vendo se é cliente…';
    hint = 'Ele lê as últimas mensagens de vocês e decide em instantes. Até lá, não responde.';
    actions = ['shopper', 'personal'];
  } else if (t.class === 'ask') {
    icon = <Question weight="bold" className="size-5 text-warning" aria-hidden />;
    title = 'O Duá não sabe se é cliente';
    hint = why ? `${why} Ele não responde até você decidir.` : 'Ele não responde até você decidir.';
    actions = ['shopper', 'personal'];
  } else {
    icon = <User weight="bold" className="size-5 text-muted" aria-hidden />;
    title = 'Contato pessoal: o Duá não responde';
    // Core erases what a personal contact wrote and the gateway stops storing it
    hint = `${why ? `${why} ` : ''}As mensagens desse contato não ficam guardadas na Venduá.`;
    actions = ['shopper'];
  }
  return (
    <section
      aria-label="quem o Duá atende"
      aria-live="polite"
      className="glass flex flex-col gap-3 border-t border-line px-3.5 pb-4 pt-3"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          {hint ? <p className="t-caption text-muted">{hint}</p> : null}
        </div>
      </div>
      <div className="flex gap-2">
        {actions
          .filter((as) => as !== 'personal' || canPersonal)
          .map((as) => (
            <Button
              key={as}
              // the open question gets the weight; while Duá is still reading, deciding is optional
              variant={t.class === 'ask' && as === 'shopper' ? 'primary' : 'secondary'}
              className="min-w-0 flex-1 md:flex-none"
              loading={busy === as}
              disabled={!!busy && busy !== as}
              onClick={() => onClassify(as)}
            >
              {as === 'shopper' ? 'é cliente' : 'é pessoal'}
            </Button>
          ))}
      </div>
    </section>
  );
}

/**
 * Where the conversation starts: why Duá took a contact he judged himself (a new number, or what
 * the chat looked like), with the way to correct him.
 */
export function WhyShopper({
  t,
  onPersonal,
  busy,
}: {
  t: ThreadRow;
  onPersonal: () => void;
  busy: boolean;
}) {
  const canPersonal = useCan('manager');
  const judged =
    t.class === 'shopper' &&
    (t.classSource === 'history' || t.classSource === 'new_contact' || t.classSource === 'message');
  const why = judged ? classWhy(t.classReason, t.classSource, t.class) : null;
  if (!why) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center justify-center gap-x-1 text-center">
      <p className="t-caption text-muted">
        <span className="font-semibold text-ink">Por que o Duá atende: </span>
        {why}
      </p>
      {canPersonal ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-11 px-2 underline underline-offset-2"
          loading={busy}
          onClick={onPersonal}
        >
          é pessoal
        </Button>
      ) : null}
    </div>
  );
}
