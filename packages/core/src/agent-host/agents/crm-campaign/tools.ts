import { randomUUID } from 'node:crypto';
import { defineTool, s, ToolError, type Json, type JsonObject } from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import {
  DEFAULT_GUARDRAILS,
  getSettingTx,
  type Guardrails,
} from '../../../modules/integrations.ts';
import { recordStaffEventTx } from '../../../modules/staff-events.ts';
import { instagramHandle } from '../../../modules/threads.ts';
import {
  campaignMetricsTx,
  dropCampaignTicksTx,
  enrollCampaignLeadTx,
  launchCampaignHuntTx,
  scheduleCampaignTickTx,
} from '../../../crm/campaigns.ts';
import { requestLeadTx } from '../../../crm/dispatch.ts';
import {
  emailReadyTx,
  instagramColdBudgetTx,
  instagramReadyTx,
  whatsappColdBudgetTx,
  whatsappReadyTx,
} from '../../../crm/guardrails.ts';
import { crm, emitAfter, refusals, type Ctx } from '../crm/shared.ts';

// Tools for the `crm-campaign` Director actor: every tool takes its campaignId from
// `ctx.subject.id`, never from model arguments, and references leads strictly via runtime aliases.

const LEAD = 'lead';
const REPORT_COOLDOWN_MS = 4 * 60 * 60_000;
const URGENT_REPORT_COOLDOWN_MS = 30 * 60_000;

const campaignOf = (ctx: Ctx) => ctx.subject.id;

export const listCampaignLeadsTool = defineTool<
  {
    bucket?: 'replied' | 'awaiting' | 'uncontacted' | 'cold' | 'untouched_pool' | undefined;
    limit?: number | undefined;
  },
  Sql
