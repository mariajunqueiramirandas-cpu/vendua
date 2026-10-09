import type { FencedTx, OutboundMessage, Transport } from '@vendua/agent-runtime';
import { roleAtLeast, type Merchant, type Role } from '../admin/context.ts';
import { emitAdminTx } from '../admin/live.ts';
import type { Sql } from '../platform/db.ts';
import { DUA, renderCards, toWhatsApp } from '../platform-whatsapp/dua-text.ts';
import type { ActionKind, ActionStatus, ActionView, Line } from './actions.ts';

/** How long Duá may take before the admin stops showing it as writing. */
export const BUSY_MS = 2 * 60_000;
const SHOWN = 60;
/** what a WhatsApp reply's cards may take of its 4000 characters */
const CARDS_ROOM = 3200;
/** the highest "SIM n" (copilot_actions.wa_ref is 1..20) */
const MAX_WA_CARDS = 20;

export interface MessageView {
  id: string;
  author: 'merchant' | 'dua';
  text: string;
  at: string;
  /** the door it came through: Duá by WhatsApp shows in the admin too */
  channel: 'admin' | 'whatsapp';
  voice: boolean;
  /** a photo the person sent, served to them alone (GET /admin/v1/copilot/media/:id) */
  image: string | null;
}

export type CopilotItem = ({ type: 'message' } & MessageView) | ({ type: 'action' } & ActionView);

/** GET /admin/v1/copilot: one person's conversation, each reply followed by its proposals. */
export interface CopilotView {
  items: CopilotItem[];
  busy: boolean;
  /** what this Core can take besides text (the routes fill it in) */
  media?: { voice: boolean; image: boolean };
}

interface MessageRow {
  id: string;
  author: 'merchant' | 'dua';
  body: string;
  channel: 'admin' | 'whatsapp';
  kind: 'text' | 'voice' | 'image';
  media_id: string | null;
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
      select c.id, c.author, c.body, c.channel, c.kind, d.id as media_id, c.created_at
      from copilot_messages c left join copilot_media d on d.message_id = c.id
      where c.tenant_id = ${tenantId} and c.user_id = ${m.userId}
      order by c.created_at desc, c.id desc limit ${SHOWN}`
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
      channel: msg.channel,
      voice: msg.kind === 'voice',
      image: msg.media_id ? `/admin/v1/copilot/media/${msg.media_id}` : null,
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

interface CardRow {
  id: string;
  wa_ref: number | null;
  title: string;
  lines: Line[];
  money: boolean;
  expires_at: Date;
}

/**
 * A reply to a turn that a WhatsApp message started goes back by WhatsApp too, with its open
 * cards as text ("Responda SIM"). The cards get their number here, once, so "SIM 2" always means
 * the card that was shown as 2. The recipient is decided by enqueue_dua_whatsapp, not by us.
 */
async function forwardToWhatsApp(sql: Sql, tenantId: string, messageId: string, text: string) {
  const cards = await sql<CardRow[]>`
    select id, wa_ref, title, lines, money, expires_at from copilot_actions
    where tenant_id = ${tenantId} and message_id = ${messageId} and status = 'proposed'
    order by created_at, id`;
  const [store] = await sql<{ tz: string | null }[]>`
    select hours ->> 'timezone' as tz from store_settings where tenant_id = ${tenantId}`;
  const host = process.env.VENDUA_ADMIN_HOST?.trim();
  const appLink = host ? `https://${host}/admin/copiloto` : null;
  const render = (cs: CardRow[]) =>
    renderCards(
      cs.map((c, i) => ({
        ref: c.wa_ref ?? i + 1,
        title: c.title,
        lines: c.lines,
        money: c.money,
      })),
      {
        expiresAt: new Date(Math.min(...cs.map((c) => c.expires_at.getTime()))),
        tz: store?.tz || 'America/Sao_Paulo',
        appLink,
      },
    );
  // as many cards as fit whole; the rest stay in the panel, with no number to answer "SIM" to
  let shown: CardRow[] = cards.slice(0, MAX_WA_CARDS);
  while (shown.length && render(shown).length > CARDS_ROOM) shown = shown.slice(0, -1);
  for (const [i, c] of shown.entries())
    if (c.wa_ref == null) {
      await sql`update copilot_actions set wa_ref = ${i + 1} where id = ${c.id} and wa_ref is null`;
      c.wa_ref = i + 1;
    }
  const rest = cards.length - shown.length;
  const rendered = [render(shown), rest ? DUA.moreInPanel(rest, appLink) : '']
    .filter(Boolean)
    .join('\n\n');
  // the cards and their "SIM" fit first: a long reply is cut, never a card someone can confirm
  const room = 4000 - (rendered ? rendered.length + 2 : 0);
  const said = toWhatsApp(text);
  const body = [said.length > room ? `${said.slice(0, Math.max(0, room - 1))}…` : said, rendered]
    .filter(Boolean)
    .join('\n\n');
  await sql`select enqueue_dua_whatsapp(${messageId}::uuid, ${body})`;
}

/**
 * Duá's replies in the admin: a `copilot_messages` row written in the step's transaction, so a
 * reply exists only if its step committed; `agent_step` is unique per store, so a re-run step
 * finds its row. The turn's proposals are attached to it, and the person's screens refresh. When
 * the turn came from a WhatsApp message, the reply also goes back there.
 */
export const copilotTransport: Transport<Sql> = {
  id: 'copilot',
  async send(tx: FencedTx<Sql>, msg: OutboundMessage) {
    const sql = tx.host;
    const step = `${msg.actorId}:${msg.turnId}:${msg.step}`;
    const userId = msg.subject.id;
    const text = msg.text.trim().slice(0, 4000);
    const [door] = await sql<{ whatsapp: boolean }[]>`
      select exists (
        select 1 from agent_mailbox
        where tenant_id = ${msg.tenantId} and consumed_by_turn::text = ${msg.turnId}
          and source like 'whatsapp:%') as whatsapp`;
    const channel = door?.whatsapp ? 'whatsapp' : 'admin';
    let id: string | null = null;
    if (text) {
      // someone removed from the team mid-turn has no conversation to write into
      const inserted = await sql<{ id: string }[]>`
        insert into copilot_messages (tenant_id, user_id, author, body, turn_id, agent_step, channel)
        select ${msg.tenantId}, u.id, 'dua', ${text}, ${msg.turnId}, ${step}, ${channel}
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
    if (id && channel === 'whatsapp') await forwardToWhatsApp(sql, msg.tenantId, id, text);
    await emitAdminTx(sql, msg.tenantId, 'copilot', userId);
    return { outboxId: id ?? step };
  },
};
