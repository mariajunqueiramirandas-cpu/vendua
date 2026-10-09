import type { Sql } from '../../platform/db.ts';
import { log } from '../../platform/log.ts';
import { controlTx } from '../control.ts';
import { getIntegrationTx } from '../integrations.ts';
import {
  CATEGORY_META,
  STAFF_CATEGORIES,
  STAFF_EVENT_KINDS,
  type StaffEventKind,
  type StaffLevel,
} from '../staff-events.ts';
import { ensureCommands } from './commands.ts';
import {
  channelFor,
  artLink,
  crmLink,
  discordAppOf,
  discordContext,
  levelFor,
  mutedUntil,
  updateDiscordState,
  type DiscordContext,
} from './config.ts';
import { FLAG_SILENT, fitMessage, type MessagePayload } from './format.ts';
import { render, type EventRow, type RenderCtx } from './render.ts';
import { DiscordError, discordClient, type DiscordClient, type DiscordFetch } from './rest.ts';
import { storeSnapshot, storeUrl, type StoreSnapshot } from './snapshot.ts';

// The `discord` scheduler job (ADR 0023): claims due staff events in id order, renders them and
// posts (or edits) Discord messages. A pass is budgeted so the job loop's other routines never
// wait on Discord; a rate limit ends the pass with the delay Discord asked for.

const dlog = log.child({ mod: 'discord' });

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
  fetch?: DiscordFetch;
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
  | { state: 'sent'; channelId: string; messageId: string }
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
          channel_id = ${out.channelId}, message_id = ${out.messageId}, last_error = null
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

/** The anchor's events from its latest opener up to `ev`, plus the card to edit (if any). */
async function anchorHistory(
  sql: Sql,
  ev: { id: number; anchor: string | null },
): Promise<{ history: EventRow[]; target: { channelId: string; messageId: string } | null }> {
  if (!ev.anchor) return { history: [], target: null };
  const rows = await controlTx(
    sql,
    (tx) => tx<(EventRow & { channel_id: string | null; message_id: string | null })[]>`
      select id, kind, tenant_id, severity, anchor, data, created_at, channel_id, message_id
      from staff_events where anchor = ${ev.anchor} and id <= ${ev.id}
      order by id desc limit 40
    `,
  );
  const asc = rows.map((r) => ({ ...r, id: Number(r.id) })).reverse();
  let start = 0;
  asc.forEach((r, i) => {
    if (STAFF_EVENT_KINDS[r.kind]?.anchor?.role === 'opens') start = i;
  });
  const segment = asc.slice(start);
  const withCard = segment.filter((r) => r.id !== ev.id && r.channel_id && r.message_id).at(-1);
  return {
    history: segment,
    target: withCard ? { channelId: withCard.channel_id!, messageId: withCard.message_id! } : null,
  };
}

/** Who gets notified: silent, a role mention for ping/critical, or a plain message. */
export function loudness(
  level: StaffLevel,
  severity: string,
  muted: boolean,
  roleId: string | null,
): Pick<MessagePayload, 'content' | 'flags' | 'allowed_mentions'> {
  if (muted || level === 'silent') return { flags: FLAG_SILENT, allowed_mentions: { parse: [] } };
  const ping = level === 'ping' || (severity === 'critical' && level === 'normal');
  if (ping && roleId)
    return { content: `<@&${roleId}>`, allowed_mentions: { parse: [], roles: [roleId] } };
  return { allowed_mentions: { parse: [] } };
}

interface RenderScope {
  ctx: DiscordContext;
  stores: Map<string, Promise<string | null>>;
}