>({
  name: 'list_campaign_leads',
  description:
    'Inspect leads in this campaign by bucket (replied, awaiting, uncontacted, cold) or untouched existing CRM leads (untouched_pool) that can be activated without paying for a new hunt. Returns lead aliases (l1, l2...) for use in coach_lead or activate_existing_leads.',
  effect: 'read',
  input: s.object({
    bucket: s.enum(['replied', 'awaiting', 'uncontacted', 'cold', 'untouched_pool']).optional(),
    limit: s.int({ min: 1, max: 15 }).optional(),
  }),
  run: (ctx: Ctx, input) =>
    refusals(() => {
      const campaignId = campaignOf(ctx);
      const bucket = input.bucket ?? 'replied';
      const limit = input.limit ?? 10;
      return crm(ctx, async (tx) => {
        if (bucket === 'untouched_pool') {
          const rows = await tx<
            {
              id: string;
              name: string;
              business_name: string | null;
              city: string | null;
              segment: string | null;
              fit_score: number | null;
              intent_score: number | null;
              whatsapp: string | null;
              whatsapp_verified: boolean;
              instagram: string | null;
              email: string | null;
            }[]
          >`
            select l.id, l.name, l.business_name, l.city, l.segment, l.fit_score, l.intent_score,
                   l.whatsapp, l.whatsapp_verified, l.instagram, l.email
            from leads l
            where l.state = 'lead'
              and l.archived_at is null and l.unsubscribed_at is null
              and l.agent_paused_at is null and l.tenant_id is null
              and l.agent_mode <> 'off'
              and not exists (
                select 1 from crm_campaign_leads cl
                where cl.campaign_id = ${campaignId} and cl.lead_id = l.id
              )
              and not exists (
                select 1 from lead_messages m join lead_threads t on t.id = m.thread_id
                where t.lead_id = l.id and m.direction in ('out', 'in')
              )
              and (
                (l.whatsapp is not null and l.whatsapp <> '')
                or (l.instagram is not null and l.instagram <> '')
                or (l.email is not null and l.email <> '' and l.email_bounced_at is null)
              )
            order by l.fit_score desc nulls last, l.intent_score desc nulls last, l.created_at desc
            limit ${limit}
          `;
          return {
            bucket,
            leads: rows.map((r) => ({
              ref: ctx.alias(LEAD, r.id),
              name: r.name,
              business: r.business_name,
              city: r.city,
              segment: r.segment,
              fitScore: r.fit_score,
              intentScore: r.intent_score,
              channels: {
                whatsapp: Boolean(r.whatsapp),
                whatsappVerified: r.whatsapp_verified,
                instagram: Boolean(r.instagram),
                email: Boolean(r.email),
              },
            })),
          } as unknown as Json;
        }

        const rows = await tx<
          {
            id: string;
            name: string;
            business_name: string | null;
            city: string | null;
            segment: string | null;
            state: string;
            origin: string;
            out_count: number;
            in_count: number;
            last_in_body: string | null;
            last_out_at: Date | null;
            last_in_at: Date | null;
            paused: boolean;
            unsubscribed: boolean;
          }[]
        >`
          with base as (
            select l.id, l.name, l.business_name, l.city, l.segment, l.state, cl.origin,
                   l.agent_paused_at is not null as paused,
                   l.unsubscribed_at is not null as unsubscribed,
                   (select count(*)::int from lead_messages m join lead_threads t on t.id = m.thread_id
                    where t.lead_id = l.id and t.channel <> 'manual' and m.direction = 'out'
                      and m.status in ('queued', 'sending', 'sent', 'delivered')) as out_count,
                   (select max(m.created_at) from lead_messages m join lead_threads t on t.id = m.thread_id
                    where t.lead_id = l.id and t.channel <> 'manual' and m.direction = 'out'
                      and m.status in ('queued', 'sending', 'sent', 'delivered')) as last_out_at,
                   (select count(*)::int from lead_messages m join lead_threads t on t.id = m.thread_id
                    where t.lead_id = l.id and m.direction = 'in' and not m.historical and not m.auto_reply
                      and m.created_at >= cl.enrolled_at) as in_count,
                   (select max(m.created_at) from lead_messages m join lead_threads t on t.id = m.thread_id
                    where t.lead_id = l.id and m.direction = 'in' and not m.historical and not m.auto_reply
                      and m.created_at >= cl.enrolled_at) as last_in_at,
                   (select m.body from lead_messages m join lead_threads t on t.id = m.thread_id
                    where t.lead_id = l.id and m.direction = 'in' and not m.historical and not m.auto_reply
                    order by m.created_at desc limit 1) as last_in_body
            from crm_campaign_leads cl
            join leads l on l.id = cl.lead_id
            where cl.campaign_id = ${campaignId} and cl.converted_at is null and l.archived_at is null
          )
          select * from base
          where ${
            bucket === 'replied'
              ? tx`in_count > 0`
              : bucket === 'uncontacted'
                ? tx`out_count = 0 and in_count = 0 and not paused and not unsubscribed`
                : bucket === 'awaiting'
                  ? tx`out_count > 0 and in_count = 0 and not paused and not unsubscribed and last_out_at > now() - interval '72 hours'`
                  : tx`unsubscribed or (out_count > 0 and in_count = 0 and (last_out_at is null or last_out_at <= now() - interval '72 hours'))`
          }
          order by coalesce(last_in_at, last_out_at) desc nulls last
          limit ${limit}
        `;
        return {
          bucket,
          leads: rows.map((r) => ({
            ref: ctx.alias(LEAD, r.id),
            name: r.name,
            business: r.business_name,
            city: r.city,
            segment: r.segment,
            state: r.state,
            origin: r.origin,
            outCount: r.out_count,
            inCount: r.in_count,
            paused: r.paused,
            unsubscribed: r.unsubscribed,
            lastReplyExcerpt: r.last_in_body?.slice(0, 220) ?? null,
          })),
        } as unknown as Json;
      });
    }),
});

export const launchHuntTool = defineTool<
  {
    query: string;
    segment?: string | undefined;
    city?: string | undefined;
    target?: number | undefined;
    angle?: string | undefined;
    reason: string;
  },
  Sql
