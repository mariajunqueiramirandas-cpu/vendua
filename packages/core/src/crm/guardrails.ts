import type { Sql } from '../platform/db.ts';
import { DEFAULT_GUARDRAILS, getIntegrationTx, type Guardrails } from '../modules/integrations.ts';
import {
  instagramHandle,
  SEND_CHANNELS,
  type Channel,
  type SendChannel,
} from '../modules/threads.ts';
import { waStatus } from './channels/whatsapp.ts';
import { igState } from './channels/instagram.ts';
import { agentSettingTx, draftDecision } from './policy.ts';

/**
 * Hard outbound rules enforced in code in the send tools, never in the
 * prompt. Ordering matters — the first false answer wins.
 */

export interface ChannelVerdict {
  ok: boolean;
  reason?: string;
}

/** Enabled row + live connection (baileys needs waStatus 'open'; 'log'
 *  needs none). Shared so 'reachable' means the same thing everywhere. */
export async function whatsappReadyTx(tx: Sql): Promise<boolean> {
  const wa = await getIntegrationTx(tx, 'whatsapp');
  if (!wa) return false;
  return wa.driver === 'baileys' ? waStatus() === 'open' : true;
}

/** Enabled row + live sidecar session ('log' needs none). */
export async function instagramReadyTx(tx: Sql): Promise<boolean> {
  const ig = await getIntegrationTx(tx, 'instagram');
  if (!ig) return false;
  return ig.driver === 'sidecar' ? igState() === 'open' : true;
}

/** Enabled email row + live credentials ('log' needs none; 'resend' needs its key). */
export async function emailReadyTx(tx: Sql): Promise<boolean> {
  const em = await getIntegrationTx(tx, 'email');
  if (!em) return false;
  return (
    em.driver !== 'resend' ||
    Boolean((em.secret_ref && process.env[em.secret_ref]) ?? process.env.RESEND_API_KEY)
  );
}

/** Minimum intentScore that lets a fitScore one point below the threshold still auto-contact. */
export const INTENT_BOOST_MIN = 6;

/** Auto-contact score gate: fitScore >= minScore, or one point below with strong intent (>= 6). */
export function passesAutoContactScore(
  fitScore: number | null,
  intentScore: number | null,
  minScore: number,
): boolean {
  if (fitScore === null) return false;
  if (fitScore >= minScore) return true;
  return (
    intentScore !== null && fitScore >= Math.max(1, minScore - 1) && intentScore >= INTENT_BOOST_MIN
  );
}

/** Channels that can carry a message now: contact data + enabled
 *  integration + deliverability; 'manual' always works. */
export async function channelAvailabilityTx(
  tx: Sql,
  leadId: string,
  opts: { lock?: boolean } = {},
): Promise<Record<Channel, ChannelVerdict>> {
  // lock serializes against concurrent contact/bounce writes; display
  // callers (run context's CANAIS line) leave it off
  const lead = (
    await tx<
      {
        email: string | null;
        whatsapp: string | null;
        instagram: string | null;
        email_bounced_at: string | null;
      }[]
    >`select email, whatsapp, instagram, email_bounced_at from leads where id = ${leadId} ${opts.lock ? tx.unsafe('for update') : tx.unsafe('')}`
  )[0];
  if (!lead) {
    const dead = { ok: false, reason: 'lead not found' };
    return { whatsapp: dead, instagram: dead, email: dead, manual: dead };
  }
  // an inbound whatsapp thread carries the sender on external_id — reachable
  // even without lead.whatsapp
  const waThread = (
    await tx<{ n: number }[]>`
      select count(*)::int as n from lead_threads
      where lead_id = ${leadId} and channel = 'whatsapp' and external_id is not null
    `
  )[0]!.n;
  // an inbound/sent instagram thread carries the account id — reachable even
  // if lead.instagram was cleared or renamed
  const igThread = (
    await tx<{ n: number }[]>`
      select count(*)::int as n from lead_threads
      where lead_id = ${leadId} and channel = 'instagram' and external_id is not null
    `
  )[0]!.n;
  const [waInt, igInt, emInt] = await Promise.all([
    getIntegrationTx(tx, 'whatsapp'),
    getIntegrationTx(tx, 'instagram'),
    getIntegrationTx(tx, 'email'),
  ]);
  return {
    whatsapp:
      !lead.whatsapp && !waThread
        ? { ok: false, reason: 'lead has no whatsapp' }
        : !waInt
          ? { ok: false, reason: 'whatsapp integration off' }
          : waInt.driver === 'baileys' && waStatus() !== 'open'
            ? { ok: false, reason: 'whatsapp disconnected' }
            : { ok: true },
    instagram:
      !instagramHandle(lead.instagram) && !igThread
        ? { ok: false, reason: 'lead has no instagram' }
        : !igInt
          ? { ok: false, reason: 'instagram integration off' }
          : igInt.driver === 'sidecar' && igState() !== 'open'
            ? { ok: false, reason: 'instagram disconnected' }
            : { ok: true },
    email: !lead.email
      ? { ok: false, reason: 'lead has no email' }
      : !emInt
        ? { ok: false, reason: 'email integration off' }
        : lead.email_bounced_at
          ? { ok: false, reason: 'email bounced' }
          : { ok: true },
    manual: { ok: true },
  };
}

