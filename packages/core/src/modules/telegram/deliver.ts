import type { Sql } from '../../platform/db.ts';
import { log } from '../../platform/log.ts';
import { controlTx } from '../control.ts';
import { getIntegrationTx } from '../integrations.ts';
import { linkedTelegramMembers } from '../staff-config.ts';
import { staffConfigTx } from '../staff.ts';
import {
  CATEGORY_META,
  STAFF_EVENT_KINDS,
  type StaffEventKind,
  type StaffLevel,
} from '../staff-events.ts';
import { ensureCommands } from './commands.ts';
import {
  crmLink,
  levelFor,
  mutedUntil,
  telegramAppOf,
  telegramContext,
  updateTelegramState,
  type TelegramContext,
} from './config.ts';
import { b, fitMessage, toReplyMarkup, type TelegramMessage } from './format.ts';
import { deliverDmOutbox, pruneManagerTablesTx } from './manager-ops.ts';
import { render, type EventRow, type RenderCtx } from './render.ts';
import { TelegramError, telegramClient, type TelegramClient, type TelegramFetch } from './rest.ts';
import { storeSnapshot, storeUrl, type StoreSnapshot } from './snapshot.ts';

// The `telegram` scheduler job (ADR 0047): claims due staff events in id order, renders them and
// sends (or edits) them in every linked team member's Telegram DM. A pass is budgeted so the job
// loop's other routines never wait on Telegram; a rate limit ends the pass with Telegram's delay.

const tlog = log.child({ mod: 'telegram' });

const BATCH = 25;
const BUDGET_MS = 8_000;
const LEASE = '2 minutes';
const MAX_ATTEMPTS = 8;
/** an event that waited this long for its first try (the bot was off) is skipped, not replayed */
const STALE_MS = 2 * 60 * 60_000;
const RETENTION_DAYS = 30;
/** more than this many of one standalone kind in a pass collapse into one summary */
const COLLAPSE_OVER = 5;
const COLLAPSE_KEEP = 3;

export interface DeliverOpts {
  fetch?: TelegramFetch;
  budgetMs?: number;
  batch?: number;
}

export interface DeliverResult {
  n: number;
  retryInMs?: number;
}

interface Claimed extends EventRow {
  attempts: number;
}

type Outcome =
  | { state: 'sent'; chatId: string; messageId: string }
  | { state: 'skipped'; reason: string }
  | { state: 'retry'; error: string }
  | { state: 'failed'; error: string };

let lastHousekeeping = 0;
let lastPrune = 0;

/** Test hook. */
export function resetDeliveryClock(): void {
  lastHousekeeping = 0;
  lastPrune = 0;
}

async function housekeeping(sql: Sql): Promise<void> {
  const now = Date.now();
  if (now - lastHousekeeping < 60_000) return;
  lastHousekeeping = now;
  await controlTx(sql, async (tx) => {
    await tx`
      update staff_events
      set state = 'skipped', lease_until = null,
          last_error = 'esperou demais para sair (o bot estava desligado?)'
      where state = 'pending' and attempts = 0
        and created_at < now() - make_interval(secs => ${STALE_MS / 1000})
    `;
    if (now - lastPrune > 60 * 60_000) {
      lastPrune = now;
      await tx`
        delete from staff_events where id in (
          select id from staff_events
          where created_at < now() - make_interval(days => ${RETENTION_DAYS})
          limit 5000
        )
      `;
      await pruneManagerTablesTx(tx);
    }
  });
}

async function claim(sql: Sql, n: number): Promise<Claimed[]> {
  const rows = await controlTx(
    sql,
    (tx) => tx<Claimed[]>`
      update staff_events set lease_until = now() + ${LEASE}::interval, attempts = attempts + 1
      where id in (
        select id from staff_events
        where state = 'pending' and next_attempt_at <= now()
          and (lease_until is null or lease_until < now())
        order by id limit ${n}
        for update skip locked
      )
      returning id, kind, tenant_id, severity, anchor, data, created_at, attempts
    `,
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) })).sort((a, b) => a.id - b.id);
}