>({
  name: 'launch_hunt',
  description:
    'Dispatch one `crm-discovery` hunt to find fresh prospects for this campaign. Enforces hard caps (budget, expiry, daily hunt limit, no concurrent hunt, no duplicate query+city). Pass a crisp `angle` so discovered leads receive a tailored first-contact opener.',
  effect: 'write',
  input: s.object({
    query: s.string({ min: 3, max: 300 }),
    segment: s.string({ max: 120 }).optional(),
    city: s.string({ max: 120 }).optional(),
    target: s.int({ min: 1, max: 20 }).optional(),
    angle: s
      .string({ max: 300 })
      .describe('short natural messaging angle for the first contact of leads found by this hunt')
      .optional(),
    reason: s.string({ min: 3, max: 300 }),
  }),
  run: (ctx: Ctx, input) =>
    refusals(() => {
      const campaignId = campaignOf(ctx);
      return crm(ctx, async (tx) => {
        const res = await launchCampaignHuntTx(tx, {
          campaignId,
          query: input.query,
          segment: input.segment ?? null,
          city: input.city ?? null,
          target: input.target ?? 10,
          angle: input.angle ?? null,
          turnId: ctx.turnId,
        });
        if (!res.ok)
          return { blocked: true, code: res.code, reason: res.reason } as unknown as Json;
        return {
          launched: true,
          huntId: res.huntId,
          query: input.query,
          city: input.city ?? null,
          segment: input.segment ?? null,
          target: input.target ?? 10,
          next: 'descoberta iniciada — você será acordado automaticamente quando ela terminar',
        } as unknown as Json;
      });
    }),
});

export const activateExistingLeadsTool = defineTool<
  {
    leads?: string[] | undefined;
    count?: number | undefined;
    angle?: string | undefined;
    reason: string;
  },
  Sql
>({
  name: 'activate_existing_leads',
  description:
    'Enroll and start first contact on untouched existing CRM leads (free — no discovery cost!). Pass specific lead refs from `list_campaign_leads(bucket="untouched_pool")`, or omit `leads` to pick the top `count` (1–8) qualified untouched leads automatically. Respects daily cold WhatsApp/Instagram budgets.',
  effect: 'write',
  input: s.object({
    leads: s.array(s.string({ min: 1, max: 20 }), { max: 8 }).optional(),
    count: s.int({ min: 1, max: 8 }).optional(),
    angle: s.string({ max: 300 }).optional(),
    reason: s.string({ min: 3, max: 300 }),
  }),
  run: (ctx: Ctx, input) =>
    refusals(() => {
      const campaignId = campaignOf(ctx);
      return crm(ctx, async (tx) => {
        const [camp] = await tx<{ status: string; allow_existing_leads: boolean }[]>`
          select status, allow_existing_leads from crm_campaigns where id = ${campaignId} for update
        `;
        if (!camp || camp.status !== 'active') {
          return { blocked: true, reason: 'campanha não está ativa' } as unknown as Json;
        }
        if (!camp.allow_existing_leads) {
          return {
            blocked: true,
            reason: 'esta campanha está configurada para não reativar leads existentes',
          } as unknown as Json;
        }

        const rawG = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
        const g: Guardrails = { ...DEFAULT_GUARDRAILS, ...rawG };
        const [waReady, igReady, emailReady] = [
          await whatsappReadyTx(tx),
          g.instagramColdDmsPerDay > 0 && (await instagramReadyTx(tx)),
          await emailReadyTx(tx),
        ];
        const waBudget = waReady
          ? await whatsappColdBudgetTx(tx, g)
          : { cap: 0, used: 0, remaining: 0 as number | null, nextSlotAt: null };
        let waSlots = waBudget.remaining === null ? Infinity : waBudget.remaining;
        const igBudget = igReady
          ? await instagramColdBudgetTx(tx, g)
          : { remaining: 0, nextSlotAt: null };
        let igSlots = igBudget.remaining;

        const wantCount = Math.min(8, Math.max(1, input.count ?? input.leads?.length ?? 5));
        const resolvedIds = input.leads?.length
          ? input.leads.map((ref) => ctx.resolve(ref, LEAD))
          : null;

        const candidates = await tx<
          {
            id: string;
            name: string;
            whatsapp: string | null;
            whatsapp_verified: boolean;
            instagram: string | null;
            email: string | null;
            email_bounced_at: string | null;
          }[]
        >`
          select l.id, l.name, l.whatsapp, l.whatsapp_verified, l.instagram, l.email, l.email_bounced_at
          from leads l
          where l.state = 'lead'
            and l.archived_at is null and l.unsubscribed_at is null
            and l.agent_paused_at is null and l.tenant_id is null
            and l.agent_mode <> 'off'
            ${resolvedIds ? tx`and l.id = any(${resolvedIds}::uuid[])` : tx``}
            and not exists (
              select 1 from crm_campaign_leads cl
              where cl.campaign_id = ${campaignId} and cl.lead_id = l.id
            )
            and not exists (
              select 1 from lead_messages m join lead_threads t on t.id = m.thread_id
              where t.lead_id = l.id and m.direction in ('out', 'in')
            )
          order by l.fit_score desc nulls last, l.intent_score desc nulls last, l.created_at desc
          limit ${wantCount * 2}
        `;

        const activated: { ref: string; name: string; channel: string }[] = [];
        for (const cand of candidates) {
          if (activated.length >= wantCount) break;
          let chan: 'whatsapp' | 'instagram' | 'email' | null = null;
          if (waReady && waSlots > 0 && cand.whatsapp && cand.whatsapp_verified) chan = 'whatsapp';
          else if (igReady && igSlots > 0 && instagramHandle(cand.instagram)) chan = 'instagram';
          else if (emailReady && cand.email && !cand.email_bounced_at) chan = 'email';
          else if (waReady && waSlots > 0 && cand.whatsapp) chan = 'whatsapp';
          if (!chan) continue;

          const focus = [
            'primeiro contato iniciado pelo modo campanha.',
            input.angle ? `Ângulo: ${input.angle.trim()}.` : '',
            'Use no máximo 1 detalhe natural do lead pra abrir conversa leve, sem ficha corrida nem link.',
          ]
            .filter(Boolean)
            .join(' ');

          const r = await requestLeadTx(tx, {
            leadId: cand.id,
            kind: 'lead.first_contact',
            source: `campaign:${campaignId}`,
            dedupeKey: `crm:campaign:${campaignId}:activate:${cand.id}`,
            payload: {
              channel: chan,
              campaignId,
              focus,
            } as JsonObject,
          });
          if (!r.mailboxId) continue;

          await enrollCampaignLeadTx(tx, {
            campaignId,
            leadId: cand.id,
            origin: 'revived',
            note: input.reason.slice(0, 400),
          });
          if (chan === 'whatsapp' && Number.isFinite(waSlots)) waSlots--;
          if (chan === 'instagram') igSlots--;
          activated.push({ ref: ctx.alias(LEAD, cand.id), name: cand.name, channel: chan });
          emitAfter(ctx, 'run.update', r.mailboxId);
        }

        if (!activated.length) {
          return {
            blocked: true,
            reason:
              'nenhum lead intocado elegível com canal/cota diária disponível agora (verifique cota fria ou lance uma busca)',
          } as unknown as Json;
        }
        return { activatedCount: activated.length, activated } as unknown as Json;
      });
    }),
});

