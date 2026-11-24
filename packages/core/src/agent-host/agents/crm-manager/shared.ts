import type { FencedTx, OutboundMessage, ToolContext, Transport } from '@vendua/agent-runtime';
import { controlTx } from '../../../modules/control.ts';
import { markdownToTelegramHtml } from '../../../modules/telegram/format.ts';
import {
  proposalButtons,
  renderProposalBlock,
  type ProposalRow,
} from '../../../modules/telegram/manager-ops.ts';
import type { Sql } from '../../../platform/db.ts';

// Shared constants and transactional Telegram outbox transport for the `crm-manager` agent
// (ADR 0047). Its actors live under Venduá's platform tenant (`subject.kind = 'telegram_staff'`,
// `subject.id = <telegramChatId>`).

export const CRM_MANAGER_AGENT_ID = 'crm-manager';
export const CRM_MANAGER_SUBJECT = 'telegram_staff';

export type ManagerCtx = ToolContext<Sql>;

/** Runs a tool query/mutation under control scope inside the actor's fenced transaction. */
export function mgr<T>(ctx: { tx: Sql }, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return controlTx(ctx.tx, fn);
}

/**
 * Writes the manager's reply (and any 1-tap confirmation cards proposed during the turn) into
 * `telegram_dm_outbox` inside the step's transaction. Postgres NOTIFY wakes the `telegram`
 * scheduler job right on commit; `agent_step` is unique so a retried step never double-sends.
 */
export const telegramManagerTransport: Transport<Sql> = {
  id: 'telegram-manager',
  async send(tx: FencedTx<Sql>, msg: OutboundMessage) {
    const chatId = msg.subject.id;
    const step = `${msg.actorId}:${msg.turnId}:${msg.step}`;
    const html = msg.text.trim() ? markdownToTelegramHtml(msg.text.trim()).slice(0, 4096) : '';

    return controlTx(tx.host, async (c) => {
      let outboxId: string | null = null;
      if (html) {
        const inserted = await c<{ id: string }[]>`
          insert into telegram_dm_outbox (chat_id, text, buttons, agent_step)
          values (${chatId}, ${html}, '[]'::jsonb, ${step})
          on conflict (agent_step) do nothing
          returning id
        `;
        outboxId =
          inserted[0]?.id ??
          (
            await c<{ id: string }[]>`
              select id from telegram_dm_outbox where agent_step = ${step}
            `
          )[0]?.id ??
          null;
      }

      const proposals = await c<ProposalRow[]>`
        select * from telegram_proposals
        where chat_id = ${chatId} and turn_id = ${msg.turnId} and status = 'proposed'
        order by created_at asc, id asc
      `;
      for (const p of proposals) {
        const pStep = `${step}:p:${p.id}`;
        const pText = renderProposalBlock(p);
        const pButtons = proposalButtons(p.id);
        const ins = await c<{ id: string }[]>`
          insert into telegram_dm_outbox (chat_id, text, buttons, agent_step)
          values (${chatId}, ${pText}, ${c.json(pButtons as never)}, ${pStep})
          on conflict (agent_step) do nothing
          returning id
        `;
        outboxId ??= ins[0]?.id ?? pStep;
      }

      return { outboxId: outboxId ?? step };
    });
  },
};
