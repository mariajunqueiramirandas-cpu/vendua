import type { Sql } from '../platform/db.ts';
import { getIntegrationTx, type Guardrails } from '../modules/integrations.ts';
import type { Channel } from '../modules/threads.ts';
import { waStatus } from './channels/whatsapp.ts';
import { autonomyTx, draftDecision } from './policy.ts';

/**
 * agent/guardrails — the hard rules around every outbound message. Enforced
 * in code in the runner path, never in the prompt: the model asks, this
 * decides. Ordering matters — the first false answer wins.
 */

export interface ChannelVerdict {
  ok: boolean;
  reason?: string;
}

/** Enabled integration alone doesn't mean whatsapp can send — the baileys
 *  driver also needs a live session (waStatus 'open'); drivers that need no
 *  connection (log) count as ready on the row alone. Shared by the discovery
 *  autocontact gate and channel availability so 'reachable' means the same
 *  thing everywhere. */
export async function whatsappReadyTx(tx: Sql): Promise<boolean> {
  const wa = await getIntegrationTx(tx, 'whatsapp');
  if (!wa) return false;
  return wa.driver === 'baileys' ? waStatus() === 'open' : true;
}

/** Which channels can actually carry a message to this lead right now:
 *  contact data + an enabled integration + deliverability. 'manual' always
 *  works — a draft there is a note for staff to copy elsewhere. */
export async function channelAvailabilityTx(
  tx: Sql,
  leadId: string,
  opts: { lock?: boolean } = {},
): Promise<Record<Channel, ChannelVerdict>> {
  // lock: serialize against concurrent contact/bounce writes (updateLead,
  // delivery events) — a resolve→insert caller holding the lead row can't be
  // stranded on a channel that died mid-transaction. Display-only callers
  // (run context's CANAIS line) leave it off — no need to block writes.
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
  // An inbound whatsapp thread carries the sender's number on external_id —
  // reachable even when lead.whatsapp was never saved.
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
      /** channel of the lead's last inbound — set when this send switches
       *  channels mid-conversation, so the caller can say so in the copy. */
      prevChannel: Channel | null;
    }
  | { ok: false; reason: string; available: Channel[] };

/** Resolve which channel a send/draft should go out on. Priority: a staff
 *  override (dispatch-time `params.channel`) > the model's explicit arg >
 *  the channel the lead last wrote on (continuity) > whatsapp > email.
 *  A requested-but-dead channel returns {ok:false, available} so the caller
 *  can retry on a reachable one instead of composing on air. 'manual' is
 *  only honored when explicitly requested — it never delivers by itself. */
export async function resolveChannelTx(
  tx: Sql,
  leadId: string,
  args: {
    requested?: Channel | null;
    override?: Channel | null;
    /** A thread-bound run (reply) continues on ITS thread's channel — the
     *  lead's newer inbound on another channel must not hijack a reply
     *  composed from this thread's context. Unbound runs use the lead's
     *  last inbound instead. */
    threadId?: string | null;
  },
): Promise<ChannelPick> {
  const avail = await channelAvailabilityTx(tx, leadId, { lock: true });
  const usable = (['whatsapp', 'email'] as const).filter((ch) => avail[ch].ok);
  // Continuity channel — for continuity picks and to flag a mid-conversation
  // switch back to the caller.
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
  // First contact / stale channel: whatsapp is the stronger channel for this
  // audience, email the fallback.
  const first = usable[0];
  if (first) return { ok: true, channel: first, via: 'fallback', prevChannel: prev };
  return {
    ok: false,
    reason: 'no reachable channel (whatsapp/email both unavailable)',
    available: [],
  };
}

/** Whether agent output is paused for (lead, channel): the lead-wide
 *  handoff flag (`leads.agent_paused_at`, set by an unbound request_human)
 *  blocks every channel — including ones with no thread yet; otherwise a
 *  paused destination thread blocks. Missing thread + no lead flag = fresh
 *  channel, allowed. */
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

/** Tx-local guardrail check — the send_message tool calls this inside the
 *  same transaction that takes the lead's advisory lock and inserts the
 *  outbound message, so two concurrent runs can't both see spare cap. */
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
    // A bounced address is a dead address — Resend told us so. Blocking here
    // pushes the agent to the lead's other channels instead of burning
    // reputation on a guaranteed bounce.
    if (channel === 'email' && lead.email_bounced_at)
      return { ok: false, forceDraft: false, reason: 'email bounced' };

    // First contact is always human-approved — the lead has never seen an
    // outbound from us, so this one must wait in the approvals queue. The
    // draft decision runs before the send-only gates: a forced draft is an
    // approval item, not a wire send — quiet hours and the daily cap pace
    // sends, not drafts, so they only bind when the live decision permits
    // an actual send (a zero-delay first contact at 22:00 must still leave
    // something to approve).
    const priorOut = (
      await tx<{ n: number }[]>`
        select count(*)::int as n from lead_messages m
        join lead_threads t on t.id = m.thread_id
        where t.lead_id = ${leadId} and m.direction = 'out'
          and m.status in ('queued', 'sending', 'sent', 'delivered')
      `
    )[0]!.n;
    const { level } = await autonomyTx(tx);
    const d = draftDecision({
      level,
      firstContact: priorOut === 0,
      firstContactDraftOnly: g.firstContactDraftOnly,
      leadMode: lead.agent_mode,
    });
    if (d.forceDraft) return { ok: true, forceDraft: true };

    // Quiet hours — compared in the configured timezone (America/Sao_Paulo
    // default). Overnight window (21:00→08:00) wraps past midnight.
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

    // Daily outbound cap per lead (agent-authored only — staff sends don't count).
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