export type ChannelPick =
  | {
      ok: true;
      channel: Channel;
      via: 'requested' | 'override' | 'continuity' | 'fallback';
      /** channel of the lead's last inbound — set on a mid-conversation switch */
      prevChannel: Channel | null;
    }
  | { ok: false; reason: string; available: Channel[] };

/** Send channel: staff override > model arg > last-inbound continuity >
 *  whatsapp > instagram > email; 'manual' only when explicitly requested. */
export async function resolveChannelTx(
  tx: Sql,
  leadId: string,
  args: {
    requested?: Channel | null;
    override?: Channel | null;
    /** thread-bound run continues on ITS thread's channel; unbound runs
     *  use last inbound. */
    threadId?: string | null;
  },
): Promise<ChannelPick> {
  const avail = await channelAvailabilityTx(tx, leadId, { lock: true });
  const usable = SEND_CHANNELS.filter((ch) => avail[ch].ok);
  // continuity channel — for continuity picks and mid-conversation-switch flags
  const lastIn =
    (
      await tx<{ channel: Channel | null }[]>`
      select coalesce(
        (select channel from lead_threads where id = ${args.threadId ?? null} and lead_id = ${leadId}),
        (select t.channel from lead_messages m
          join lead_threads t on t.id = m.thread_id
          where t.lead_id = ${leadId} and m.direction = 'in'
          order by m.created_at desc limit 1)
      ) as channel
    `
    )[0]?.channel ?? null;
  const prev = lastIn && lastIn !== 'manual' ? lastIn : null;
  const want = args.override ?? args.requested ?? null;
  if (want) {
    // 'manual' never auto-picks — only the model/staff may draft to it.
    if (want === 'manual')
      return { ok: true, channel: 'manual', via: 'requested', prevChannel: prev };
    if (avail[want].ok) {
      return {
        ok: true,
        channel: want,
        via: args.override ? 'override' : 'requested',
        prevChannel: prev,
      };
    }
    return { ok: false, reason: avail[want].reason!, available: usable };
  }
  // Continuity: answer on the channel the lead last wrote on if it's alive.
  if (prev && avail[prev].ok) {
    return { ok: true, channel: prev, via: 'continuity', prevChannel: prev };
  }
  // first contact / stale channel: whatsapp is the stronger channel, then an instagram DM, email last
  const first = usable[0];
  if (first) return { ok: true, channel: first, via: 'fallback', prevChannel: prev };
  return {
    ok: false,
    reason: 'no reachable channel (whatsapp/instagram/email all unavailable)',
    available: [],
  };
}

/** Paused = lead-wide agent_paused_at blocks every channel; else a paused
 *  destination thread blocks; missing thread = allowed. */
