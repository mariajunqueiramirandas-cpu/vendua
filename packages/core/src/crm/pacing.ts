import type { Sql } from '../platform/db.ts';
import { PLATFORM_TENANT_ID } from '../platform/tenancy.ts';
import { CRM_AGENT_ID, LEAD_SUBJECT } from './jobs.ts';

// When the agent answers a lead, paced like a person on WhatsApp (guardrails.humanReplyPacing).
// A cold opener goes out at once (firstContactDelayMin). A lead who took more than ten minutes
// to answer us isn't watching the chat, so the answer comes four to nine minutes later; one who
// answers fast is in the conversation, so it comes within a minute. A bare "oi, boa tarde" is
// followed by what they want, so it waits for that, and a new message while an answer waits
// holds it until they stop typing: nobody answers half a thought.

export const ACTIVE_GAP_MS = 10 * 60_000;
const MIN = 60_000;

/** ms before the answer starts, from how long the lead took to answer our latest send (null:
 *  nothing of ours went out — they wrote first). */
export function replyDelayMs(
  gapMs: number | null,
  greetingOnly: boolean,
  rand: () => number = Math.random,
): number {
  if (gapMs !== null && gapMs > ACTIVE_GAP_MS) return Math.round(4 * MIN + rand() * 5 * MIN);
  if (greetingOnly) return Math.round(40_000 + rand() * 20_000);
  return Math.round(rand() * MIN);
}

/** while an answer waits, each new message holds it this long after itself */
export function typingHoldMs(rand: () => number = Math.random): number {
  return Math.round(20_000 + rand() * 20_000);
}

// repeated letters collapse first ("oiii" → "oi", "olaaa" → "ola", "hello" → "helo")
const GREETING_WORDS = new Set([
  'oi',
  'oie',
  'ola',
  'opa',
  'eai',
  'e',
  'ai',
  'bom',
  'boa',
  'dia',
  'tarde',
  'noite',
  'tudo',
  'bem',
  'td',
  'certo',
  'beleza',
  'blz',
  'tranquilo',
  'como',
  'vai',
  'voce',
  'vc',
  'pesoal',
  'helo',
  'hi',
  'hey',
  'alo',
]);

/** "Olá boa tarde", "oi, tudo bem?": a greeting with nothing yet to answer. */
export function isBareGreeting(body: string): boolean {
  const words = body
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/(.)\1+/g, '$1'));
  return words.length > 0 && words.length <= 6 && words.every((w) => GREETING_WORDS.has(w));
}

/**
 * When to start the answer to an inbound just recorded on `leadId`: null = now. Runs in the
 * transaction that records it, before its mailbox row is written. An answer already waiting is
 * held for this message too: its rows move (only ever later, never earlier than they were) so the
 * one turn reads the whole burst. A turn already running takes it now and is preempted.
 */
export async function humanReplyAtTx(
  tx: Sql,
  leadId: string,
  body: string,
  rand: () => number = Math.random,
): Promise<Date | null> {
  const [row] = await tx<{ pending: Date | null; running: boolean; gap_ms: number | null }[]>`
    with actor as (
      select id, lease_until from agent_actors
      where tenant_id = ${PLATFORM_TENANT_ID} and agent_id = ${CRM_AGENT_ID}
        and subject_kind = ${LEAD_SUBJECT} and subject_id = ${leadId}
    ), ours as (
      select max(coalesce(o.dispatch_attempted_at, o.created_at)) as at
      from lead_messages o join lead_threads t on t.id = o.thread_id
      where t.lead_id = ${leadId} and t.channel <> 'manual' and o.direction = 'out'
        and not o.historical and o.status in ('sending', 'sent', 'delivered')
    )
    select
      (select max(m.deliver_at) from agent_mailbox m join actor on actor.id = m.actor_id
        where m.kind = 'message.inbound' and m.consumed_by_turn is null) as pending,
      exists (select 1 from actor where lease_until > now()) as running,
      (select (extract(epoch from (clock_timestamp() - ours.at)) * 1000)::float8 from ours) as gap_ms`;
  if (!row || row.running) return null;
  if (row.pending) {
    const hold = new Date(Date.now() + typingHoldMs(rand));
    const at = row.pending > hold ? row.pending : hold;
    // only later: the actor's next_wake_at may stay early, and an early wake finds nothing due
    await tx`
      update agent_mailbox m set deliver_at = ${at}
      from agent_actors a
      where a.id = m.actor_id and a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_AGENT_ID}
        and a.subject_kind = ${LEAD_SUBJECT} and a.subject_id = ${leadId}
        and m.kind = 'message.inbound' and m.consumed_by_turn is null and m.deliver_at < ${at}`;
    return at;
  }
  return new Date(Date.now() + replyDelayMs(row.gap_ms, isBareGreeting(body), rand));
}
