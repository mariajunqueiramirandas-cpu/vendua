import type { Sql } from '../platform/db.ts';

// A business's own machine answering our outreach: the WhatsApp Business greeting or away
// message, an Instagram instant reply, a chatbot menu, an email autoresponder. It lands seconds
// after our send, speaks in a template's voice and answers nothing we asked. It is context (the
// hours, the catalog link), never a reply: it wakes no turn, retires no follow-up and resets no
// unanswered-touch count. A person who reads a robot's "como podemos ajudar?" waits for the human.

/** WhatsApp fires its greeting and away messages within seconds of a delivery; the margin
 *  covers the gateway pump. A message later than this came from a person. */
export const MACHINE_WINDOW_MS = 120_000;

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// says a machine or an absence answered — on its own enough
const DECLARED: readonly RegExp[] = [
  /\b(mensagem|resposta|atendimento) automatic/,
  /\bassistente virtual\b|\b(sou|e) (um|uma|o|a) (robo|bot|chatbot)\b/,
  /\bfora d[oe] (nosso |seu )?horario\b/,
  /\b(retornaremos|responderemos)\b/,
  /\bno momento,? (nao (estamos|podemos|conseguimos)|estamos (ausentes|fechad|indisponive))/,
];
// a template's voice — no person greets a cold pitch like this; on its own enough
const STRONG: readonly RegExp[] = [
  /\bbem[- ]?vind[oa]s?\b/,
  /wa\.me\/c\//,
  /\b(agradecemos|obrigad[oa]s?) (o |a |pelo |pela |por |seu |sua )*(contato|mensagem|preferencia|entrar em contato)\b/,
  /\bdigite\b.{0,30}\b(numero|opcao|\d)\b|\bescolha uma (das )?opco|\bopcao \d\b/,
  /\b(um|uma) de nossos? (atendentes|consultor|colaborador)/,
];
// business boilerplate a person may also type — two of them make a template
const WEAK: readonly RegExp[] = [
  /\b(como|em que) (podemos|posso) (te |lhe )?ajud/,
  /\bnosso atendimento\b|\bhorario de (atendimento|funcionamento)\b/,
  /\b(seg|segunda)(-feira)?\.? ?(a|ate) ?(sex|sab)/,
  /\b\d{1,2} ?h(\d{2})? ?(as|a|-|ate) ?\d{1,2} ?h\b/,
  /\b(cardapio|catalogo)\b/,
  /\b(faca|faz) (ja )?(o )?seu pedido\b|\baguarde\b|\bem breve\b/,
];

/** How much a message reads like a template: 2 or more is a machine's. */
export function autoReplyScore(body: string): number {
  const t = fold(body);
  const hits = (rs: readonly RegExp[]) => rs.filter((r) => r.test(t)).length;
  return 2 * hits(DECLARED) + 2 * hits(STRONG) + hits(WEAK);
}

/** `gapMs`: from our latest send to this message, null when nothing of ours is waiting on an
 *  answer (they wrote first, or a person already answered it). */
export function looksAutomated(body: string, gapMs: number | null): boolean {
  if (gapMs === null || gapMs > MACHINE_WINDOW_MS) return false;
  return autoReplyScore(body) >= 2;
}

/**
 * Whether an inbound about to land on `threadId` is the business's machine answering our latest
 * send there. Earlier auto replies to the same send don't count as a person having answered (a
 * greeting is often followed by a menu). `at` is the provider's timestamp when it has one, so a
 * pump that ran late doesn't turn a greeting into a person; the gap is measured on the DB clock.
 */
export async function isAutoReplyTx(
  tx: Sql,
  threadId: string,
  body: string,
  at: Date | null,
): Promise<boolean> {
  if (autoReplyScore(body) < 2) return false;
  const [ours] = await tx<{ gap_ms: number | null; answered: boolean }[]>`
    with ours as (
      select coalesce(o.dispatch_attempted_at, o.created_at) as at
      from lead_messages o
      where o.thread_id = ${threadId} and o.direction = 'out' and not o.historical
        and o.status in ('sending', 'sent', 'delivered')
      order by coalesce(o.dispatch_attempted_at, o.created_at) desc limit 1
    )
    select greatest(0, extract(epoch from (coalesce(${at}::timestamptz, clock_timestamp()) - ours.at)) * 1000)::float8 as gap_ms,
      exists (
        select 1 from lead_messages i
        where i.thread_id = ${threadId} and i.direction = 'in' and not i.historical
          and not i.auto_reply and i.received_at > ours.at
      ) as answered
    from ours`;
  if (!ours || ours.answered) return false;
  return looksAutomated(body, ours.gap_ms);
}