async function settle(sql: Sql, ev: Claimed, out: Outcome): Promise<void> {
  await controlTx(sql, async (tx) => {
    if (out.state === 'sent')
      await tx`
        update staff_events set state = 'sent', delivered_at = now(), lease_until = null,
          channel_id = ${out.chatId}, message_id = ${out.messageId}, last_error = null
        where id = ${ev.id}
      `;
    else if (out.state === 'skipped')
      await tx`
        update staff_events set state = 'skipped', lease_until = null,
          last_error = ${out.reason.slice(0, 500)}
        where id = ${ev.id}
      `;
    else if (out.state === 'failed' || ev.attempts >= MAX_ATTEMPTS)
      await tx`
        update staff_events set state = 'failed', lease_until = null,
          last_error = ${('error' in out ? out.error : '').slice(0, 500)}
        where id = ${ev.id}
      `;
    else
      await tx`
        update staff_events set lease_until = null, last_error = ${out.error.slice(0, 500)},
          next_attempt_at = now() + make_interval(secs => ${Math.min(30 * 2 ** (ev.attempts - 1), 1800)})
        where id = ${ev.id}
      `;
  });
}

/** Rows claimed but not tried (a rate limit ended the pass): back in line, attempt refunded. */
async function release(sql: Sql, ids: number[], delayMs = 0): Promise<void> {
  if (!ids.length) return;
  await controlTx(
    sql,
    (tx) => tx`
      update staff_events set lease_until = null, attempts = greatest(attempts - 1, 0),
        next_attempt_at = greatest(next_attempt_at, now() + make_interval(secs => ${delayMs / 1000}))
      where id in ${tx(ids)} and state = 'pending'
    `,
  );
}

async function recordDeliveredMessage(
  sql: Sql,
  eventId: number,
  anchor: string | null,
  chatId: string,
  messageId: string,
): Promise<void> {
  await controlTx(
    sql,
    (tx) => tx`
      insert into staff_event_messages (event_id, anchor, chat_id, message_id)
      values (${eventId}, ${anchor}, ${chatId}, ${messageId})
      on conflict (event_id, chat_id) do update set message_id = excluded.message_id
    `,
  );
}

/** The anchor's events from its latest opener up to `ev`, plus each chat's card message_id. */
async function anchorHistory(
  sql: Sql,
  ev: { id: number; anchor: string | null },
): Promise<{ history: EventRow[]; targets: Map<string, string> }> {
  if (!ev.anchor) return { history: [], targets: new Map() };
  return controlTx(sql, async (tx) => {
    const rows = await tx<EventRow[]>`
      select id, kind, tenant_id, severity, anchor, data, created_at
      from staff_events where anchor = ${ev.anchor} and id <= ${ev.id}
      order by id desc limit 40
    `;
    const asc = rows.map((r) => ({ ...r, id: Number(r.id) })).reverse();
    let start = 0;
    asc.forEach((r, i) => {
      if (STAFF_EVENT_KINDS[r.kind]?.anchor?.role === 'opens') start = i;
    });
    const segment = asc.slice(start);
    const ids = segment.filter((r) => r.id !== ev.id).map((r) => r.id);
    const targets = new Map<string, string>();
    if (ids.length) {
      const sent = await tx<{ event_id: string; chat_id: string; message_id: string }[]>`
        select event_id, chat_id, message_id from staff_event_messages
        where anchor = ${ev.anchor} and event_id in ${tx(ids)}
        order by event_id asc
      `;
      for (const m of sent) targets.set(m.chat_id, m.message_id);
    }
    return { history: segment, targets };
  });
}

/** Loudness for a flat Telegram DM: silent disables buzz; urgent adds a 🔔 badge on header. */
export function loudness(
  level: StaffLevel,
  severity: string,
  muted: boolean,
): { silent: boolean; urgent: boolean } {
  if (muted || level === 'silent') return { silent: true, urgent: false };
  const urgent = level === 'ping' || (severity === 'critical' && level === 'normal');
  return { silent: false, urgent };
}

function decorate(msg: TelegramMessage, urgent: boolean): TelegramMessage {
  if (!urgent) return msg;
  return { ...msg, text: `🔔 ${msg.text}` };
}

export async function sendCard(
  client: TelegramClient,
  chatId: string,
  msg: TelegramMessage,
  opts: { silent?: boolean; replyTo?: string | null } = {},
): Promise<string> {
  const fit = fitMessage(msg);
  const replyMarkup = fit.buttons
    ? toReplyMarkup(fit.buttons)
    : fit.forceReply
      ? { force_reply: true, selective: true, input_field_placeholder: fit.forceReply }
      : undefined;
  const res = await client.call<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text: fit.text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: fit.disablePreview !== false },
    ...(opts.silent ? { disable_notification: true } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...(opts.replyTo
      ? {
          reply_parameters: {
            message_id: Number(opts.replyTo),
            allow_sending_without_reply: true,
          },
        }
      : {}),
  });
  return String(res.message_id);
}