export const coachLeadTool = defineTool<
  { lead: string; guidance: string; kind?: 'reply' | 'outreach' | undefined },
  Sql
>({
  name: 'coach_lead',
  description:
    'Send focused tactical guidance to `crm-agent` on one lead enrolled in this campaign (e.g. a sharp follow-up angle or next step). Always respects lead opt-out, staff pause, unanswered caps, and quiet hours.',
  effect: 'write',
  input: s.object({
    lead: s.string({ min: 1, max: 20 }).describe('lead alias from list_campaign_leads, e.g. l2'),
    guidance: s.string({ min: 3, max: 1000 }),
    kind: s.enum(['reply', 'outreach']).optional(),
  }),
  run: (ctx: Ctx, input) =>
    refusals(() => {
      const campaignId = campaignOf(ctx);
      const leadId = ctx.resolve(input.lead, LEAD);
      return crm(ctx, async (tx) => {
        const [member] = await tx<
          {
            name: string;
            archived_at: Date | null;
            unsubscribed_at: Date | null;
            agent_paused_at: Date | null;
            agent_mode: string;
            tenant_id: string | null;
          }[]
        >`
          select l.name, l.archived_at, l.unsubscribed_at, l.agent_paused_at, l.agent_mode, l.tenant_id
          from crm_campaign_leads cl
          join leads l on l.id = cl.lead_id
          where cl.campaign_id = ${campaignId} and cl.lead_id = ${leadId}
        `;
        if (!member) {
          throw new ToolError(`${input.lead} não faz parte desta campanha`);
        }
        if (member.tenant_id)
          return { blocked: true, reason: 'lead já virou loja' } as unknown as Json;
        if (
          member.archived_at ||
          member.unsubscribed_at ||
          member.agent_paused_at ||
          member.agent_mode === 'off'
        ) {
          return {
            blocked: true,
            reason: 'lead arquivado, descadastrado ou pausado/desligado para o agente',
          } as unknown as Json;
        }
        const [thread] = await tx<{ id: string; channel: string }[]>`
          select id, channel from lead_threads where lead_id = ${leadId}
          order by last_message_at desc nulls last, created_at desc limit 1
        `;
        const jobKind = input.kind ?? (thread ? 'reply' : 'outreach');
        await tx`
          insert into lead_activities (lead_id, kind, body, meta, created_by)
          values (${leadId}, 'note', ${`[direção de campanha] ${input.guidance.trim()}`},
                  ${tx.json({ source: 'campaign', campaignId } as never)}, 'agent')
        `;
        const d = await requestLeadTx(tx, {
          leadId,
          kind: jobKind === 'reply' ? 'timer.followup' : 'lead.first_contact',
          source: `campaign:${campaignId}`,
          dedupeKey: `crm:campaign:${campaignId}:coach:${leadId}:${ctx.turnId}:${randomUUID().slice(0, 8)}`,
          payload: {
            kind: jobKind,
            campaignId,
            focus: input.guidance.trim(),
            ...(thread ? { threadId: thread.id, channel: thread.channel } : {}),
          } as JsonObject,
        });
        if (!d.mailboxId) {
          return {
            blocked: true,
            reason: d.parked ?? 'não foi possível acordar o agente neste lead',
          } as unknown as Json;
        }
        emitAfter(ctx, 'run.update', d.mailboxId);
        return {
          queued: true,
          lead: input.lead,
          leadName: member.name,
          deliverAt: d.deliverAt?.toISOString() ?? null,
        } as unknown as Json;
      });
    }),
});