interface PassCtx extends RenderScope {
  client: DiscordClient;
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

function routedHere(ctx: DiscordContext, channelId: string): string[] {
  return STAFF_CATEGORIES.filter((c) => channelFor(ctx.setting, c) === channelId).map(
    (c) => `${CATEGORY_META[c].emoji} ${c}`,
  );
}

async function renderCtx(
  p: RenderScope,
  sql: Sql,
  ev: EventRow,
  channelId: string | null,
): Promise<RenderCtx> {
  const family = ev.anchor?.split(':')[0];
  let store: StoreSnapshot | null = null;
  if (family === 'onboarding' && ev.tenant_id) {
    store = await storeSnapshot(sql, ev.tenant_id).catch((e) => {
      dlog.warn({ err: e, tenant: ev.tenant_id }, 'onboarding snapshot failed');
      return null;
    });
  }
  return {
    crm: (path) => crmLink(p.ctx.crmBase, path),
    art: (pose) => artLink(p.ctx.crmBase, pose),
    excerpts: p.ctx.setting.excerpts,
    storeUrl: await urlFor(p, sql, ev.tenant_id),
    store,
    routedHere: channelId ? routedHere(p.ctx, channelId) : [],
    now: new Date(),
  };
}

const post = (client: DiscordClient, channelId: string, body: MessagePayload) =>
  client.request<{ id: string }>('POST', `/channels/${channelId}/messages`, fitMessage(body));

async function deliverOne(sql: Sql, p: PassCtx, ev: Claimed): Promise<Outcome> {
  const meta = STAFF_EVENT_KINDS[ev.kind as StaffEventKind];
  if (!meta) return { state: 'skipped', reason: `tipo desconhecido: ${ev.kind}` };
  const { setting, state } = p.ctx;
  const level = levelFor(setting, ev.kind);
  const muted = !!mutedUntil(state, meta.category);
  const stale = Date.now() - new Date(ev.created_at).getTime() > STALE_MS && ev.attempts <= 1;
  const role = meta.anchor?.role;

  if (role !== 'follows') {
    if (level === 'off') return { state: 'skipped', reason: 'desligado nas configurações' };
    if (stale) return { state: 'skipped', reason: 'esperou demais para sair' };
    const channelId = channelFor(setting, meta.category);
    if (!channelId) return { state: 'skipped', reason: `nenhum canal para ${meta.category}` };
    const rctx = await renderCtx(p, sql, ev, channelId);
    const { card } = render(ev, [ev], rctx);
    const msg = await post(p.client, channelId, {
      ...card,
      ...loudness(level, ev.severity, muted, setting.staffRoleId),
      nonce: `se${ev.id}`,
      enforce_nonce: true,
    });
    return { state: 'sent', channelId, messageId: msg.id };
  }

  // a follow-up: edit the card, and reply when the change deserves a notification
  const { history, target } = await anchorHistory(sql, ev);
  if (!target) {
    if (level === 'off') return { state: 'skipped', reason: 'sem cartão para atualizar' };
    if (stale) return { state: 'skipped', reason: 'esperou demais para sair' };
    const channelId = channelFor(setting, meta.category);
    if (!channelId) return { state: 'skipped', reason: `nenhum canal para ${meta.category}` };
    const { card } = render(ev, history, await renderCtx(p, sql, ev, channelId));
    const msg = await post(p.client, channelId, {
      ...card,
      ...loudness(level, ev.severity, muted, setting.staffRoleId),
      nonce: `se${ev.id}`,
      enforce_nonce: true,
    });
    return { state: 'sent', channelId, messageId: msg.id };
  }
  const { card, reply } = render(ev, history, await renderCtx(p, sql, ev, target.channelId));
  try {
    await p.client.request(
      'PATCH',
      `/channels/${target.channelId}/messages/${target.messageId}`,
      fitMessage({
        embeds: card.embeds ?? [],
        components: card.components ?? [],
        allowed_mentions: { parse: [] },
      }),
    );
  } catch (e) {
    // the card was deleted by someone: post the current state as a fresh card
    if (e instanceof DiscordError && e.code === 10008) {
      const msg = await post(p.client, target.channelId, {
        ...card,
        ...loudness(level === 'off' ? 'silent' : level, ev.severity, muted, setting.staffRoleId),
        nonce: `se${ev.id}`,
        enforce_nonce: true,
      });
      return { state: 'sent', channelId: target.channelId, messageId: msg.id };
    }
    throw e;
  }
  if (reply && level !== 'off') {
    const loud = loudness(level, ev.severity, muted, setting.staffRoleId);
    await post(p.client, target.channelId, {
      ...loud,
      content: loud.content ? `${loud.content} ${reply}` : reply,
      message_reference: {
        message_id: target.messageId,
        channel_id: target.channelId,
        fail_if_not_exists: false,
      },
      nonce: `sr${ev.id}`,
      enforce_nonce: true,
    });
  }
  return { state: 'sent', channelId: target.channelId, messageId: target.messageId };
}

/** A storm of one kind (a CSV import, a fleet-wide release) becomes one summary message. */
function collapse(batch: Claimed[], ctx: DiscordContext): { keep: Claimed[]; groups: Claimed[][] } {
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
  const ev = group[0]!;
  const meta = STAFF_EVENT_KINDS[ev.kind];
  const channelId = channelFor(p.ctx.setting, meta.category);
  if (!channelId) return { state: 'skipped', reason: `nenhum canal para ${meta.category}` };
  const lines: string[] = [];
  for (const e of group.slice(0, 12)) {
    const { card } = render(e, [e], await renderCtx(p, sql, e, channelId));
    lines.push(`• ${card.embeds?.[0]?.title ?? meta.label}`);
  }
  if (group.length > 12) lines.push(`• … e mais ${group.length - 12}`);
  const msg = await post(p.client, channelId, {
    embeds: [
      {
        author: {
          name: `${CATEGORY_META[meta.category].emoji} ${CATEGORY_META[meta.category].label}`,
        },
        title: `+${group.length} × ${meta.label}`,
        description: lines.join('\n'),
        color: 0x64748b,
      },
    ],
    flags: FLAG_SILENT,
    allowed_mentions: { parse: [] },
    nonce: `sg${ev.id}`,
    enforce_nonce: true,
  });
  return { state: 'sent', channelId, messageId: msg.id };
}

function describe(e: unknown): string {
  if (e instanceof DiscordError) {
    if (e.code === 10003) return 'o canal não existe mais — escolha outro em Config → Discord';
    if (e.code === 50001 || e.code === 50013)
      return 'o bot não tem permissão neste canal (ver canal, enviar mensagens, links)';
    return `discord ${e.status}${e.code ? `/${e.code}` : ''}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

async function noteError(sql: Sql, message: string): Promise<void> {
  await updateDiscordState(sql, () => ({
    lastError: { at: new Date().toISOString(), message: message.slice(0, 300) },
  })).catch(() => {});
}

export async function deliverStaffEvents(sql: Sql, opts: DeliverOpts = {}): Promise<DeliverResult> {
  const started = Date.now();
  await housekeeping(sql);
  const ctx = await discordContext(sql);
  if (!ctx.app.ok) return { n: 0 };
  const client = discordClient(ctx.app.app.token, opts.fetch);
  await ensureCommands(sql, ctx, client);
  const p: PassCtx = { ctx, client, stores: new Map() };
  const budget = opts.budgetMs ?? BUDGET_MS;
  const size = opts.batch ?? BATCH;
  let n = 0;
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
        if (e instanceof DiscordError && (e.rateLimited || e.status === 401)) {
          const wait = e.rateLimited ? (e.retryAfterMs ?? 5_000) : 10 * 60_000;
          const left = queue.slice(i).flatMap((x) => (Array.isArray(x) ? x : [x]));
          await release(
            sql,
            left.map((x) => x.id),
            wait,
          );
          if (e.status === 401)
            await noteError(sql, 'token do bot recusado (401) — confira DISCORD_BOT_TOKEN');
          return { n, retryInMs: wait };
        }
        const transient = !(e instanceof DiscordError) || e.transient;
        const message = describe(e);
        if (!transient) await noteError(sql, message);
        else dlog.warn({ err: e, kind: evs[0]!.kind }, 'discord delivery failed — will retry');
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
export async function discordNextAtTx(tx: Sql): Promise<Date | null> {
  if (!discordAppOf(await getIntegrationTx(tx, 'discord')).ok) return null;
  // greatest() skips nulls: without the case an empty queue would read as "due in 1 s"
  const [row] = await tx<{ at: Date | null }[]>`
    select case when count(*) = 0 then null
                else greatest(min(greatest(next_attempt_at, coalesce(lease_until, next_attempt_at))),
                              now() + interval '1 second') end as at
    from staff_events where state = 'pending'
  `;
  return row?.at ? new Date(row.at) : null;
}

export async function discordEnabledTx(tx: Sql): Promise<boolean> {
  return discordAppOf(await getIntegrationTx(tx, 'discord')).ok;
}

/** The card an anchor shows right now — an interaction answers with it after acting. */
export async function renderAnchor(
  sql: Sql,
  ctx: DiscordContext,
  anchor: string,
): Promise<MessagePayload | null> {
  const { history } = await anchorHistory(sql, { id: Number.MAX_SAFE_INTEGER, anchor });
  const ev = history.at(-1);
  if (!ev) return null;
  const { card } = render(ev, history, await renderCtx({ ctx, stores: new Map() }, sql, ev, null));
  return fitMessage({ embeds: card.embeds ?? [], components: card.components ?? [] });
}
