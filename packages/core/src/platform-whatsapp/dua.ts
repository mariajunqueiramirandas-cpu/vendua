import type { ModelGateway } from '@vendua/agent-runtime';
import type { Merchant, Role } from '../admin/context.ts';
import { emitAdminTx } from '../admin/live.ts';
import { decideTx } from '../copilot/actions.ts';
import {
  copilotInboundTx,
  hearVoice,
  seePhoto,
  takeMediaCallTx,
  type Heard,
} from '../copilot/media.ts';
import { planHas } from '../modules/billing/plans.ts';
import { controlTx } from '../modules/control.ts';
import { normalizePhone } from '../modules/customer.ts';
import { inControlScope, withTenant, type Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { phoneVariants } from '../store-whatsapp/text.ts';

import type { MediaProviders } from '../vendedor/media.ts';
import { AUDIO_NOT_FETCHED, DUA, parseChoice, parseReply } from './dua-text.ts';
import { enqueuePlatformWaTx } from './outbox.ts';
import { platformTransport } from './transport.ts';

// Duá by WhatsApp (docs/features/dua-no-whatsapp.md §5, ADR 0034 amended 2026-10-07): a message
// from a merchant phone to Venduá's number reaches that person's Copilot conversation. Who is
// asking is proven the way the WhatsApp sign-in proves it (the number), plus the person's own
// switch in Perfil. A "SIM" is matched here, before the model, and applied through the same
// decideTx as the admin's tap; the model never applies anything.

const duaLog = log.child({ mod: 'dua-whatsapp' });

export interface InboxRow {
  id: string;
  session: string;
  kind: 'message' | 'history' | 'lid_mapping';
  from_jid: string | null;
  alt_jid: string | null;
  phone: string | null;
  push_name: string | null;
  body: string | null;
  media_id: string | null;
  provider_id: string | null;
  from_me: boolean;
  sent_at: Date | null;
  pairs: { lid: string; pn: string }[] | null;
  attempts: number;
}

export interface DuaDeps {
  /** the request pool's role (vendua_app): every read here runs under RLS */
  sql: Sql;
  media?: Pick<MediaProviders, 'transcribe'> | null;
  /** reads the photos people send (copilot/media.ts); none means text and voice only */
  gateway?: ModelGateway | null;
  /** the admin's origin (https://<VENDUA_ADMIN_HOST>), for links in fixed answers */
  origin?: string | null;
}

/** What the consumer does with the row next. */
export type DuaOutcome = { route: 'crm' } | { route: 'done' } | { route: 'defer'; until: Date };

export class AlreadyConsumed extends Error {}

const MAX_BODY = 2000;
const WINDOW_MS = 10 * 60_000;
const PER_WINDOW = 30;
const TZ = 'America/Sao_Paulo';

interface Membership {
  tenant_id: string;
  name: string;
  user_id: string;
  role: Role;
  /** merchant_users.phone as stored (the variant that matched) */
  phone: string;
}

interface Eligible extends Membership {
  first: string;
}

interface Sender {
  phone: string;
  tenant_id: string | null;
  user_id: string | null;
  choices: { tenantId: string; userId: string; name: string }[] | null;
  window_start: Date;
  window_count: number;
  calm_sent: boolean;
}

/** National digits of a Brazilian number from the gateway's international ones. */
function nationalOf(phone: string | null): string | null {
  if (!phone || !phone.startsWith('55')) return null;
  const n = normalizePhone(phone);
  return /^\d{10,11}$/.test(n) ? n : null;
}

/** The stores this number signs in to, trying the 9th-digit forms (the one cross-tenant read).
 *  Only memberships whose person proved the phone (a WhatsApp code sign-in): an owner typing
 *  someone's number into Equipe must not make that person's messages the store's. */
export async function membershipsOf(sql: Sql, phone: string | null): Promise<Membership[]> {
  const national = nationalOf(phone);
  if (!national) return [];
  const out: Membership[] = [];
  for (const v of phoneVariants(national)) {
    const rows = await sql<Omit<Membership, 'phone'>[]>`
      select tenant_id, name, user_id, role from merchant_memberships_for_proven_phone(${v})`;
    for (const r of rows)
      if (!out.some((m) => m.user_id === r.user_id)) out.push({ ...r, phone: v });
  }
  return out;
}

/** Whom to answer: the jid they wrote from when it is a number, else their digits. */
const replyTo = (row: InboxRow) =>
  row.from_jid?.endsWith('@s.whatsapp.net') ? row.from_jid : (row.phone ?? row.from_jid ?? '');

async function markDoneTx(tx: Sql, id: string) {
  const r = await tx`
    update platform_wa_inbox set status = 'done', consumed_at = now(), error = null
    where id = ${id} and status = 'pending' returning id`;
  if (!r.length) throw new AlreadyConsumed(id);
}

/** A fixed answer from Core, and the row consumed, in one control transaction. */
async function answer(d: DuaDeps, row: InboxRow, key: string, text: string): Promise<DuaOutcome> {
  await controlTx(d.sql, async (tx) => {
    await enqueuePlatformWaTx(tx, {
      to: replyTo(row),
      body: text,
      purpose: 'dua',
      dedupeKey: `dua-in:${row.id}:${key}`,
    });
    await markDoneTx(tx, row.id);
  });
  return { route: 'done' };
}

const appLink = (d: DuaDeps, path: string) => (d.origin ? `${d.origin}/admin${path}` : null);

async function senderTx(tx: Sql, phone: string, jid: string): Promise<Sender> {
  const [s] = await tx<Sender[]>`
    insert into platform_wa_dua_senders as s (phone, jid, window_start, window_count)
    values (${phone}, ${jid}, now(), 1)
    on conflict (phone) do update set
      jid = excluded.jid,
      window_start = case when s.window_start is null
        or s.window_start < now() - ${WINDOW_MS} * interval '1 millisecond'
        then now() else s.window_start end,
      window_count = case when s.window_start is null
        or s.window_start < now() - ${WINDOW_MS} * interval '1 millisecond'
        then 1 else s.window_count + 1 end,
      calm_sent = case when s.window_start is null
        or s.window_start < now() - ${WINDOW_MS} * interval '1 millisecond'
        then false else s.calm_sent end,
      updated_at = now()
    returning phone, tenant_id, user_id, choices, window_start, window_count, calm_sent`;
  return s!;
}

async function eligibility(
  d: DuaDeps,
  m: Membership,
): Promise<{ eligible: boolean; switchOff: boolean; first: string }> {
  return withTenant(d.sql, m.tenant_id, async (tx) => {
    const [u] = await tx<{ on: boolean; role: Role; managers: boolean; name: string }[]>`
      select coalesce((u.prefs ->> 'duaWhatsapp')::boolean, false) as on, u.role, u.name,
             coalesce(s.dua_whatsapp_managers, true) as managers
      from merchant_users u left join store_settings s on s.tenant_id = u.tenant_id
      where u.tenant_id = ${m.tenant_id} and u.id = ${m.user_id} and u.status = 'active'`;
    if (!u) return { eligible: false, switchOff: false, first: '' };
    const first = u.name.split(' ')[0] ?? u.name;
    // the same floor as POST /admin/v1/copilot/messages
    const roleOk = u.role === 'owner' || (u.role === 'manager' && u.managers);
    if (!roleOk || !(await planHas(tx, m.tenant_id, 'copilot')))
      return { eligible: false, switchOff: false, first };
    return { eligible: u.on, switchOff: !u.on, first };
  });
}

/**
 * Routes one inbox message from a sender's number. Not a merchant → the CRM's path, as before.
 * A merchant who can't use Duá here gets one fixed answer a day instead of the old silent drop.
 */
export async function routeToDua(d: DuaDeps, row: InboxRow): Promise<DuaOutcome> {
  const memberships = await membershipsOf(d.sql, row.phone);
  if (!memberships.length) return { route: 'crm' };
  const jid = replyTo(row);
  const phone = memberships[0]!.phone;

  const sender = await controlTx(d.sql, (tx) => senderTx(tx, phone, jid));
  if (sender.window_count > PER_WINDOW) {
    const until = new Date(sender.window_start.getTime() + WINDOW_MS);
    if (!sender.calm_sent)
      await controlTx(d.sql, async (tx) => {
        await tx`update platform_wa_dua_senders set calm_sent = true where phone = ${phone}`;
        await enqueuePlatformWaTx(tx, {
          to: jid,
          body: DUA.calm,
          purpose: 'dua',
          dedupeKey: `dua-calm:${phone}:${sender.window_start.toISOString()}`,
        });
      });
    return { route: 'defer', until };
  }

  const checked = await Promise.all(
    memberships.map(async (m) => ({ m, e: await eligibility(d, m) })),
  );
  const eligible: Eligible[] = checked
    .filter((c) => c.e.eligible)
    .map((c) => ({ ...c.m, first: c.e.first }));
  if (!eligible.length) {
    const off = checked.find((c) => c.e.switchOff);
    // the day's marker, the answer and the consumed row commit together: a crash in between
    // retries the whole answer instead of finding the marker set and staying silent
    await controlTx(d.sql, async (tx) => {
      const first = await tx`
        update platform_wa_dua_senders
        set refused_on = (now() at time zone ${TZ})::date, updated_at = now()
        where phone = ${phone} and refused_on is distinct from (now() at time zone ${TZ})::date
        returning phone`;
      if (first.length)
        await enqueuePlatformWaTx(tx, {
          to: jid,
          body: off
            ? DUA.turnOn(off.e.first, appLink(d, '/perfil'))
            : DUA.notForYou(appLink(d, '/')),
          purpose: 'dua',
          dedupeKey: `dua-in:${row.id}:refused`,
        });
      await markDoneTx(tx, row.id);
    });
    return { route: 'done' };
  }

  const body = (row.body ?? '').trim();
  const reply = row.media_id ? null : parseReply(body);
  const target = await chooseStore(d, row, sender, eligible, body, reply);
  if ('route' in target) return target;

  if (reply && 'decision' in reply) {
    const decided = await decideByReply(d, row, target, reply);
    if (decided) return decided;
  }

  const heard = await hear(d, row, target, body);
  if ('route' in heard) return heard;
  return dispatchTurn(d, row, target, heard);
}

/** One eligible store is that store; several are a numbered choice that sticks until #loja. */
async function chooseStore(
  d: DuaDeps,
  row: InboxRow,
  sender: Sender,
  eligible: Eligible[],
  body: string,
  reply: ReturnType<typeof parseReply>,
): Promise<Eligible | DuaOutcome> {
  const remember = (tx: Sql, e: Eligible) => tx`
    update platform_wa_dua_senders
    set tenant_id = ${e.tenant_id}, user_id = ${e.user_id}, chosen_at = now(), choices = null,
        updated_at = now()
    where phone = ${sender.phone}`;
  const askStore = async () => {
    const choices = eligible.map((e) => ({
      tenantId: e.tenant_id,
      userId: e.user_id,
      name: e.name,
    }));
    await controlTx(d.sql, async (tx) => {
      await tx`
        update platform_wa_dua_senders
        set tenant_id = null, user_id = null, chosen_at = null, choices = ${tx.json(choices)},
            updated_at = now()
        where phone = ${sender.phone}`;
      await enqueuePlatformWaTx(tx, {
        to: replyTo(row),
        body: DUA.chooseStore(choices.map((c) => c.name)),
        purpose: 'dua',
        dedupeKey: `dua-in:${row.id}:stores`,
      });
      await markDoneTx(tx, row.id);
    });
    return { route: 'done' } as const;
  };

  if (eligible.length === 1) {
    const only = eligible[0]!;
    if (sender.tenant_id !== only.tenant_id || sender.user_id !== only.user_id)
      await controlTx(d.sql, (tx) => remember(tx, only));
    if (reply && 'command' in reply) return answer(d, row, 'store', DUA.onlyStore(only.name));
    return only;
  }
  if (reply && 'command' in reply) return askStore();
  const kept = eligible.find(
    (e) => e.tenant_id === sender.tenant_id && e.user_id === sender.user_id,
  );
  if (kept) return kept;
  const pending = (sender.choices ?? []).filter((c) =>
    eligible.some((e) => e.tenant_id === c.tenantId && e.user_id === c.userId),
  );
  const n = pending.length === sender.choices?.length ? parseChoice(body, pending.length) : null;
  if (n) {
    const c = pending[n - 1]!;
    const picked = eligible.find((e) => e.tenant_id === c.tenantId && e.user_id === c.userId)!;
    await controlTx(d.sql, async (tx) => {
      await remember(tx, picked);
      await enqueuePlatformWaTx(tx, {
        to: replyTo(row),
        body: DUA.chosen(picked.name),
        purpose: 'dua',
        dedupeKey: `dua-in:${row.id}:chosen`,
      });
      await markDoneTx(tx, row.id);
    });
    return { route: 'done' };
  }
  return askStore();
}

interface Card {
  id: string;
  wa_ref: number | null;
  status: string;
  money: boolean;
  expires_at: Date;
}

async function actorOf(tx: Sql, e: Eligible): Promise<{ t: Tenant; m: Merchant } | null> {
  const [r] = await tx<
    {
      id: string;
      slug: string;
      name: string;
      status: string;
      user_name: string;
      phone: string;
      role: Role;
    }[]
  >`
    select t.id, t.slug, t.name, t.status, u.name as user_name, u.phone, u.role
    from tenants t join merchant_users u on u.tenant_id = t.id and u.id = ${e.user_id}
      and u.status = 'active'
    where t.id = ${e.tenant_id}`;
  if (!r || r.status !== 'active') return null;
  return {
    t: { id: r.id, slug: r.slug, name: r.name, status: r.status } as Tenant,
    m: { userId: e.user_id, sessionId: '', name: r.user_name, phone: r.phone, role: r.role },
  };
}

/**
 * "SIM", "SIM 2", "não": against the cards of Duá's last reply by WhatsApp. The card is applied by
 * decideTx with the admin tap's checks (role, expiry, basis drift); the outcome is written to the
 * conversation and sent back. null when Duá has said something since its last cards: an "ok" to a
 * later question is a message for Duá, never a yes to a card further up.
 */
async function decideByReply(
  d: DuaDeps,
  row: InboxRow,
  e: Eligible,
  reply: { decision: 'confirm' | 'decline'; n: number | null },
): Promise<DuaOutcome | null> {
  const body = (row.body ?? '').trim().slice(0, MAX_BODY);
  let stale = false;
  // decideTx replays admin routes: the control scope opens only around the platform statements
  await withTenant(d.sql, e.tenant_id, async (tx) => {
    const [last] = await tx<{ batch: string | null; reply: string | null }[]>`
      select
        (select message_id from copilot_actions
         where tenant_id = ${e.tenant_id} and user_id = ${e.user_id} and wa_ref is not null
         order by created_at desc limit 1) as batch,
        (select id from copilot_messages
         where tenant_id = ${e.tenant_id} and user_id = ${e.user_id} and author = 'dua'
           and channel = 'whatsapp' and turn_id is not null
         order by created_at desc, id desc limit 1) as reply`;
    if (last?.batch && last.batch !== last.reply) {
      stale = true;
      return;
    }
    const say = async (text: string) => {
      await tx`
        insert into copilot_messages (tenant_id, user_id, author, body, channel)
        values (${e.tenant_id}, ${e.user_id}, 'merchant', ${body}, 'whatsapp'),
               (${e.tenant_id}, ${e.user_id}, 'dua', ${text}, 'whatsapp')`;
      await emitAdminTx(tx, e.tenant_id, 'copilot', e.user_id);
      await inControlScope(tx, async () => {
        await enqueuePlatformWaTx(tx, {
          to: replyTo(row),
          body: text,
          purpose: 'dua',
          dedupeKey: `dua-in:${row.id}:decided`,
        });
        await markDoneTx(tx, row.id);
      });
    };
    const actor = await actorOf(tx, e);
    if (!actor) return say(DUA.forbidden);
    const batch = await tx<Card[]>`
      select id, wa_ref, status, money, expires_at from copilot_actions
      where tenant_id = ${e.tenant_id} and user_id = ${e.user_id} and wa_ref is not null
        and message_id = (
          select message_id from copilot_actions
          where tenant_id = ${e.tenant_id} and user_id = ${e.user_id} and wa_ref is not null
          order by created_at desc limit 1)
      order by wa_ref
      for update`;
    const now = Date.now();
    const open = batch.filter((c) => c.status === 'proposed' && c.expires_at.getTime() > now);
    let picked: Card[];
    if (reply.n != null) {
      const c = batch.find((x) => x.wa_ref === reply.n);
      if (!c) return say(DUA.nothingOpen);
      if (!open.includes(c))
        return say(c.status === 'proposed' || c.status === 'expired' ? DUA.expired : DUA.decided);
      picked = [c];
    } else if (!open.length) {
      return say(batch.some((c) => c.status === 'proposed') ? DUA.expired : DUA.nothingOpen);
    } else if (reply.decision === 'decline') {
      picked = open;
    } else if (open.length > 1) {
      return say(DUA.whichOne(open.map((c) => c.wa_ref!)));
    } else {
      picked = open;
    }

    if (reply.decision === 'decline') {
      for (const c of picked) await decideTx(tx, actor.t, actor.m, c.id, 'decline');
      return say(DUA.declined);
    }
    const card = picked[0]!;
    if (card.money) return say(DUA.moneyInApp(appLink(d, '/copiloto')));
    try {
      await (tx as unknown as Savepointable).savepoint((sp) =>
        decideTx(sp, actor.t, actor.m, card.id, 'confirm', { via: 'whatsapp' }),
      );
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) return say(DUA.forbidden);
      throw err;
    }
    const [after] = await tx<{ status: string; error: string | null; done: string | null }[]>`
      select status, error, done from copilot_actions where id = ${card.id}`;
    if (after?.status === 'applied') return say(DUA.done(after.done));
    if (after?.status === 'expired') return say(DUA.expired);
    if (after?.status === 'failed')
      return say(
        after.error?.startsWith('Isso mudou') ? DUA.drifted : (after.error ?? DUA.drifted),
      );
    return say(DUA.decided);
  });
  return stale ? null : { route: 'done' };
}