export async function editCard(
  client: TelegramClient,
  chatId: string,
  messageId: string,
  msg: TelegramMessage,
): Promise<void> {
  const fit = fitMessage(msg);
  try {
    await client.call('editMessageText', {
      chat_id: chatId,
      message_id: Number(messageId),
      text: fit.text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: fit.disablePreview !== false },
      reply_markup: toReplyMarkup(fit.buttons),
    });
  } catch (e) {
    if (e instanceof TelegramError && e.notModified) return;
    throw e;
  }
}

interface RenderScope {
  ctx: TelegramContext;
  stores: Map<string, Promise<string | null>>;
}

interface PassCtx extends RenderScope {
  client: TelegramClient;
  recipients: { chatId: string; name: string }[];
}

function urlFor(p: RenderScope, sql: Sql, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return Promise.resolve(null);
  let hit = p.stores.get(tenantId);
  if (!hit) {
    hit = storeUrl(sql, tenantId).catch(() => null);
    p.stores.set(tenantId, hit);
  }
  return hit;
}

async function renderCtx(p: RenderScope, sql: Sql, ev: EventRow): Promise<RenderCtx> {
  const family = ev.anchor?.split(':')[0];
  let store: StoreSnapshot | null = null;
  if (family === 'onboarding' && ev.tenant_id) {
    store = await storeSnapshot(sql, ev.tenant_id).catch((e) => {
      tlog.warn({ err: e, tenant: ev.tenant_id }, 'onboarding snapshot failed');
      return null;
    });
  }
  return {
    crm: (path) => crmLink(p.ctx.crmBase, path),
    excerpts: p.ctx.setting.excerpts,
    storeUrl: await urlFor(p, sql, ev.tenant_id),
    store,
    now: new Date(),
  };
}

async function deliverOne(sql: Sql, p: PassCtx, ev: Claimed): Promise<Outcome> {
  const meta = STAFF_EVENT_KINDS[ev.kind as StaffEventKind];
  if (!meta) return { state: 'skipped', reason: `tipo desconhecido: ${ev.kind}` };
  const { setting, state } = p.ctx;
  const level = levelFor(setting, ev.kind);
  const muted = !!mutedUntil(state, meta.category);
  const stale = Date.now() - new Date(ev.created_at).getTime() > STALE_MS && ev.attempts <= 1;
  const role = meta.anchor?.role;

  if (!p.recipients.length)
    return { state: 'skipped', reason: 'nenhuma pessoa da equipe conectou o Telegram' };

  const loud = loudness(level, ev.severity, muted);

  if (role !== 'follows') {
    if (level === 'off') return { state: 'skipped', reason: 'desligado nas configurações' };
    if (stale) return { state: 'skipped', reason: 'esperou demais para sair' };
    const rctx = await renderCtx(p, sql, ev);
    const { card } = render(ev, [ev], rctx);
    const msg = decorate(card, loud.urgent);
    let firstSent: { chatId: string; messageId: string } | null = null;
    let lastBlocked: TelegramError | null = null;
    for (const r of p.recipients) {
      try {
        const messageId = await sendCard(p.client, r.chatId, msg, { silent: loud.silent });
        await recordDeliveredMessage(sql, ev.id, ev.anchor, r.chatId, messageId);
        firstSent ??= { chatId: r.chatId, messageId };
      } catch (e) {
        if (e instanceof TelegramError && e.blocked) {
          lastBlocked = e;
          tlog.warn({ chatId: r.chatId, err: e.description }, 'telegram recipient blocked bot');
          continue;
        }
        throw e;
      }
    }
    if (!firstSent) throw lastBlocked ?? new Error('nenhum destinatário aceitou a mensagem');
    return { state: 'sent', ...firstSent };
  }

  // follow-up: edit each linked teammate's card in place, and reply when worth notifying
  const { history, targets } = await anchorHistory(sql, ev);
  if (targets.size === 0) {
    if (level === 'off') return { state: 'skipped', reason: 'sem cartão para atualizar' };
    if (stale) return { state: 'skipped', reason: 'esperou demais para sair' };
  }
  const { card, reply } = render(ev, history, await renderCtx(p, sql, ev));
  let firstSent: { chatId: string; messageId: string } | null = null;
  let lastBlocked: TelegramError | null = null;

  for (const r of p.recipients) {
    const existing = targets.get(r.chatId);
    try {
      let msgId = existing;
      if (msgId) {
        try {
          await editCard(p.client, r.chatId, msgId, card);
        } catch (e) {
          if (e instanceof TelegramError && e.messageGone) {
            msgId = await sendCard(p.client, r.chatId, decorate(card, loud.urgent), {
              silent: level === 'off' ? true : loud.silent,
            });
          } else {
            throw e;
          }
        }
      } else {
        if (level === 'off') continue;
        msgId = await sendCard(p.client, r.chatId, decorate(card, loud.urgent), {
          silent: loud.silent,
        });
      }
      await recordDeliveredMessage(sql, ev.id, ev.anchor, r.chatId, msgId);
      firstSent ??= { chatId: r.chatId, messageId: msgId };
      if (reply && level !== 'off') {
        await sendCard(
          p.client,
          r.chatId,
          { text: loud.urgent ? `🔔 ${reply}` : reply },
          { silent: loud.silent, replyTo: msgId },
        );
      }
    } catch (e) {
      if (e instanceof TelegramError && e.blocked) {
        lastBlocked = e;
        tlog.warn({ chatId: r.chatId, err: e.description }, 'telegram recipient blocked bot');
        continue;
      }
      throw e;
    }
  }
  if (!firstSent) {
    if (lastBlocked) throw lastBlocked;
    return { state: 'skipped', reason: 'sem cartão para atualizar' };
  }
  return { state: 'sent', ...firstSent };
}