export async function agentPausedForChannelTx(
  tx: Sql,
  leadId: string,
  channel: Channel,
  opts: { lock?: boolean } = { lock: true },
): Promise<boolean> {
  const lock = tx.unsafe(opts.lock ? 'for update' : '');
  const lead = (
    await tx<{ agent_paused_at: string | null }[]>`
      select agent_paused_at from leads where id = ${leadId} ${lock}
    `
  )[0];
  if (lead?.agent_paused_at) return true;
  const dest = (
    await tx<{ agent_enabled: boolean }[]>`
      select agent_enabled from lead_threads
      where lead_id = ${leadId} and channel = ${channel}
      ${lock}
    `
  )[0];
  return !!dest && !dest.agent_enabled;
}

/** Channels a send / a draft to this lead would land on right now — the same checks
 *  send_message and draft_message run at execution (reachability, pause, verdict),
 *  read-only, so the per-turn tool gate never offers a call that can only block. */
export async function sendableNowTx(
  tx: Sql,
  g: Guardrails,
  leadId: string,
  opts: {
    /** send channels connected in the install */
    channels: readonly SendChannel[];
    draftOnly: boolean;
    override: SendChannel | null;
  },
): Promise<{ send: SendChannel[]; draft: Channel[]; why: string | null }> {
  const avail = await channelAvailabilityTx(tx, leadId);
  const misses: string[] = [];
  const open: Channel[] = [];
  // staff's forced channel trumps every pick — nothing else can be used; channels the
  // install lacks aren't candidates at all (the prompt already says they're off)
  const candidates: Channel[] = opts.override
    ? [opts.override]
    : [...SEND_CHANNELS.filter((c) => opts.channels.includes(c)), 'manual'];
  for (const c of candidates) {
    if (c !== 'manual' && !opts.channels.includes(c)) {
      misses.push(`${c}: integration off`);
      continue;
    }
    if (!avail[c].ok) {
      misses.push(`${c}: ${avail[c].reason ?? 'unavailable'}`);
      continue;
    }
    if (await agentPausedForChannelTx(tx, leadId, c, { lock: false })) {
      misses.push(`${c}: thread paused for agent`);
      continue;
    }
    open.push(c);
  }
  const send: SendChannel[] = [];
  let verdictWhy: string | null = null;
  for (const c of open) {
    if (c === 'manual') continue;
    const v = opts.draftOnly
      ? { ok: true, reason: undefined }
      : await checkSendAllowedTx(tx, g, leadId, c);
    if (v.ok) send.push(c);
    else verdictWhy ??= v.reason ?? 'guardrail';
  }
  return {
    send,
    draft: open,
    why: send.length ? null : (verdictWhy ?? (misses.join('; ') || 'no reachable channel')),
  };
}

/** First-contact policy uses live conversations and explicit website callback requests. */
export async function leadHasContactTx(tx: Sql, leadId: string): Promise<boolean> {
  const [row] = await tx<{ contacted: boolean }[]>`
    select exists (
      select 1 from lead_messages m join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${leadId} and t.channel <> 'manual' and not m.historical
        and (m.direction = 'in' or m.status in ('sent', 'delivered'))
      union all
      select 1 from lead_activities
      where lead_id = ${leadId} and meta->>'type' = 'site_callback'
    ) as contacted`;
  return row!.contacted;
}

/** Count unattended sends since the last live inbound or website callback. */
export async function unansweredTouchesTx(
  tx: Sql,
  leadId: string,
  excludeMessageId: string | null = null,
): Promise<{ total: number; today: number }> {
  const [row] = await tx<{ total: number; today: number }[]>`
    with boundary as (
      select greatest(
        (select max(i.created_at) from lead_messages i join lead_threads t on t.id = i.thread_id
          where t.lead_id = ${leadId} and i.direction = 'in' and not i.historical
            and not i.auto_reply),
        (select max(at) from lead_activities where lead_id = ${leadId} and meta->>'type' = 'site_callback'),
        '-infinity') as at
    )
    select count(*)::int as total,
      count(*) filter (where m.created_at > now() - interval '1 day')::int as today
    from lead_messages m join lead_threads t on t.id = m.thread_id cross join boundary b
    where t.lead_id = ${leadId} and t.channel <> 'manual' and m.direction = 'out'
      and m.author = 'agent' and m.approved_by is null and not m.is_farewell
      and m.status in ('queued', 'sending', 'sent', 'delivered')
      and m.id is distinct from ${excludeMessageId}::uuid and m.created_at >= b.at`;
  return row!;
}

