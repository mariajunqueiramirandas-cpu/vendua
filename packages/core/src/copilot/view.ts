import type { FencedTx, OutboundMessage, Transport } from '@vendua/agent-runtime';
import { roleAtLeast, type Merchant, type Role } from '../admin/context.ts';
import { emitAdminTx } from '../admin/live.ts';
import type { Sql } from '../platform/db.ts';
import type { ActionKind, ActionStatus, ActionView, Line } from './actions.ts';

/** How long Duá may take before the admin stops showing it as writing. */
export const BUSY_MS = 2 * 60_000;
const SHOWN = 60;

export interface MessageView {
  id: string;
  author: 'merchant' | 'dua';
  text: string;
  at: string;
}

export type CopilotItem = ({ type: 'message' } & MessageView) | ({ type: 'action' } & ActionView);

/** GET /admin/v1/copilot: one person's conversation, each reply followed by its proposals. */
export interface CopilotView {
  items: CopilotItem[];
  busy: boolean;
}

interface MessageRow {
  id: string;
  author: 'merchant' | 'dua';
  body: string;
  created_at: Date;
}

interface ActionRow {
  id: string;
  message_id: string | null;
  kind: ActionKind;
  title: string;
  lines: Line[];
  money: boolean;
  status: ActionStatus;
  error: string | null;
  done: string | null;
  link: string | null;
  min_role: Role;
  created_at: Date;
  decided_at: Date | null;
  expires_at: Date;
}

export async function copilotView(tx: Sql, tenantId: string, m: Merchant): Promise<CopilotView> {
  const messages = (
    await tx<MessageRow[]>`
      select id, author, body, created_at from copilot_messages
      where tenant_id = ${tenantId} and user_id = ${m.userId}
      order by created_at desc, id desc limit ${SHOWN}`
  ).reverse();
  const since = messages[0]?.created_at ?? new Date();
  const actions = await tx<ActionRow[]>`
    select id, message_id, kind, title, lines, money, status, error, done, link, min_role,
           created_at, decided_at, expires_at
    from copilot_actions
    where tenant_id = ${tenantId} and user_id = ${m.userId} and created_at >= ${since}
    order by created_at, id`;
  const now = Date.now();
  const card = (a: ActionRow): CopilotItem => {
    // a proposal past its time reads as expired; the row changes when someone taps it
    const status = a.status === 'proposed' && a.expires_at.getTime() <= now ? 'expired' : a.status;
    return {
      type: 'action',
      id: a.id,
      kind: a.kind,
      title: a.title,
      lines: a.lines,
      money: a.money,
      status,
      error: a.error,
      done: a.done,
      link: a.link,
      canDecide: status === 'proposed' && roleAtLeast(m.role, a.min_role),
      at: a.created_at.toISOString(),
      decidedAt: a.decided_at?.toISOString() ?? null,
      expiresAt: a.expires_at.toISOString(),
    };
  };
  const byMessage = new Map<string, ActionRow[]>();
  const loose: ActionRow[] = [];
  for (const a of actions) {
    if (a.message_id) byMessage.set(a.message_id, [...(byMessage.get(a.message_id) ?? []), a]);
    else loose.push(a);
  }
  const items: CopilotItem[] = [];
  for (const msg of messages) {
    items.push({
      type: 'message',
      id: msg.id,
      author: msg.author,
      text: msg.body,
      at: msg.created_at.toISOString(),
    });
    for (const a of byMessage.get(msg.id) ?? []) items.push(card(a));
  }
  for (const a of loose) items.push(card(a));
  const last = messages.at(-1);
  return {
    items,
    busy: last?.author === 'merchant' && now - last.created_at.getTime() < BUSY_MS,
  };
}

/**
 * Duá's replies in the admin: a `copilot_messages` row written in the step's transaction, so a
 * reply exists only if its step committed; `agent_step` is unique per store, so a re-run step
 * finds its row. The turn's proposals are attached to it, and the person's screens refresh.
 */
export const copilotTransport: Transport<Sql> = {
  id: 'copilot',
  async send(tx: FencedTx<Sql>, msg: OutboundMessage) {
    const sql = tx.host;
    const step = `${msg.actorId}:${msg.turnId}:${msg.step}`;
    const userId = msg.subject.id;
    const text = msg.text.trim().slice(0, 4000);
    let id: string | null = null;
    if (text) {
      // someone removed from the team mid-turn has no conversation to write into
      const inserted = await sql<{ id: string }[]>`
        insert into copilot_messages (tenant_id, user_id, author, body, turn_id, agent_step)
        select ${msg.tenantId}, u.id, 'dua', ${text}, ${msg.turnId}, ${step}
        from merchant_users u where u.tenant_id = ${msg.tenantId} and u.id = ${userId}
        on conflict (tenant_id, agent_step) where agent_step is not null do nothing
        returning id`;
      id =
        inserted[0]?.id ??
        (
          await sql<{ id: string }[]>`
          select id from copilot_messages where tenant_id = ${msg.tenantId} and agent_step = ${step}`
        )[0]?.id ??
        null;
    }
    if (id)
      await sql`update copilot_actions set message_id = ${id}
        where tenant_id = ${msg.tenantId} and user_id = ${userId} and turn_id = ${msg.turnId}
          and message_id is null`;
    await emitAdminTx(sql, msg.tenantId, 'copilot', userId);
    return { outboxId: id ?? step };
  },
};