/** A storm of one kind (a CSV import, a fleet-wide release) becomes one summary message. */
function collapse(
  batch: Claimed[],
  ctx: TelegramContext,
): { keep: Claimed[]; groups: Claimed[][] } {
  const byKind = new Map<string, Claimed[]>();
  for (const ev of batch) {
    if (ev.anchor) continue;
    const list = byKind.get(ev.kind) ?? [];
    list.push(ev);
    byKind.set(ev.kind, list);
  }
  const folded = new Set<number>();
  const groups: Claimed[][] = [];
  for (const [kind, list] of byKind) {
    if (list.length <= COLLAPSE_OVER) continue;
    if (levelFor(ctx.setting, kind as StaffEventKind) === 'off') continue;
    const rest = list.slice(COLLAPSE_KEEP);
    rest.forEach((e) => folded.add(e.id));
    groups.push(rest);
  }
  return { keep: batch.filter((e) => !folded.has(e.id)), groups };
}

async function deliverGroup(sql: Sql, p: PassCtx, group: Claimed[]): Promise<Outcome> {
  if (!p.recipients.length)
    return { state: 'skipped', reason: 'nenhuma pessoa da equipe conectou o Telegram' };
  const ev = group[0]!;
  const meta = STAFF_EVENT_KINDS[ev.kind];
  const lines: string[] = [];
  for (const e of group.slice(0, 12)) {
    const { summary } = render(e, [e], await renderCtx(p, sql, e));
    lines.push(`• ${summary}`);
  }
  if (group.length > 12) lines.push(`• … e mais ${group.length - 12}`);
  const msg: TelegramMessage = {
    text: [
      `${CATEGORY_META[meta.category].emoji} ${b(`+${group.length} × ${meta.label}`)}`,
      ...lines,
    ].join('\n'),
  };
  let firstSent: { chatId: string; messageId: string } | null = null;
  let lastBlocked: TelegramError | null = null;
  for (const r of p.recipients) {
    try {
      const messageId = await sendCard(p.client, r.chatId, msg, { silent: true });
      firstSent ??= { chatId: r.chatId, messageId };
    } catch (e) {
      if (e instanceof TelegramError && e.blocked) {
        lastBlocked = e;
        continue;
      }
      throw e;
    }
  }
  if (!firstSent) throw lastBlocked ?? new Error('nenhum destinatário aceitou a mensagem');
  return { state: 'sent', ...firstSent };
}

function describe(e: unknown): string {
  if (e instanceof TelegramError) {
    if (e.unauthorized) return 'token do bot recusado (401) — confira TELEGRAM_BOT_TOKEN';
    if (e.blocked)
      return 'o bot não pode enviar mensagem — abra a conversa com o bot e toque em Começar';
    return `telegram ${e.errorCode ?? e.status}: ${e.description}`;
  }
  return e instanceof Error ? e.message : String(e);
}

async function noteError(sql: Sql, message: string): Promise<void> {
  await updateTelegramState(sql, () => ({
    lastError: { at: new Date().toISOString(), message: message.slice(0, 300) },
  })).catch(() => {});
}

