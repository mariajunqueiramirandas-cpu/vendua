import {
  Compass,
  Hand,
  HandPalm,
  MagnifyingGlass,
  Package,
  Question,
  ShieldCheck,
  SpeakerSimpleSlash,
  User,
  Warning,
  type Icon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { ThreadClass, ThreadFloor } from '../../lib/api.ts';
import { cn } from '../cn.ts';
import { SELLER_EDGE } from './tones.ts';

const CHIP =
  'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[0.8125rem] font-semibold leading-[1.125rem]';

/** Why a conversation needs the store, in one word (Core's `owner_reason`, or a known one). */
const REASONS: { match: RegExp; word: string; Icon: Icon }[] = [
  { match: /alerg|restri|lactose|gl[uú]ten/i, word: 'alergia', Icon: Warning },
  { match: /reclama|atras|demor/i, word: 'reclamação', Icon: Warning },
  { match: /grande|acima|valor/i, word: 'pedido grande', Icon: Package },
  { match: /pessoa|humano|atendente/i, word: 'pediu uma pessoa', Icon: Hand },
];

export function reasonWord(reason: string): { word: string; Icon: Icon } {
  const known = REASONS.find((r) => r.match.test(reason));
  return known ?? { word: reason.replace(/^pergunta:\s*/i, '').slice(0, 40), Icon: Warning };
}

/** The reason a shopper waits for the store: warning, icon and word (alergia, reclamação…). */
export function ReasonChip({ reason, className }: { reason: string; className?: string }) {
  const { word, Icon: I } = reasonWord(reason);
  return (
    <span className={cn(CHIP, 'max-w-full bg-warning-soft text-warning', className)}>
      <I weight="bold" className="size-[15px] shrink-0" aria-hidden />
      <span className="truncate">{word}</span>
    </span>
  );
}

/**
 * How sure a rule is (sales-agent-ux §1.6): "sempre cumprida" for what the system enforces,
 * "orientação" for what Duá follows by judgement. The screens never promise more.
 */
export function GuaranteeChip({
  guaranteed,
  short,
  className,
}: {
  guaranteed: boolean;
  /** just "orientação" where the rule's own text already names Duá */
  short?: boolean | undefined;
  className?: string | undefined;
}) {
  return guaranteed ? (
    <span className={cn(CHIP, 'bg-success-soft text-success', className)}>
      <ShieldCheck weight="bold" className="size-[15px] shrink-0" aria-hidden />
      sempre cumprida
    </span>
  ) : (
    <span className={cn(CHIP, 'bg-sunken text-muted', className)}>
      <Compass weight="bold" className="size-[15px] shrink-0" aria-hidden />
      {short ? 'orientação' : 'o Duá segue como orientação'}
    </span>
  );
}

/** Who answers a conversation now, for the list and the app bar ("Duá atendendo", "você"). */
export function FloorChip({
  floor,
  waiting,
  className,
}: {
  floor: ThreadFloor;
  /** a shopper waiting for the store outranks the floor */
  waiting?: boolean | undefined;
  className?: string | undefined;
}) {
  let body: ReactNode;
  let tone: string;
  if (waiting) {
    tone = 'bg-warning-soft text-warning';
    body = (
      <>
        <Warning weight="bold" className="size-[15px]" aria-hidden />
        precisa de você
      </>
    );
  } else if (floor === 'agent' || floor === 'rehearsal') {
    tone = `bg-spark-soft text-ink ${SELLER_EDGE}`;
    body = (
      <>
        <span aria-hidden className="size-2 rounded-full bg-ink" />
        {floor === 'agent' ? 'Duá atendendo' : 'Duá em ensaio'}
      </>
    );
  } else if (floor === 'store' || floor === 'wait') {
    tone = 'bg-sunken text-ink';
    body = (
      <>
        <HandPalm weight="bold" className="size-[15px]" aria-hidden />
        você
      </>
    );
  } else if (floor === 'muted') {
    tone = 'bg-sunken text-muted';
    body = (
      <>
        <SpeakerSimpleSlash weight="bold" className="size-[15px]" aria-hidden />
        não é cliente
      </>
    );
  } else {
    tone = 'bg-sunken text-muted';
    body = 'sem atendimento';
  }
  return <span className={cn(CHIP, tone, className)}>{body}</span>;
}

const CLASSES: Partial<Record<ThreadClass, { word: string; tone: string; Icon: Icon }>> = {
  checking: { word: 'vendo se é cliente', tone: 'bg-sunken text-muted', Icon: MagnifyingGlass },
  ask: { word: 'para decidir', tone: 'bg-warning-soft text-warning', Icon: Question },
  personal: { word: 'pessoal', tone: 'bg-sunken text-muted', Icon: User },
};

/** Where Duá stands on who a contact is, when he isn't answering them: null for the rest. */
export function ClassChip({ cls, className }: { cls: ThreadClass; className?: string }) {
  const c = CLASSES[cls];
  if (!c) return null;
  return (
    <span className={cn(CHIP, c.tone, className)}>
      <c.Icon weight="bold" className="size-[15px] shrink-0" aria-hidden />
      {c.word}
    </span>
  );
}

/** A thread Duá stays out of until it knows who the contact is (or knows it's personal). */
export const triaged = (cls: ThreadClass) =>
  cls === 'checking' || cls === 'ask' || cls === 'personal';
