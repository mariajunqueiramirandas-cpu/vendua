import type { Sql } from '../platform/db.ts';
import { getIntegrationTx, type Guardrails } from '../modules/integrations.ts';
import type { Channel } from '../modules/threads.ts';
import { waStatus } from './channels/whatsapp.ts';
import { agentSettingTx, draftDecision } from './policy.ts';

/**
 * Hard outbound rules enforced in code in the runner path, never in the
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
        email_bounced_at: string | null;
      }[]
    >`select email, whatsapp, email_bounced_at from leads where id = ${leadId} ${opts.lock ? tx.unsafe('for update') : tx.unsafe('')}`
  )[0];
  if (!lead) {
    const dead = { ok: false, reason: 'lead not found' };
    return { whatsapp: dead, email: dead, manual: dead };
  }
  // an inbound whatsapp thread carries the sender on external_id — reachable
  // even without lead.whatsapp
  const waThread = (
    await tx<{ n: number }[]>`
      select count(*)::int as n from lead_threads
      where lead_id = ${leadId} and channel = 'whatsapp' and external_id is not null
    `
  )[0]!.n;
  const [waInt, emInt] = await Promise.all([
    getIntegrationTx(tx, 'whatsapp'),
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
 *  whatsapp > email; 'manual' only when explicitly requested. */
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
  const usable = (['whatsapp', 'email'] as const).filter((ch) => avail[ch].ok);
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
  const prev = lastIn === 'whatsapp' || lastIn === 'email' ? lastIn : null;
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
  // first contact / stale channel: whatsapp is the stronger channel, email the fallback
  const first = usable[0];
  if (first) return { ok: true, channel: first, via: 'fallback', prevChannel: prev };
  return {
    ok: false,
    reason: 'no reachable channel (whatsapp/email both unavailable)',
    available: [],
  };
}

/** Paused = lead-wide agent_paused_at blocks every channel; else a paused
 *  destination thread blocks; missing thread = allowed. */
export async function agentPausedForChannelTx(
  tx: Sql,
  leadId: string,
  channel: Channel,
): Promise<boolean> {
  const lead = (
    await tx<{ agent_paused_at: string | null }[]>`
      select agent_paused_at from leads where id = ${leadId} for update
    `
  )[0];
  if (lead?.agent_paused_at) return true;
  const dest = (
    await tx<{ agent_enabled: boolean }[]>`
      select agent_enabled from lead_threads
      where lead_id = ${leadId} and channel = ${channel}
      for update
    `
  )[0];
  return !!dest && !dest.agent_enabled;
}

export interface SendVerdict {
  ok: boolean;
  /** true → send_message degrades to a draft for the approvals queue. */
  forceDraft: boolean;
  reason?: string;
}

/** Runs inside the tx holding the lead's advisory lock so concurrent runs
 *  can't both see spare cap. */
export async function checkSendAllowedTx(
  tx: Sql,
  g: Guardrails,
  leadId: string,
  channel: Channel,
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
    if (lead.unsubscribed_at) return { ok: false, forceDraft: false, reason: 'lead unsubscribed' };
    if (lead.agent_paused_at)
      return { ok: false, forceDraft: false, reason: 'agent paused for lead' };
    if (lead.agent_mode === 'off')
      return { ok: false, forceDraft: false, reason: 'agent off for lead' };
    // a bounced address is dead — block here so the agent tries other channels
    if (channel === 'email' && lead.email_bounced_at)
      return { ok: false, forceDraft: false, reason: 'email bounced' };

    // first contact is always human-approved; the draft decision runs
    // before the send-only gates so quiet hours/cap only bind live sends
    const priorOut = (
      await tx<{ n: number }[]>`
        select count(*)::int as n from lead_messages m
        join lead_threads t on t.id = m.thread_id
        where t.lead_id = ${leadId} and m.direction = 'out'
          and m.status in ('queued', 'sending', 'sent', 'delivered')
      `
    )[0]!.n;
    const { level } = await agentSettingTx(tx);
    const d = draftDecision({
      level,
      firstContact: priorOut === 0,
      leadMode: lead.agent_mode,
    });
    if (d.forceDraft) return { ok: true, forceDraft: true };

    // quiet hours in configured tz; overnight window wraps past midnight
    const hh = (
      await tx<{ h: number; m: number }[]>`
        select extract(hour from now() at time zone ${g.timezone})::int as h,
               extract(minute from now() at time zone ${g.timezone})::int as m
      `
    )[0]!;
    const cur = hh.h * 60 + hh.m;
    const [qsH, qsM] = g.quietStart.split(':').map(Number);
    const [qeH, qeM] = g.quietEnd.split(':').map(Number);
    const start = (qsH ?? 21) * 60 + (qsM ?? 0);
    const end = (qeH ?? 8) * 60 + (qeM ?? 0);
    const quiet = start <= end ? cur >= start && cur < end : cur >= start || cur < end;
    if (quiet) return { ok: false, forceDraft: false, reason: 'quiet hours' };

    // daily outbound cap per lead (agent-authored only)
    const sentToday = (
      await tx<{ n: number }[]>`
        select count(*)::int as n from lead_messages m
        join lead_threads t on t.id = m.thread_id
        where t.lead_id = ${leadId} and m.direction = 'out' and m.author = 'agent'
          and m.status in ('queued', 'sending', 'sent', 'delivered')
          and m.created_at > now() - interval '1 day'
      `
    )[0]!.n;
    if (sentToday >= g.maxOutboundPerLeadPerDay) {
      return { ok: false, forceDraft: false, reason: 'daily cap reached' };
    }
    return { ok: true, forceDraft: false };
  }
}