export async function deliverStaffEvents(sql: Sql, opts: DeliverOpts = {}): Promise<DeliverResult> {
  const started = Date.now();
  await housekeeping(sql);
  const ctx = await telegramContext(sql);
  if (!ctx.app.ok) return { n: 0 };
  const client = telegramClient(ctx.app.app.token, opts.fetch);
  await ensureCommands(sql, ctx, client);
  // Interactive manager chat replies go out ahead of bulk staff event notifications
  const dm = await deliverDmOutbox(sql, { ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  if (dm.retryInMs) return { n: dm.n, retryInMs: dm.retryInMs };
  const staff = await controlTx(sql, staffConfigTx);
  const recipients = linkedTelegramMembers(staff);
  const p: PassCtx = { ctx, client, stores: new Map(), recipients };
  const budget = opts.budgetMs ?? BUDGET_MS;
  const size = opts.batch ?? BATCH;
  let n = dm.n;
  while (Date.now() - started < budget) {
    const batch = await claim(sql, size);
    if (!batch.length) break;
    const { keep, groups } = collapse(batch, ctx);
    const queue: (Claimed | Claimed[])[] = [...keep, ...groups];
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]!;
      const evs = Array.isArray(item) ? item : [item];
      let out: Outcome;
      try {
        out = Array.isArray(item)
          ? await deliverGroup(sql, p, item)
          : await deliverOne(sql, p, item);
      } catch (e) {
        if (e instanceof TelegramError && (e.rateLimited || e.unauthorized)) {
          const wait = e.rateLimited ? (e.retryAfterMs ?? 5_000) : 10 * 60_000;
          const left = queue.slice(i).flatMap((x) => (Array.isArray(x) ? x : [x]));
          await release(
            sql,
            left.map((x) => x.id),
            wait,
          );
          if (e.unauthorized)
            await noteError(sql, 'token do bot recusado (401) — confira TELEGRAM_BOT_TOKEN');
          return { n, retryInMs: wait };
        }
        const transient = !(e instanceof TelegramError) || e.transient;
        const message = describe(e);
        if (!transient) await noteError(sql, message);
        else tlog.warn({ err: e, kind: evs[0]!.kind }, 'telegram delivery failed — will retry');
        out = transient ? { state: 'retry', error: message } : { state: 'failed', error: message };
      }
      for (const ev of evs) await settle(sql, ev, out);
      if (out.state === 'sent') n += evs.length;
    }
    if (batch.length < size) break;
  }
  return { n };
}

/** When the job next has work by the clock (a retry, an expired lease); new rows notify. */
export async function telegramNextAtTx(tx: Sql): Promise<Date | null> {
  if (!telegramAppOf(await getIntegrationTx(tx, 'telegram')).ok) return null;
  const [row] = await tx<{ at: Date | null }[]>`
    with due as (
      select greatest(next_attempt_at, coalesce(lease_until, next_attempt_at)) as at
      from staff_events where state = 'pending'
      union all
      select greatest(next_attempt_at, coalesce(lease_until, next_attempt_at)) as at
      from telegram_dm_outbox where state = 'pending'
    )
    select case when count(*) = 0 then null
                else greatest(min(at), now() + interval '1 second') end as at
    from due
  `;
  return row?.at ? new Date(row.at) : null;
}

export async function telegramEnabledTx(tx: Sql): Promise<boolean> {
  return telegramAppOf(await getIntegrationTx(tx, 'telegram')).ok;
}

/** The card an anchor shows right now — button clicks re-render and sync it across DMs. */
export async function renderAnchor(
  sql: Sql,
  ctx: TelegramContext,
  anchor: string,
): Promise<{ card: TelegramMessage; targets: Map<string, string> } | null> {
  const { history, targets } = await anchorHistory(sql, { id: Number.MAX_SAFE_INTEGER, anchor });
  const ev = history.at(-1);
  if (!ev) return null;
  const { card } = render(ev, history, await renderCtx({ ctx, stores: new Map() }, sql, ev));
  return { card: fitMessage(card), targets };
}

/** Edits every linked teammate's copy of an anchored card so nobody sees stale buttons. */
export async function syncAnchorCards(
  sql: Sql,
  ctx: TelegramContext,
  client: TelegramClient,
  anchor: string,
  clicked?: { chatId: string; messageId: string },
): Promise<void> {
  const res = await renderAnchor(sql, ctx, anchor);
  if (!res) return;
  const targets = new Map(res.targets);
  if (clicked) targets.set(clicked.chatId, clicked.messageId);
  await Promise.all(
    [...targets.entries()].map(([chatId, messageId]) =>
      editCard(client, chatId, messageId, res.card).catch((e) => {
        if (e instanceof TelegramError && (e.blocked || e.messageGone || e.notModified)) return;
        tlog.warn({ err: e, chatId, anchor }, 'telegram card sync failed');
      }),
    ),
  );
}
