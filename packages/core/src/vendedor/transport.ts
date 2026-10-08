import type { FencedTx, OutboundMessage, Transport } from '@vendua/agent-runtime';
import { emitAdminTx } from '../admin/live.ts';
import type { Sql } from '../platform/db.ts';
import { renderCard } from './cards.ts';
import { writes } from './floor.ts';
import { loadAgent } from './settings.ts';
import { loadStoreSettings, mustThread, storeStatus, threadFloor } from './threads.ts';

const JID = /^[0-9:.]{1,40}@(s\.whatsapp\.net|lid)$/;
const BR_PHONE = /^\d{10,11}$/;
const MAX_BODY = 2000;

/**
 * The Vendedor's replies (ADR 0031): rows of `shopper_messages` written in the step's
 * transaction, so a message exists only if its step committed. On WhatsApp each also gets a
 * `chat` row on the store's outbox (ADR 0026), addressed by jid; in Ensaio it stays a draft;
 * the admin's test chat and Cliente oculto read the rows directly. `agent_step` is unique per
 * store: a re-run step finds its rows instead of writing copies.
 */
export const vendedorTransport: Transport<Sql> = {
  id: 'vendedor',
  async send(tx: FencedTx<Sql>, msg: OutboundMessage) {
    const sql = tx.host;
    const tenantId = msg.tenantId;
    const thread = await mustThread(sql, tenantId, msg.subject.id, { forUpdate: true });
    const agent = await loadAgent(sql, tenantId);
    const now = new Date();
    const floor = threadFloor(
      thread,
      agent,
      storeStatus(await loadStoreSettings(sql, tenantId), now),
      now,
    ).floor;
    const status =
      floor === 'rehearsal'
        ? 'draft'
        : !writes(floor)
          ? 'skipped'
          : thread.channel === 'whatsapp'
            ? 'queued'
            : 'sent';

    const parts: { author: 'agent' | 'core'; kind: string; body: string; meta: object }[] = [];
    if (msg.text.trim())
      parts.push({ author: 'agent', kind: 'text', body: msg.text.slice(0, MAX_BODY), meta: {} });
    // pending cards outlive a superseded turn: a summary the thread no longer holds is stale
    const cards = msg.cards.filter(
      (c) => c.kind !== 'summary' || (c.data as { id?: string }).id === thread.summary?.id,
    );
    for (const card of cards)
      for (const body of renderCard(card))
        parts.push({
          author: 'core',
          kind: card.kind === 'pix' ? 'pix' : 'card',
          body: body.slice(0, MAX_BODY),
          meta: { card: card.kind, data: card.data },
        });
    const [lastIn] = await sql<{ kind: string }[]>`
      select kind from shopper_messages
      where tenant_id = ${tenantId} and thread_id = ${thread.id} and author = 'shopper'
      order by created_at desc limit 1`;
    // a voice reply speaks the words; amounts and the Pix code stay as text cards
    const voice =
      agent.settings.voiceReplies && lastIn?.kind === 'audio' && thread.channel === 'whatsapp';

    const ids: string[] = [];
    for (const [i, p] of parts.entries()) {
      const step = `${msg.actorId}:${msg.turnId}:${msg.step}#${i}`;
      const meta = {
        ...p.meta,
        turnId: msg.turnId,
        ...(voice && p.author === 'agent' && status === 'queued' ? { voice: 'pending' } : {}),
      };
      const inserted = await sql<{ id: string }[]>`
        insert into shopper_messages (tenant_id, thread_id, author, kind, body, meta, status, agent_step)
        values (${tenantId}, ${thread.id}, ${p.author}, ${p.kind}, ${p.body}, ${sql.json(meta as never)},
                ${status}, ${step})
        on conflict (tenant_id, agent_step) where agent_step is not null do nothing
        returning id`;
      const id = inserted[0]?.id;
      if (!id) {
        const [existing] = await sql<{ id: string }[]>`
          select id from shopper_messages where tenant_id = ${tenantId} and agent_step = ${step}`;
        ids.push(existing!.id);
        continue;
      }
      ids.push(id);
      if (status === 'queued' && !(voice && p.author === 'agent')) {
        const jid = JID.test(thread.address) ? thread.address : null;
        const phone = thread.phone && BR_PHONE.test(thread.phone) ? thread.phone : null;
        if (!jid && !phone) throw new Error('no WhatsApp address for this conversation');
        await sql`
          insert into store_wa_messages (tenant_id, kind, phone, jid, body, shopper_message_id, expires_at)
          values (${tenantId}, 'chat', ${phone}, ${jid}, ${p.body}, ${id}, now() + interval '30 minutes')
          on conflict (shopper_message_id) where shopper_message_id is not null do nothing`;
      }
      if (p.meta && (p.meta as { card?: string }).card === 'summary' && thread.summary)
        await sql`
          update shopper_threads
          set summary = summary || ${sql.json({ messageId: id, sentAt: now.toISOString() })}
          where id = ${thread.id} and summary ->> 'id' = ${String((p.meta as { data: { id: string } }).data.id)}`;
    }

    if (status !== 'skipped')
      await sql`
        update shopper_threads set
          last_out_at = now(),
          pending_since = ${status === 'draft' ? sql`pending_since` : null},
          owner = ${status === 'draft' || thread.owner === 'muted' || (thread.owner === 'human' && thread.humanUntil && thread.humanUntil > now) ? sql`owner` : 'agent'},
          human_until = ${status === 'draft' ? sql`human_until` : sql`case when owner = 'human' and human_until > now() then human_until else null end`},
          waiting_since = ${status === 'draft' ? sql`waiting_since` : sql`case when owner = 'human' and (human_until is null or human_until <= now()) then null else waiting_since end`},
          updated_at = now()
        where id = ${thread.id}`;
    await emitAdminTx(sql, tenantId, 'vendedor', thread.id);
    return { outboxId: ids[0] ?? thread.id };
  },
};
