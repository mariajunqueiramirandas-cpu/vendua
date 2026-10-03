import type { DispatchInput, DispatchResult } from '@vendua/agent-runtime';
import type { Sql } from '../platform/db.ts';
import { laneOf } from './registry.ts';

const KIND = /^[a-z][a-z0-9_]*\.[a-z0-9_.]+$/;
const SUBJECT_KIND = /^[a-z][a-z0-9_]{0,40}$/;
const MAX_PAYLOAD = 32_000;

/**
 * The one producer (ADR 0030 decision 5): everything that wakes an actor — an inbound message,
 * a webhook, a merchant action, a timer — is a mailbox row written here, inside the transaction
 * that caused it. `(tenant_id, dedupe_key)` is unique, so a retried transaction or a
 * re-delivered webhook writes nothing new. Nothing else inserts mailbox rows or starts turns.
 *
 * `tx` must be scoped to `input.actor.tenantId` (withTenant) or be a control transaction.
 */
export async function dispatchTx(tx: Sql, input: DispatchInput): Promise<DispatchResult> {
  const { actor } = input;
  if (!KIND.test(input.kind) || input.kind.length > 80)
    throw new Error(`bad mailbox kind ${input.kind}`);
  if (!input.source || input.source.length > 120) throw new Error('mailbox source is 1–120 chars');
  if (!input.dedupeKey || input.dedupeKey.length > 200)
    throw new Error('dedupe key is 1–200 chars');
  if (!SUBJECT_KIND.test(actor.subject.kind))
    throw new Error(`bad subject kind ${actor.subject.kind}`);
  if (!actor.subject.id || actor.subject.id.length > 200)
    throw new Error('subject id is 1–200 chars');
  const payload = input.payload ?? null;
  // Postgres bounds the payload in bytes, not characters
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD)
    throw new Error('mailbox payload too large');
  const lane = laneOf(actor.agentId);

  // do nothing on conflict rather than upsert: no row lock taken here (the wake trigger's update
  // still waits for a step holding the fence, for the length of that step)
  let rows = await tx<{ id: string }[]>`
    insert into agent_actors (tenant_id, agent_id, subject_kind, subject_id, lane)
    values (${actor.tenantId}, ${actor.agentId}, ${actor.subject.kind}, ${actor.subject.id}, ${lane})
    on conflict (tenant_id, agent_id, subject_kind, subject_id) do nothing
    returning id`;
  if (!rows[0])
    rows = await tx<{ id: string }[]>`
      select id from agent_actors
      where tenant_id = ${actor.tenantId} and agent_id = ${actor.agentId}
        and subject_kind = ${actor.subject.kind} and subject_id = ${actor.subject.id}`;
  const actorId = rows[0]!.id;

  const inserted = await tx<{ id: string }[]>`
    insert into agent_mailbox (tenant_id, actor_id, kind, payload, source, dedupe_key, deliver_at)
    values (${actor.tenantId}, ${actorId}, ${input.kind}, ${JSON.stringify(payload)}::jsonb,
            ${input.source}, ${input.dedupeKey},
            coalesce(${input.deliverAt ?? null}::timestamptz, now()))
    on conflict (tenant_id, dedupe_key) do nothing
    returning id`;
  return { actorId, mailboxId: inserted[0]?.id ?? null, inserted: inserted.length > 0 };
}