export interface SendVerdict {
  ok: boolean;
  /** true → send_message degrades to a draft for the approvals queue. */
  forceDraft: boolean;
  reason?: string;
  retryAt?: Date;
}

/** Runs inside the tx holding the lead's advisory lock so concurrent runs
 *  can't both see spare cap. */
export async function checkSendAllowedTx(
  tx: Sql,
  g: Guardrails,
  leadId: string,
  channel: Channel,
  opts: { messageId?: string; farewell?: boolean; skipBudget?: boolean } = {},
): Promise<SendVerdict> {
  {
    const lead = (
      await tx<
        {
          agent_mode: string;
          archived_at: string | null;
          unsubscribed_at: string | null;
          agent_paused_at: string | null;
          email_bounced_at: string | null;
        }[]
      >`select agent_mode, archived_at, unsubscribed_at, agent_paused_at, email_bounced_at from leads where id = ${leadId}`
    )[0];
    if (!lead) return { ok: false, forceDraft: false, reason: 'lead not found' };
    if (lead.archived_at) return { ok: false, forceDraft: false, reason: 'lead archived' };
    if (lead.unsubscribed_at && !opts.farewell)
      return { ok: false, forceDraft: false, reason: 'lead unsubscribed' };
    if (lead.agent_paused_at)
      return { ok: false, forceDraft: false, reason: 'agent paused for lead' };
    if (lead.agent_mode === 'off')
      return { ok: false, forceDraft: false, reason: 'agent off for lead' };
    // a bounced address is dead — block here so the agent tries other channels
    if (channel === 'email' && lead.email_bounced_at)
      return { ok: false, forceDraft: false, reason: 'email bounced' };

    const { level } = await agentSettingTx(tx);
    const d = draftDecision({
      level,
      firstContact: !(await leadHasContactTx(tx, leadId)),
      leadMode: lead.agent_mode,
    });
    if (d.forceDraft) return { ok: true, forceDraft: true };

    const now = new Date();
    const open = await sendWindowOpenAtTx(tx, g, now);
    if (open.getTime() > now.getTime())
      return { ok: false, forceDraft: false, reason: 'quiet hours', retryAt: open };

    // A row already handed to the gateway has already reserved its capacity.
    if (opts.skipBudget) return { ok: true, forceDraft: false };
    if (!opts.farewell) {
      const { total, today } = await unansweredTouchesTx(tx, leadId, opts.messageId ?? null);
      if (g.maxOutboundPerLeadPerDay > 0 && today >= g.maxOutboundPerLeadPerDay)
        return { ok: false, forceDraft: false, reason: 'unanswered cap reached' };
      if (total >= g.maxUnansweredTouches)
        return { ok: false, forceDraft: false, reason: 'unanswered sequence ended' };
    }

    if (channel === 'instagram') {
      const cold = await instagramColdCapTx(tx, g, leadId, opts.messageId);
      if (cold) return { ok: false, forceDraft: false, reason: cold };
    }
    return { ok: true, forceDraft: false };
  }
}

/** Account-wide cold-DM budget: opening a conversation with a lead who never
 *  wrote on instagram counts against instagramColdDmsPerDay (rolling 24h, agent
 *  sends only). A conversation counts once, by its first outbound — replies and
 *  follow-ups to an already-opened thread are free. Returns the refusal reason, or null. */