type Savepointable = { savepoint: <T>(fn: (sp: Sql) => Promise<T>) => Promise<T> };

/**
 * The words of the message: typed, a voice note transcribed, or a photo read (copilot/media.ts,
 * the admin's own path), all with the store's names as hints.
 */
async function hear(
  d: DuaDeps,
  row: InboxRow,
  e: Eligible,
  body: string,
): Promise<Heard | DuaOutcome> {
  const audioTag = body.startsWith('[áudio');
  const imageTag = body.startsWith('[imagem');
  if (!row.media_id) {
    // Core's socket never downloads; the gateway marks a note it couldn't fetch, and keeps none
    // of one past the caps
    if (audioTag && (!d.media || platformTransport() === 'socket'))
      return answer(d, row, 'voice', DUA.textOnly);
    if (body.startsWith(AUDIO_NOT_FETCHED)) return answer(d, row, 'voice', DUA.voiceUnheard);
    if (audioTag) return answer(d, row, 'voice', DUA.voiceTooLong);
    if (imageTag && d.gateway && platformTransport() !== 'socket')
      return answer(d, row, 'media', DUA.photoUnseen);
    if (!body || /^\[(imagem|vídeo|documento|figurinha)/.test(body))
      return answer(
        d,
        row,
        'media',
        d.gateway && platformTransport() !== 'socket' ? DUA.mediaKinds : DUA.mediaOnly,
      );
    return {
      kind: 'text',
      input: body.slice(0, MAX_BODY),
      shown: body.slice(0, MAX_BODY),
      photo: null,
    };
  }
  const [file] = await controlTx(
    d.sql,
    (tx) => tx<{ bytes: Uint8Array; mime: string }[]>`
      select bytes, mime from platform_wa_media where id = ${row.media_id}`,
  );
  const photo = file ? file.mime.startsWith('image/') : imageTag;
  if (photo ? !d.gateway : !d.media)
    return answer(d, row, 'media', photo ? DUA.mediaOnly : DUA.textOnly);
  if (!file) return answer(d, row, 'media', photo ? DUA.photoUnseen : DUA.voiceUnheard);
  // each one is a paid call: the same daily room as the admin's
  const room = await withTenant(d.sql, e.tenant_id, (tx) =>
    takeMediaCallTx(tx, e.tenant_id, e.user_id, photo ? 'image' : 'voice'),
  );
  if (!room) return answer(d, row, 'media', DUA.mediaCap);
  if (photo) {
    const caption = body.replace(/^\[imagem\]\s*/, '');
    const seen = await seePhoto(d.gateway!, e.tenant_id, file.bytes, caption).catch((err) => {
      // a file that isn't an image we can decode reads as unseen
      if (err instanceof HttpError) return null;
      throw err;
    });
    return seen ?? answer(d, row, 'media', DUA.photoUnseen);
  }
  const heard = await hearVoice(d.sql, d.media!, e.tenant_id, file.bytes, file.mime);
  return heard ?? answer(d, row, 'voice', DUA.voiceUnheard);
}

/** The message joins the person's Copilot conversation: one mailbox row, in this transaction. */
async function dispatchTurn(
  d: DuaDeps,
  row: InboxRow,
  e: Eligible,
  heard: Heard,
): Promise<DuaOutcome> {
  await withTenant(d.sql, e.tenant_id, async (tx) => {
    await copilotInboundTx(tx, {
      tenantId: e.tenant_id,
      userId: e.user_id,
      channel: 'whatsapp',
      heard,
      source: `whatsapp:${e.user_id}`,
      dedupeKey: `copilot-wa:${row.id}`,
    });
    await inControlScope(tx, () => markDoneTx(tx, row.id));
  });
  duaLog.info({ tenantId: e.tenant_id, kind: heard.kind }, 'dua whatsapp message');
  return { route: 'done' };
}