export const updatePlaybookTool = defineTool<{ playbook: string }, Sql>({
  name: 'update_playbook',
  description:
    'Save your updated campaign strategy memo (tested niches/cities, reply signals, current hypothesis, what to try next if this batch cools off). Persists across days.',
  effect: 'write',
  input: s.object({
    playbook: s.string({ min: 5, max: 4000 }),
  }),
  run: (ctx: Ctx, input) =>
    refusals(() => {
      const campaignId = campaignOf(ctx);
      return crm(ctx, async (tx) => {
        await tx`
          update crm_campaigns set playbook = ${input.playbook.trim().slice(0, 4000)}, updated_at = now()
          where id = ${campaignId}
        `;
        return { saved: true, chars: input.playbook.trim().length } as unknown as Json;
      });
    }),
});

export const reportProgressTool = defineTool<
  { message: string; urgent?: boolean | undefined },
  Sql
>({
  name: 'report_progress',
  description:
    'Update the campaign’s living Telegram card with a crisp progress summary for the founder (1–3 short lines). Non-urgent updates are rate-limited to once every 4 hours so Telegram stays clean.',
  effect: 'write',
  input: s.object({
    message: s.string({ min: 5, max: 600 }),
    urgent: s.boolean().optional(),
  }),
  run: (ctx: Ctx, input) =>
    refusals(() => {
      const campaignId = campaignOf(ctx);
      return crm(ctx, async (tx) => {
        const sc = await campaignMetricsTx(tx, campaignId);
        if (!sc) throw new ToolError('campanha não encontrada');
        const lastAt = sc.campaign.last_progress_report_at
          ? new Date(sc.campaign.last_progress_report_at).getTime()
          : 0;
        const cooldown = input.urgent ? URGENT_REPORT_COOLDOWN_MS : REPORT_COOLDOWN_MS;
        if (lastAt > 0 && Date.now() - lastAt < cooldown) {
          return {
            skipped: true,
            reason: 'atualização recente já enviada ao Telegram — evite excesso de avisos',
          } as unknown as Json;
        }
        await tx`
          update crm_campaigns set last_progress_report_at = now(), updated_at = now()
          where id = ${campaignId}
        `;
        await recordStaffEventTx(tx, 'campaign.progress', {
          campaignId,
          title: sc.campaign.title,
          goalKind: sc.campaign.goal_kind,
          goalTarget: sc.campaign.goal_target,
          goalProgress: sc.campaign.goal_progress,
          spentCents: sc.spentCents,
          budgetCents: sc.campaign.budget_cents,
          hunts: sc.huntsTotal,
          leads: sc.wip.enrolledTotal,
          activeWip: sc.wip.activeWip,
          replies: sc.wip.activeConversations,
          summary: input.message.trim().slice(0, 600),
          urgent: Boolean(input.urgent),
        });
        return { reported: true } as unknown as Json;
      });
    }),
});