export async function instagramColdCapTx(
  tx: Sql,
  g: Guardrails,
  leadId: string,
  excludeMessageId: string | null = null,
): Promise<string | null> {
  const lead = (
    await tx<{ wrote: number; opened: number }[]>`
      select
        count(*) filter (where m.direction = 'in')::int as wrote,
        count(*) filter (where m.direction = 'out'
          and m.status in ('queued', 'sending', 'sent', 'delivered'))::int as opened
      from lead_messages m
      join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${leadId} and t.channel = 'instagram'
        and m.id is distinct from ${excludeMessageId}::uuid
    `
  )[0]!;
  if (lead.wrote > 0 || lead.opened > 0) return null;
  const cap = g.instagramColdDmsPerDay ?? DEFAULT_GUARDRAILS.instagramColdDmsPerDay;
  if (cap <= 0) return 'instagram cold DMs off';
  // account-wide count — serialize concurrent leads' checks or both see spare budget
  await tx`select pg_advisory_xact_lock(hashtext('ig-cold-cap'))`;
  const used = (
    await tx<{ n: number }[]>`
      select count(distinct o.id)::int as n from (
        select t.id, min(m.created_at) as opened_at
        from lead_messages m
        join lead_threads t on t.id = m.thread_id
        where t.channel = 'instagram' and m.direction = 'out'
          and m.id is distinct from ${excludeMessageId}::uuid
          and m.status in ('queued', 'sending', 'sent', 'delivered')
        group by t.id
      ) o
      join lead_messages first on first.thread_id = o.id and first.created_at = o.opened_at
      where o.opened_at > now() - interval '1 day'
        and first.author = 'agent'
        and not exists (
          select 1 from lead_messages i
          where i.thread_id = o.id and i.direction = 'in' and i.created_at < o.opened_at
        )
    `
  )[0]!.n;
  return used >= cap ? 'instagram cold-DM daily cap reached' : null;
}

/** Remaining rolling-24h Instagram cold-DM slots and when the earliest occupied slot frees up. */
export async function instagramColdBudgetTx(
  tx: Sql,
  g: Guardrails,
): Promise<{ remaining: number; nextSlotAt: Date | null }> {
  const cap = g.instagramColdDmsPerDay ?? DEFAULT_GUARDRAILS.instagramColdDmsPerDay;
  if (cap <= 0) return { remaining: 0, nextSlotAt: null };
  const [row] = await tx<{ used: number; oldest: Date | null }[]>`
    select count(distinct o.id)::int as used, min(o.opened_at) as oldest from (
      select t.id, min(m.created_at) as opened_at
      from lead_messages m
      join lead_threads t on t.id = m.thread_id
      where t.channel = 'instagram' and m.direction = 'out'
        and m.status in ('queued', 'sending', 'sent', 'delivered')
      group by t.id
    ) o
    join lead_messages first on first.thread_id = o.id and first.created_at = o.opened_at
    where o.opened_at > now() - interval '1 day'
      and first.author = 'agent'
      and not exists (
        select 1 from lead_messages i
        where i.thread_id = o.id and i.direction = 'in' and i.created_at < o.opened_at
      )
  `;
  const used = row?.used ?? 0;
  const remaining = Math.max(0, cap - used);
  if (remaining > 0) return { remaining, nextSlotAt: null };
  // Earliest rolling-24h slot frees up 24h + 2 min after the oldest cold DM opened.
  const next = row?.oldest
    ? new Date(new Date(row.oldest).getTime() + 86_400_000 + 120_000)
    : new Date(Date.now() + 3_600_000);
  return { remaining: 0, nextSlotAt: next };
}

/** Earliest instant ≥ `at` outside quiet hours, in the workspace timezone — the dispatcher
 *  starts send-bound runs there instead of letting them wake up just to be blocked. */
export async function sendWindowOpenAtTx(tx: Sql, g: Guardrails, at: Date): Promise<Date> {
  if (g.quietHoursEnabled === false) return at;
  const row = (
    await tx<{ open: Date }[]>`
      with p as (
        select (${at}::timestamptz at time zone ${g.timezone}) as lt,
               ${g.quietStart}::time as qs, ${g.quietEnd}::time as qe
      )
      select case
        when qs = qe then ${at}::timestamptz
        when (qs < qe and lt::time >= qs and lt::time < qe)
          or (qs > qe and (lt::time >= qs or lt::time < qe))
        then (case when lt::time < qe then date_trunc('day', lt) + qe
                   else date_trunc('day', lt) + interval '1 day' + qe end) at time zone ${g.timezone}
        else ${at}::timestamptz
      end as open
      from p
    `
  )[0]!;
  return new Date(row.open);
}
