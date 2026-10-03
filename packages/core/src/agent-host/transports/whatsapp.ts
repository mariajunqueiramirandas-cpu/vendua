import type { Card, FencedTx, SubjectRef, Transport } from '@vendua/agent-runtime';
import type { Sql } from '../../platform/db.ts';

export interface WhatsappTransportOpts {
  id?: string;
  /** The shopper's national number for a subject, or null when there is none to answer. */
  recipient: (tx: Sql, tenantId: string, subject: SubjectRef) => Promise<string | null>;
  /** Core renders cards (a summary, a Pix code) into the message; the model never writes them. */
  renderCard?: (card: Card) => string;
}

const PHONE = /^\d{10,11}$/;
const MAX_BODY = 2000;

/**
 * Replies become rows of the store's WhatsApp outbox (ADR 0026) in the step's transaction, so a
 * message exists only if its step committed. `agent_step` is unique per store: a re-run step
 * finds its row instead of queueing a copy. Delivery stays the gateway's at-least-once, deduped
 * by the message id it derives from the row id.
 */
export function whatsappTransport(o: WhatsappTransportOpts): Transport<Sql> {
  return {
    id: o.id ?? 'whatsapp',
    async send(tx: FencedTx<Sql>, msg) {
      const phone = await o.recipient(tx.host, msg.tenantId, msg.subject);
      if (!phone || !PHONE.test(phone)) throw new Error('no WhatsApp number for this conversation');
      const cards = msg.cards.map((c) => o.renderCard?.(c) ?? '').filter(Boolean);
      const body = [msg.text, ...cards].join('\n\n').slice(0, MAX_BODY);
      const step = `${msg.actorId}:${msg.turnId}:${msg.step}`;
      const rows = await tx.host<{ id: string }[]>`
        insert into store_wa_messages (tenant_id, kind, phone, body, agent_step, expires_at)
        values (${msg.tenantId}, 'agent', ${phone}, ${body}, ${step}, now() + interval '30 minutes')
        on conflict (tenant_id, agent_step) where agent_step is not null do nothing
        returning id`;
      if (rows[0]) return { outboxId: rows[0].id };
      const [existing] = await tx.host<{ id: string }[]>`
        select id from store_wa_messages where tenant_id = ${msg.tenantId} and agent_step = ${step}`;
      return { outboxId: existing!.id };
    },
  };
}

/** For agents that never write to anyone (online QA, consolidation-only workers). */
export const noTransport: Transport<Sql> = {
  id: 'none',
  send: async () => {
    throw new Error('this agent has no transport');
  },
};