export const scheduleNextCheckTool = defineTool<{ waitMinutes: number; reason: string }, Sql>({
  name: 'schedule_next_check',
  description:
    'Schedule the next campaign director check-in timer (30 to 1440 minutes). Automatically shifts past quiet hours. Use this when active WIP is healthy or waiting on human replies/daily caps.',
  effect: 'write',
  input: s.object({
    waitMinutes: s.int({ min: 30, max: 1440 }),
    reason: s.string({ min: 3, max: 300 }),
  }),
  run: (ctx: Ctx, input) =>
    refusals(() => {
      const campaignId = campaignOf(ctx);
      return crm(ctx, async (tx) => {
        const [cur] = await tx<{ status: string }[]>`
          select status from crm_campaigns where id = ${campaignId} for update
        `;
        if (!cur || cur.status !== 'active') {
          return {
            blocked: true,
            reason: `campanha não está ativa (${cur?.status ?? 'ausente'})`,
          } as unknown as Json;
        }
        const at = new Date(Date.now() + input.waitMinutes * 60_000);
        const { deliverAt } = await scheduleCampaignTickTx(tx, {
          campaignId,
          at,
          reason: input.reason,
          source: 'campaign:director',
          dedupeSuffix: `${ctx.turnId}:${randomUUID().slice(0, 8)}`,
        });
        return {
          scheduled: true,
          nextCheckAt: deliverAt.toISOString(),
          reason: input.reason,
        } as unknown as Json;
      });
    }),
});

export const pauseCampaignTool = defineTool<{ reason: string }, Sql>({
  name: 'pause_campaign',
  description:
    'Pause this campaign and alert the team on Telegram when blocked by something requiring a human decision (e.g. too many drafts piling up in copilot/supervised mode, repeated zero-traction niches needing direction, or broken prerequisites).',
  effect: 'write',
  input: s.object({
    reason: s.string({ min: 5, max: 350 }),
  }),
  run: (ctx: Ctx, input) =>
    refusals(() => {
      const campaignId = campaignOf(ctx);
      return crm(ctx, async (tx) => {
        const [cur] = await tx<{ status: string }[]>`
          select status from crm_campaigns where id = ${campaignId} for update
        `;
        if (!cur || cur.status !== 'active') {
          return {
            blocked: true,
            reason: `campanha não está ativa (${cur?.status ?? 'ausente'})`,
          } as unknown as Json;
        }
        const sc = await campaignMetricsTx(tx, campaignId);
        if (!sc) throw new ToolError('campanha não encontrada');
        const reason = input.reason.trim().slice(0, 350);
        await dropCampaignTicksTx(tx, campaignId);
        await tx`
          update crm_campaigns
          set status = 'paused', stop_reason = ${reason}, next_tick_at = null, updated_at = now()
          where id = ${campaignId} and status = 'active'
        `;
        await recordStaffEventTx(tx, 'campaign.updated', {
          campaignId,
          title: sc.campaign.title,
          status: 'paused',
          goalKind: sc.campaign.goal_kind,
          goalTarget: sc.campaign.goal_target,
          goalProgress: sc.campaign.goal_progress,
          spentCents: sc.spentCents,
          budgetCents: sc.campaign.budget_cents,
          hunts: sc.huntsTotal,
          leads: sc.wip.enrolledTotal,
          reason,
          by: null,
        });
        return { paused: true, reason } as unknown as Json;
      });
    }),
});

export const CAMPAIGN_TOOLS = [
  listCampaignLeadsTool,
  launchHuntTool,
  activateExistingLeadsTool,
  coachLeadTool,
  updatePlaybookTool,
  reportProgressTool,
  scheduleNextCheckTool,
  pauseCampaignTool,
];
