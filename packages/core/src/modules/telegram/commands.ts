import { createHash } from 'node:crypto';
import type { Sql } from '../../platform/db.ts';
import { UUID_RE } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import { PLATFORM_TENANT_ID } from '../../platform/tenancy.ts';
import { forgetSubjectTx } from '../../agent-host/forget.ts';
import { CRM_MANAGER_SUBJECT } from '../../agent-host/agents/crm-manager/shared.ts';
import {
  AGENT_JOBS,
  AUTONOMY_LEVELS,
  agentSettingTx,
  type AgentJob,
  type AutonomyLevel,
} from '../../crm/policy.ts';
import { claimControl, controlTx } from '../control.ts';
import { getSettingTx } from '../integrations.ts';
import { linkedTelegramMembers, normalizeStaff, type StaffMember } from '../staff-config.ts';
import { staffConfigTx } from '../staff.ts';
import { CATEGORY_META, STAFF_CATEGORIES, type StaffCategory } from '../staff-events.ts';
import {
  crmLink,
  mutedUntil,
  updateTelegramState,
  updateTelegramStateTx,
  type TelegramContext,
} from './config.ts';
import { computeDigest } from './digest.ts';
import {
  actionButton,
  b,
  brl,
  cb,
  clip,
  esc,
  i,
  int,
  label,
  link,
  linkButton,
  mono,
  quote,
  row,
  ts,
  usd,
  type InlineButton,
  type TelegramMessage,
} from './format.ts';
import { teachRule } from './manager-ops.ts';
import { digestCard } from './render.ts';
import { TelegramError, type TelegramClient } from './rest.ts';
import {
  leadSnapshot,
  onboardingSteps,
  searchLeads,
  searchStores,
  storeSnapshot,
} from './snapshot.ts';

// Bot slash commands (ADR 0047). Registered in private chats via setMyCommands whenever the list
// or bot changes; interactive pickers (/lead, /loja, /silenciar, /agente) use inline buttons.

const clog = log.child({ mod: 'telegram' });

export const MUTE_CHOICES = [
  { name: '30 min', minutes: 30 },
  { name: '1 hora', minutes: 60 },
  { name: '2 horas', minutes: 120 },
  { name: '4 horas', minutes: 240 },
  { name: '8 horas', minutes: 480 },
  { name: '24 horas', minutes: 1440 },
  { name: '🔔 reativar agora', minutes: 0 },
] as const;

export const COMMANDS = [
  { command: 'agente', description: 'painel do agente de vendas: autonomia, rotinas e regras' },
  { command: 'pendencias', description: 'rascunhos e handoffs esperando você' },
  { command: 'hoje', description: 'o dia até agora: leads, pedidos, pendências e incidentes' },
  { command: 'ensinar', description: 'gravar uma regra permanente para o agente de vendas' },
  { command: 'memoria', description: 'ver e gerenciar as regras na memória do agente' },
  { command: 'lead', description: 'ficha de um lead (/lead busca ou recentes)' },
  { command: 'loja', description: 'ficha de uma loja (/loja busca ou recentes)' },
  { command: 'frota', description: 'lojas no ar, sondas e incidentes abertos' },
  { command: 'resumo', description: 'o resumo das últimas 24 horas, agora' },
  { command: 'silenciar', description: 'silenciar uma categoria por um tempo' },
  { command: 'nova', description: 'começar uma nova conversa com o gerente de vendas' },
  { command: 'bot', description: 'fila, último erro e equipe conectada' },
  { command: 'ajuda', description: 'como gerenciar e orientar o agente por aqui' },
] as const;

export function commandsHash(ctx: TelegramContext): string | null {
  if (!ctx.app.ok) return null;
  return createHash('sha256')
    .update(JSON.stringify([COMMANDS, ctx.app.app.botId]))
    .digest('hex')
    .slice(0, 16);
}

/** Registers the bot's private-chat commands when the set changed. Never throws. */
export async function ensureCommands(
  sql: Sql,
  ctx: TelegramContext,
  client: TelegramClient,
  force = false,
): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.app.ok) return { ok: false, error: ctx.app.reason };
  const hash = commandsHash(ctx)!;
  if (!force && ctx.state.commands?.hash === hash) return { ok: true };
  const lastFail = ctx.state.commandsError ? Date.parse(ctx.state.commandsError.at) : 0;
  if (!force && Date.now() - lastFail < 10 * 60_000) return { ok: false, error: 'aguardando' };
  try {
    await client.call('setMyCommands', {
      commands: COMMANDS,
      scope: { type: 'all_private_chats' },
    });
    const at = new Date().toISOString();
    ctx.state = await updateTelegramState(sql, () => ({
      commands: { hash, at },
      commandsError: null,
    }));
    return { ok: true };
  } catch (e) {
    if (e instanceof TelegramError && e.rateLimited) return { ok: false, error: 'rate limited' };
    const message = e instanceof Error ? e.message : String(e);
    clog.warn({ err: e }, 'telegram command registration failed');
    ctx.state = await updateTelegramState(sql, () => ({
      commandsError: { at: new Date().toISOString(), message: message.slice(0, 300) },
    })).catch(() => ctx.state);
    return { ok: false, error: message };
  }
}

export interface CommandCtx {
  sql: Sql;
  ctx: TelegramContext;
  staffName: string;
  userId: string;
  chatId: string;
  /** Unique id for idempotent mutations (Telegram update_id or callback_query.id) */
  actionKey: string;
}

const crm = (c: Pick<CommandCtx, 'ctx'>, path: string) => crmLink(c.ctx.crmBase, path);

async function staffTz(sql: Sql): Promise<string> {
  return controlTx(sql, async (tx) => {
    const g = await getSettingTx<{ timezone?: string }>(tx, 'guardrails', {});
    return g.timezone ?? 'America/Sao_Paulo';
  });
}

type N = { n: number };

export interface TelegramUserInfo {
  id: string;
  firstName?: string | undefined;
  lastName?: string | undefined;
  username?: string | undefined;
}

/** Atomically consumes a one-tap /start link token and saves the user's Telegram id on Equipe. */
export async function consumeLinkToken(
  sql: Sql,
  token: string,
  user: TelegramUserInfo,
): Promise<{ ok: true; name: string } | { ok: false; reason: 'invalid' | 'full' }> {
  return controlTx(sql, async (tx) => {
    let matched: {
      memberIndex?: number | null;
      memberEmail?: string | null;
      memberWhatsapp?: string | null;
      memberName?: string | null;
    } | null = null;
    const now = Date.now();
    await updateTelegramStateTx(tx, (s) => {
      const live = s.linkTokens.filter((t) => new Date(t.expiresAt).getTime() > now);
      const hit = live.find((t) => t.token === token);
      if (hit) matched = hit;
      return { linkTokens: live.filter((t) => t.token !== token) };
    });
    if (!matched) return { ok: false, reason: 'invalid' };
    const target = matched as {
      memberIndex?: number | null;
      memberEmail?: string | null;
      memberWhatsapp?: string | null;
      memberName?: string | null;
    };

    const staff = await staffConfigTx(tx);
    const members: StaffMember[] = staff.members.map((m) => ({ ...m }));
    const cleanUser = user.username?.replace(/^@/, '').trim();
    const displayName =
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      (cleanUser ? `@${cleanUser}` : 'equipe');

    // already linked on a row: refresh username and succeed
    const existingIdx = members.findIndex((m) => m.telegram === user.id);
    if (existingIdx !== -1) {
      const cur = members[existingIdx]!;
      members[existingIdx] = {
        ...cur,
        ...(cleanUser ? { telegramUsername: cleanUser } : {}),
      };
      const normalized = normalizeStaff({ members });
      await tx`
        insert into control_settings (key, value) values ('staff', ${tx.json(normalized as never)})
        on conflict (key) do update set value = excluded.value
      `;
      return { ok: true, name: cur.name || cur.email || displayName };
    }

    // match targeted Equipe row (by email / whatsapp / index / name)
    let idx = -1;
    if (target.memberEmail)
      idx = members.findIndex((m) => m.email && m.email === target.memberEmail);
    if (idx === -1 && target.memberWhatsapp)
      idx = members.findIndex((m) => m.whatsapp && m.whatsapp === target.memberWhatsapp);
    if (
      idx === -1 &&
      typeof target.memberIndex === 'number' &&
      target.memberIndex >= 0 &&
      target.memberIndex < members.length &&
      !members[target.memberIndex]!.telegram
    ) {
      idx = target.memberIndex;
    }
    if (idx === -1 && target.memberName)
      idx = members.findIndex(
        (m) => !m.telegram && m.name.toLowerCase() === target.memberName!.toLowerCase(),
      );

    let name: string;
    if (idx !== -1) {
      const cur = members[idx]!;
      members[idx] = {
        ...cur,
        name: cur.name || displayName,
        telegram: user.id,
        ...(cleanUser ? { telegramUsername: cleanUser } : {}),
      };
      name = members[idx]!.name || members[idx]!.email || displayName;
    } else {
      if (members.length >= 20) return { ok: false, reason: 'full' };
      members.push({
        name: displayName.slice(0, 80),
        email: '',
        whatsapp: '',
        telegram: user.id,
        ...(cleanUser ? { telegramUsername: cleanUser } : {}),
      });
      name = displayName;
    }

    const normalized = normalizeStaff({ members });
    await tx`
      insert into control_settings (key, value) values ('staff', ${tx.json(normalized as never)})
      on conflict (key) do update set value = excluded.value
    `;
    return { ok: true, name };
  });
}

async function hoje(c: CommandCtx): Promise<TelegramMessage> {
  const tz = await staffTz(c.sql);
  const r = await controlTx(c.sql, async (tx) => {
    const start = tx`(date_trunc('day', now() at time zone ${tz}) at time zone ${tz})`;
    const one = async (q: Promise<N[]>) => (await q)[0]?.n ?? 0;
    const [
      leads,
      replies,
      drafts,
      tasks,
      runs,
      meetings,
      orders,
      stores,
      paid,
      errors,
      incidents,
      failing,
    ] = await Promise.all([
      one(tx<N[]>`select count(*)::int as n from leads where created_at >= ${start}`),
      one(tx<N[]>`
        select count(*)::int as n from lead_messages
        where direction = 'in' and created_at >= ${start}
      `),
      one(tx<N[]>`select count(*)::int as n from lead_messages where status = 'draft'`),
      one(tx<N[]>`
        select count(*)::int as n from lead_tasks where done_at is null and title like '[humano]%'
      `),
      tx<{ n: number; cents: number; failed: number }[]>`
        select count(*)::int as n, coalesce(sum(cost_cents), 0)::int as cents,
               count(*) filter (where status = 'failed')::int as failed
        from crm_turns where finished_at >= ${start}
      `,
      tx<{ starts_at: Date; name: string }[]>`
        select m.starts_at, l.name from meetings m join leads l on l.id = m.lead_id
        where m.status = 'scheduled' and m.starts_at >= ${start}
          and m.starts_at < ${start} + interval '1 day'
        order by m.starts_at limit 6
      `,
      tx<{ n: number; cents: number; first: string[] }[]>`
        select count(*) filter (where kind = 'order.placed')::int as n,
               coalesce(sum((data->>'totalCents')::bigint) filter (where kind = 'order.placed'), 0)::bigint as cents,
               coalesce(array_agg(data->>'storeName') filter (where kind = 'store.first_order'), '{}') as first
        from staff_events
        where kind in ('order.placed', 'store.first_order') and created_at >= ${start}
      `,
      one(tx<N[]>`
        select count(*)::int as n from staff_events
        where kind = 'store.created' and created_at >= ${start}
      `),
      one(tx<N[]>`
        select count(*)::int as n from staff_events
        where kind = 'billing.paid' and created_at >= ${start}
      `),
      one(tx<N[]>`
        select coalesce(sum((data->>'count')::int), 0)::int as n from staff_events
        where kind = 'system.error' and created_at >= ${start}
      `),
      tx<{ summary: string; severity: string }[]>`
        select summary, severity from fleet_incidents where resolved_at is null
        order by (severity = 'critical') desc, opened_at desc limit 4
      `,
      tx<{ name: string }[]>`select name from scheduled_jobs where failing_since is not null`,
    ]);
    return {
      leads,
      replies,
      drafts,
      tasks,
      runs: runs[0]!,
      meetings,
      orders: orders[0]!,
      stores,
      paid,
      errors,
      incidents,
      failing,
    };
  });
  const o = r.orders;
  const sections = [
    [
      b('🙋 esperando a equipe'),
      `rascunhos: ${b(int(r.drafts))} · handoffs abertos: ${b(int(r.tasks))}`,
    ].join('\n'),
    [b('💬 crm'), `leads novos: ${b(int(r.leads))} · respostas: ${b(int(r.replies))}`].join('\n'),
    [
      b('🤖 agente'),
      `runs: ${b(int(r.runs.n))} · ${usd(r.runs.cents)}${r.runs.failed ? ` · ⚠️ ${int(r.runs.failed)} falharam` : ''}`,
    ].join('\n'),
    [
      b('📅 calls de hoje'),
      r.meetings.length
        ? r.meetings.map((m) => `${ts(m.starts_at, 't', tz)} · ${esc(m.name)}`).join('\n')
        : '—',
    ].join('\n'),
    [
      b('🛍️ vendas'),
      `pedidos: ${b(int(Number(o.n)))} · ${b(brl(Number(o.cents)))}`,
      o.first?.length ? `🎉 primeiro pedido: ${o.first.map(esc).join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    [
      b('🧾 assinaturas'),
      `lojas novas: ${b(int(r.stores))} · faturas pagas: ${b(int(r.paid))}`,
    ].join('\n'),
    [
      b('🚀 frota e sistema'),
      r.incidents.length
        ? r.incidents
            .map((x) => `${x.severity === 'critical' ? '🔴' : '🟠'} ${esc(clip(x.summary, 80))}`)
            .join('\n')
        : 'sem incidentes abertos',
      r.errors ? `erros 500: ${int(r.errors)}` : null,
      r.failing.length
        ? `⚠️ rotinas falhando: ${r.failing.map((f) => esc(f.name)).join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n'),
  ];
  return {
    text: [`📊 ${b('hoje na Venduá')}`, '', sections.join('\n\n')].join('\n'),
    buttons: row(linkButton('abrir o CRM', crm(c, '/'))),
  };
}

export async function pendingView(c: CommandCtx): Promise<TelegramMessage> {
  const p = await controlTx(c.sql, async (tx) => {
    const [drafts, draftCount, handoffs, help, manual] = await Promise.all([
      tx<
        {
          id: string;
          body: string;
          created_at: Date;
          author: string;
          channel: string;
          thread_id: string;
          name: string;
        }[]
      >`
        select m.id, m.body, m.created_at, m.author, t.channel, t.id as thread_id, l.name
        from lead_messages m join lead_threads t on t.id = m.thread_id join leads l on l.id = t.lead_id
        where m.status = 'draft'
        order by m.created_at limit 8
      `,
      tx<N[]>`select count(*)::int as n from lead_messages where status = 'draft'`,
      tx<{ id: string; title: string; created_at: Date; lead_id: string; name: string }[]>`
        select k.id, k.title, k.created_at, l.id as lead_id, l.name
        from lead_tasks k join leads l on l.id = k.lead_id
        where k.done_at is null and k.title like '[humano]%'
        order by k.created_at limit 8
      `,
      tx<{ store: string; at: Date }[]>`
        select data->>'storeName' as store, created_at as at from staff_events
        where kind = 'merchant.help' and created_at > now() - interval '48 hours'
        order by id desc limit 5
      `,
      tx<{ store: string; cents: number }[]>`
        select e.data->>'storeName' as store, (e.data->>'amountCents')::int as cents
        from staff_events e
        join invoices i on i.id::text = e.data->>'invoiceId' and i.status = 'open'
        where e.kind = 'billing.manual'
        order by e.id desc limit 5
      `,
    ]);
    return { drafts, draftCount: draftCount[0]?.n ?? 0, handoffs, help, manual };
  });

  const sections: string[] = [
    [
      b(`✍️ rascunhos esperando aprovação (${int(p.draftCount)})`),
      p.drafts.length
        ? p.drafts
            .map(
              (d) =>
                `• ${b(esc(d.name))} · ${label('channel', d.channel)} · ${ts(d.created_at, 'R')}${d.author === 'agent' ? '' : ' · equipe'}\n  ${c.ctx.setting.excerpts ? esc(clip(d.body.replace(/\s+/g, ' '), 90)) : i('oculto')}`,
            )
            .join('\n')
        : 'nenhum 🎉',
    ].join('\n'),
    [
      b(`🙋 handoffs abertos (${int(p.handoffs.length)})`),
      p.handoffs.length
        ? p.handoffs
            .map(
              (h) =>
                `• ${link(esc(h.name), crm(c, `/pipeline/${h.lead_id}`))} · ${esc(clip(h.title.replace(/^\[humano\]\s*/, ''), 80))} · ${ts(h.created_at, 'R')}`,
            )
            .join('\n')
        : 'nenhum',
    ].join('\n'),
  ];
  if (p.help.length) {
    sections.push(
      [
        b('🆘 pedidos de ajuda (48h)'),
        ...p.help.map((h) => `• ${esc(h.store)} · ${ts(h.at, 'R')}`),
      ].join('\n'),
    );
  }
  if (p.manual.length) {
    sections.push(
      [
        b('🧾 faturas esperando baixa'),
        ...p.manual.map((m) => `• ${esc(m.store)} · ${brl(m.cents)}`),
      ].join('\n'),
    );
  }

  const buttons: InlineButton[][] = p.drafts
    .slice(0, 4)
    .flatMap((d) =>
      row(
        actionButton(`✅ aprovar · ${clip(d.name, 26)}`, `dp:a:${d.id}`, 'success'),
        actionButton('✕ rejeitar', `dp:r:${d.id}`, 'danger'),
      ),
    );
  buttons.push(
    ...row(
      linkButton('inbox de rascunhos', crm(c, '/inbox?f=rascunhos')),
      linkButton('lojas e planos', crm(c, '/lojas/planos')),
    ),
  );
  return {
    text: [`⏳ ${b('pendências da equipe')}`, '', sections.join('\n\n')].join('\n'),
    buttons,
  };
}

export async function renderLeadCard(
  c: CommandCtx,
  leadId: string,
): Promise<TelegramMessage | null> {
  const l = await leadSnapshot(c.sql, leadId);
  if (!l) return null;
  const thread = l.threads[0];
  const convo = l.last
    .map(
      (m) =>
        `${m.direction === 'in' ? '⬅️' : '➡️'} ${ts(m.at, 'R')} · ${label('channel', m.channel)}\n${quote(c.ctx.setting.excerpts ? clip(m.body.replace(/\s+/g, ' '), 180) : 'oculto', 200, 3)}`,
    )
    .join('\n');
  const agent = l.unsubscribed
    ? '⛔ pediu para sair'
    : l.paused
      ? '⏸️ pausado (handoff)'
      : `${l.agentMode === 'off' ? 'desligado' : l.agentMode === 'draft' ? 'rascunhos' : 'automático'}${l.threads.some((t) => !t.agentEnabled) ? ' · algum canal pausado' : ''}`;
  const title = `${esc(l.name)}${l.business && l.business !== l.name ? ` · ${esc(l.business)}` : ''}`;
  const meta = [
    `estado: ${b(label('leadState', l.state))} · dono: ${esc(l.owner) || '—'}`,
    `agente: ${agent} · custo: ${usd(l.costCents)}`,
    l.nextActionAt ? `próximo contato: ${ts(l.nextActionAt, 'f')}` : null,
    l.nextMeeting ? `próxima call: ${ts(l.nextMeeting, 'F')}` : null,
    l.openHumanTasks ? `handoffs abertos: ${l.openHumanTasks}` : null,
    l.city || l.segment
      ? `perfil: ${[l.segment, l.city].filter(Boolean).map(esc).join(' · ')}`
      : null,
  ].filter(Boolean);
  return {
    text: [
      `💬 ${b(title)}`,
      '',
      meta.join('\n'),
      '',
      convo || i('sem mensagens ainda'),
      '',
      i(`no funil desde ${new Date(l.createdAt).toLocaleDateString('pt-BR')}`),
    ].join('\n'),
    buttons: [
      ...row(
        !l.unsubscribed && actionButton('🤖 guiar agente', `g:l:${l.id}`, 'primary'),
        !l.unsubscribed &&
          (l.paused
            ? actionButton('▶️ retomar agente', `lp:r:${l.id}`, 'success')
            : actionButton('⏸ pausar agente', `lp:p:${l.id}`)),
      ),
      ...row(
        !l.unsubscribed &&
          (l.agentMode === 'draft'
            ? actionButton('⚡ modo automático', `lm:a:${l.id}`)
            : actionButton('📝 só rascunho', `lm:d:${l.id}`)),
        linkButton('abrir lead', crm(c, `/pipeline/${l.id}`)),
        thread ? linkButton('abrir conversa', crm(c, `/inbox/${thread.id}`)) : null,
      ),
    ],
  };
}

async function lead(c: CommandCtx, arg: string): Promise<TelegramMessage> {
  const q = arg.trim();
  if (UUID_RE.test(q)) {
    const card = await renderLeadCard(c, q);
    return card ?? { text: `nenhum lead encontrado para “${esc(clip(q, 60))}”` };
  }
  const hits = await searchLeads(c.sql, q, 6);
  if (!hits.length) {
    return {
      text: q
        ? `nenhum lead encontrado para “${esc(clip(q, 60))}”`
        : 'nenhum lead ativo encontrado ainda.',
    };
  }
  if (hits.length === 1 || (q && hits[0]!.name.toLowerCase() === q.toLowerCase())) {
    const card = await renderLeadCard(c, hits[0]!.id);
    if (card) return card;
  }
  return {
    text: q
      ? `💬 ${b(`leads encontrados para “${esc(clip(q, 40))}”`)} — toque para abrir:`
      : `💬 ${b('leads recentes')} — toque para abrir (ou use ${mono('/lead busca')}):`,
    buttons: hits.map((h) => [
      actionButton(
        `${clip(h.name, 30)}${h.business_name && h.business_name !== h.name ? ` · ${clip(h.business_name, 18)}` : ''} (${label('leadState', h.state)})`,
        `l:${h.id}`,
      ),
    ]),
  };
}

export async function renderStoreCard(
  c: CommandCtx,
  storeId: string,
): Promise<TelegramMessage | null> {
  const s = await storeSnapshot(c.sql, storeId);
  if (!s) return null;
  const steps = onboardingSteps(s);
  const url = s.host ? `https://${s.host}` : null;
  const probe = !s.probe
    ? 'sem sonda'
    : s.probe.status === 'failing'
      ? `🔴 falhando desde ${ts(s.probe.failingSince, 't')}`
      : s.probe.status === 'ok'
        ? `🟢 ok (${ts(s.probe.lastOkAt, 'R')})`
        : 'ainda não checada';
  const meta = [
    `plano: ${s.plan ? `${esc(s.plan)} · ${s.subscription ?? '—'}${s.openInvoices ? ` · ${s.openInvoices} fatura(s) aberta(s)` : ''}` : '—'}`,
    `pedidos: hoje ${b(int(s.orders.today))} (${brl(s.orders.todayCents)}) · 7d ${b(int(s.orders.week))} (${brl(s.orders.weekCents)})`,
    `último pedido: ${s.orders.lastAt ? ts(s.orders.lastAt, 'R') : '—'}`,
    `release: ${s.release ? `${mono(s.release.slice(0, 8))}${s.kernel ? ` · kernel ${esc(s.kernel)}` : ''}${s.policy === 'pinned' ? ' · 📌 fixada' : ''}` : '—'}`,
    `sonda: ${probe} · incidentes: ${s.openIncidents}`,
    `Mercado Pago: ${s.payments ?? 'não conectado'} · painel: ${s.merchants} pessoa(s)`,
  ];
  return {
    text: [
      `🏪 ${b(esc(s.name))}`,
      '',
      steps.map((x) => `${x.done ? '✅' : '⬜'} ${esc(x.label)}`).join('\n'),
      '',
      meta.join('\n'),
      '',
      i(`${esc(s.slug)} · criada em ${new Date(s.createdAt).toLocaleDateString('pt-BR')}`),
    ].join('\n'),
    buttons: row(linkButton('ver loja', url), linkButton('loja no CRM', crm(c, `/lojas/${s.id}`))),
  };
}

async function loja(c: CommandCtx, arg: string): Promise<TelegramMessage> {
  const q = arg.trim();
  if (UUID_RE.test(q)) {
    const card = await renderStoreCard(c, q);
    return card ?? { text: `nenhuma loja encontrada para “${esc(clip(q, 60))}”` };
  }
  const hits = await searchStores(c.sql, q, 6);
  if (!hits.length) {
    return {
      text: q
        ? `nenhuma loja encontrada para “${esc(clip(q, 60))}”`
        : 'nenhuma loja cadastrada ainda.',
    };
  }
  if (hits.length === 1 || (q && hits[0]!.slug.toLowerCase() === q.toLowerCase())) {
    const card = await renderStoreCard(c, hits[0]!.id);
    if (card) return card;
  }
  return {
    text: q
      ? `🏪 ${b(`lojas encontradas para “${esc(clip(q, 40))}”`)} — toque para abrir:`
      : `🏪 ${b('lojas recentes')} — toque para abrir (ou use ${mono('/loja busca')}):`,
    buttons: hits.map((h) => [
      actionButton(`${clip(h.name, 36)} (${clip(h.slug, 18)})`, `s:${h.id}`),
    ]),
  };
}

export async function frotaView(c: CommandCtx): Promise<TelegramMessage> {
  const f = await controlTx(c.sql, async (tx) => {
    const [ops, pending, failing, incidents, releases, provisioning] = await Promise.all([
      tx<{ live: number; pinned: number; total: number }[]>`
        select count(*) filter (where live_release_id is not null)::int as live,
               count(*) filter (where release_policy = 'pinned')::int as pinned,
               count(*)::int as total
        from storefront_ops
      `,
      tx<N[]>`select count(*)::int as n from deployments where status = 'pending'`,
      tx<N[]>`select count(*)::int as n from fleet_probes where status = 'failing'`,
      tx<
        {
          id: string;
          kind: string;
          severity: string;
          summary: string;
          opened_at: Date;
          acked_at: Date | null;
          name: string | null;
        }[]
      >`
        select i.id, i.kind, i.severity, i.summary, i.opened_at, i.acked_at, t.name
        from fleet_incidents i left join tenants t on t.id = i.tenant_id
        where i.resolved_at is null
        order by (i.severity = 'critical') desc, i.opened_at desc limit 5
      `,
      tx<{ id: string; bundle: string; kernel_version: string; published_at: Date }[]>`
        select id, bundle, kernel_version, published_at from releases
        order by published_at desc limit 3
      `,
      tx<{ state: string; n: number }[]>`
        select state, count(*)::int as n from provisionings where state <> 'live' group by state
      `,
    ]);
    return {
      ops: ops[0]!,
      pending: pending[0]?.n ?? 0,
      failing: failing[0]?.n ?? 0,
      incidents,
      releases,
      provisioning,
    };
  });
  const buttons: InlineButton[][] = f.incidents
    .filter((inc) => !inc.acked_at)
    .slice(0, 4)
    .flatMap((inc) =>
      row(
        actionButton(
          `👀 reconhecer · ${clip(inc.name ?? label('incident', inc.kind), 24)}`,
          `if:a:${inc.id}`,
          'primary',
        ),
        actionButton('✅ resolver', `if:r:${inc.id}`, 'success'),
      ),
    );
  buttons.push(...row(linkButton('frota no CRM', crm(c, '/lojas/frota'))));
  const sections = [
    `lojas no ar: ${b(int(f.ops.live))} de ${int(f.ops.total)} · fixadas: ${int(f.ops.pinned)}`,
    `implantações pendentes: ${int(f.pending)} · sondas falhando: ${int(f.failing)}`,
    f.provisioning.length
      ? `provisionando: ${f.provisioning.map((p) => `${p.state}: ${p.n}`).join(' · ')}`
      : null,
    '',
    b(`incidentes abertos (${f.incidents.length})`),
    f.incidents.length
      ? f.incidents
          .map(
            (inc) =>
              `${inc.severity === 'critical' ? '🔴' : '🟠'} ${esc(clip(inc.summary, 90))} · ${ts(inc.opened_at, 'R')}${inc.acked_at ? ' · 👀' : ''}`,
          )
          .join('\n')
      : 'nenhum 🎉',
    '',
    b('últimos releases'),
    f.releases.length
      ? f.releases
          .map(
            (r) =>
              `${mono(r.id.slice(0, 8))} ${esc(r.bundle)} · kernel ${esc(r.kernel_version)} · ${ts(r.published_at, 'R')}`,
          )
          .join('\n')
      : '—',
  ].filter((x) => x !== null);
  return {
    text: [`🚀 ${b('frota')}`, '', sections.join('\n')].join('\n'),
    buttons,
  };
}

async function resumo(c: CommandCtx): Promise<TelegramMessage> {
  const tz = await staffTz(c.sql);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const report = await computeDigest(c.sql, date);
  return digestCard(
    {
      id: 0,
      kind: 'digest.daily',
      tenant_id: null,
      severity: 'info',
      anchor: null,
      data: report,
      created_at: new Date(),
    },
    report,
    { crm: (p) => crm(c, p) },
  );
}

export function muteCategoryPicker(): TelegramMessage {
  const catButtons: InlineButton[][] = [[actionButton('🔕 todas as categorias', 'mc:todas')]];
  for (let idx = 0; idx < STAFF_CATEGORIES.length; idx += 2) {
    const pair = STAFF_CATEGORIES.slice(idx, idx + 2).map((k) =>
      actionButton(`${CATEGORY_META[k].emoji} ${k}`, `mc:${k}`),
    );
    catButtons.push(pair);
  }
  return {
    text: `🔕 ${b('silenciar avisos')}\nos avisos continuam chegando, só sem notificar. Qual categoria?`,
    buttons: catButtons,
  };
}

export function muteDurationPicker(category: string): TelegramMessage {
  const what =
    category === 'todas'
      ? 'todas as categorias'
      : `${CATEGORY_META[category as StaffCategory].emoji} ${category}`;
  const buttons: InlineButton[][] = [];
  const timed = MUTE_CHOICES.filter((m) => m.minutes > 0);
  for (let idx = 0; idx < timed.length; idx += 3) {
    buttons.push(
      timed.slice(idx, idx + 3).map((m) => actionButton(m.name, `m:${category}:${m.minutes}`)),
    );
  }
  buttons.push([actionButton('🔔 reativar agora', `m:${category}:0`, 'success')]);
  return {
    text: `🔕 ${b(`silenciar ${what}`)} — por quanto tempo?`,
    buttons,
  };
}

export async function applyMute(
  c: CommandCtx,
  cat: string,
  minutes: number,
): Promise<TelegramMessage> {
  const cats: StaffCategory[] =
    cat === 'todas'
      ? [...STAFF_CATEGORIES]
      : (STAFF_CATEGORIES as readonly string[]).includes(cat)
        ? [cat as StaffCategory]
        : [];
  if (!cats.length || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440)
    return { text: 'categoria ou tempo inválido — use /silenciar para escolher nos botões.' };
  const { body } = await claimControl(c.sql, `telegram:${c.actionKey}`, async (tx) => {
    const at = minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
    await updateTelegramStateTx(tx, (s) => {
      const mutes = { ...s.mutes };
      for (const k of cats) {
        if (at) mutes[k] = at;
        else delete mutes[k];
      }
      return { mutes };
    });
    return { status: 200, body: { until: at } };
  });
  const until = body.until;
  const what =
    cat === 'todas' ? 'todas as categorias' : `${CATEGORY_META[cats[0]!].emoji} ${cats[0]}`;
  return {
    text: until
      ? `🔕 ${esc(c.staffName)} silenciou ${what} até ${ts(until, 't')} — os avisos continuam chegando, sem notificar.`
      : `🔔 ${esc(c.staffName)} reativou ${what}.`,
  };
}

async function silenciar(c: CommandCtx, arg: string): Promise<TelegramMessage> {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return muteCategoryPicker();
  const cat = parts[0]!.toLowerCase();
  if (cat !== 'todas' && !(STAFF_CATEGORIES as readonly string[]).includes(cat)) {
    return muteCategoryPicker();
  }
  if (parts.length === 1) return muteDurationPicker(cat);
  const raw = parts[1]!.toLowerCase();
  const minutes =
    raw === '0' || raw === 'off' || raw === 'reativar'
      ? 0
      : /^\d+h$/.test(raw)
        ? Number(raw.slice(0, -1)) * 60
        : /^\d+m?$/.test(raw)
          ? Number(raw.replace(/m$/, ''))
          : NaN;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
    return muteDurationPicker(cat);
  }
  return applyMute(c, cat, minutes);
}

async function botStatus(c: CommandCtx): Promise<TelegramMessage> {
  const [q, team] = await controlTx(c.sql, (tx) =>
    Promise.all([
      tx<
        { pending: number; failed: number; sent: number; last: Date | null; oldest: Date | null }[]
      >`
        select count(*) filter (where state = 'pending')::int as pending,
               count(*) filter (where state = 'failed' and created_at > now() - interval '24 hours')::int as failed,
               count(*) filter (where state = 'sent' and delivered_at > now() - interval '24 hours')::int as sent,
               max(delivered_at) as last,
               min(created_at) filter (where state = 'pending') as oldest
        from staff_events
      `,
      staffConfigTx(tx),
    ]),
  );
  const s = q[0]!;
  const st = c.ctx.state;
  const linked = linkedTelegramMembers(team);
  const muted = STAFF_CATEGORIES.filter((k) => mutedUntil(st, k)).map(
    (k) => `• ${CATEGORY_META[k].emoji} ${k} até ${ts(st.mutes[k], 't')}`,
  );
  const lines = [
    `🤖 ${b('o bot da Venduá')}`,
    '',
    `você: ${b(esc(c.staffName))} · ${mono(c.userId)}`,
    `equipe recebendo DMs: ${b(`${linked.length} de ${team.members.length}`)}`,
    `enviados (24h): ${b(int(s.sent))} · na fila: ${b(int(s.pending))}${s.oldest ? ` (mais antigo ${ts(s.oldest, 'R')})` : ''}`,
    `falharam (24h): ${b(int(s.failed))} · último envio: ${s.last ? ts(s.last, 'R') : '—'}`,
    `comandos: ${st.commandsError ? `⚠️ ${esc(clip(st.commandsError.message, 150))}` : st.commands ? `registrados ${ts(st.commands.at, 'R')}` : '—'}`,
  ];
  if (muted.length) lines.push('', b('silenciados'), ...muted);
  if (st.lastError) {
    lines.push(
      '',
      b('último erro'),
      `${esc(clip(st.lastError.message, 300))} · ${ts(st.lastError.at, 'R')}`,
    );
  }
  return {
    text: lines.join('\n'),
    buttons: row(linkButton('configurar no CRM', crm(c, '/config?a=telegram'))),
  };
}

const AUTONOMY_SHORT: Record<AutonomyLevel, string> = {
  off: 'desligado',
  copilot: 'copiloto',
  supervised: 'supervisionado',
  autopilot: 'piloto auto',
};

export async function agenteView(c: CommandCtx): Promise<TelegramMessage> {
  const tz = await staffTz(c.sql);
  const data = await controlTx(c.sql, async (tx) => {
    const start = tx`(date_trunc('day', now() at time zone ${tz}) at time zone ${tz})`;
    const [agent, runs, drafts, handoffs, paused, rules, briefs] = await Promise.all([
      agentSettingTx(tx),
      tx<{ total: number; failed: number; cost: number }[]>`
        select count(*)::int as total,
               count(*) filter (where status = 'failed')::int as failed,
               coalesce(sum(cost_cents), 0)::int as cost
        from crm_turns where started_at >= ${start}
      `,
      tx<N[]>`select count(*)::int as n from lead_messages where status = 'draft'`,
      tx<
        N[]
      >`select count(*)::int as n from lead_tasks where done_at is null and title like '[humano]%'`,
      tx<
        N[]
      >`select count(*)::int as n from leads where agent_paused_at is not null and archived_at is null`,
      tx<
        N[]
      >`select count(*)::int as n from agent_memory_items where scope in ('workspace', 'segment')`.catch(
        () => [{ n: 0 }],
      ),
      tx<N[]>`select count(*)::int as n from discovery_briefs where enabled`.catch(() => [
        { n: 0 },
      ]),
    ]);
    return {
      agent,
      runs: runs[0] ?? { total: 0, failed: 0, cost: 0 },
      drafts: drafts[0]?.n ?? 0,
      handoffs: handoffs[0]?.n ?? 0,
      paused: paused[0]?.n ?? 0,
      rules: rules[0]?.n ?? 0,
      briefs: briefs[0]?.n ?? 0,
    };
  });

  const jobLine = AGENT_JOBS.map(
    (j) => `${data.agent.jobs[j] ? '🟢' : '⚪'} ${label('agentJob', j)}`,
  ).join(' · ');

  const levelRow = AUTONOMY_LEVELS.map((lvl) =>
    actionButton(
      `${data.agent.level === lvl ? '● ' : ''}${AUTONOMY_SHORT[lvl]}`,
      `al:${lvl}`,
      data.agent.level === lvl ? 'primary' : undefined,
    ),
  );
  const jobRow1 = AGENT_JOBS.slice(0, 2).map((j) =>
    actionButton(`${data.agent.jobs[j] ? '🟢' : '⚪'} ${label('agentJob', j)}`, `aj:${j}`),
  );
  const jobRow2 = AGENT_JOBS.slice(2).map((j) =>
    actionButton(`${data.agent.jobs[j] ? '🟢' : '⚪'} ${label('agentJob', j)}`, `aj:${j}`),
  );

  return {
    text: [
      `🎯 ${b('agente de vendas da Venduá')}`,
      '',
      `autonomia: ${b(label('autonomy', data.agent.level))}`,
      `rotinas: ${jobLine}`,
      `hoje: ${b(int(data.runs.total))} runs${data.runs.failed ? ` (${data.runs.failed} falharam)` : ''} · gasto ${b(usd(data.runs.cost))}`,
      `fila: ${b(int(data.drafts))} rascunhos · ${b(int(data.handoffs))} handoffs · ${b(int(data.paused))} leads pausados`,
      `memória: ${b(int(data.rules))} regras · ${b(int(data.briefs))} briefs ativos`,
      '',
      i('dica: pode mandar texto ou áudio livre aqui para perguntar ou orientar o agente.'),
    ].join('\n'),
    buttons: [
      levelRow.slice(0, 2),
      levelRow.slice(2),
      jobRow1,
      jobRow2,
      ...row(
        actionButton('🧠 ensinar regra', 'ag:t', 'primary'),
        actionButton('📋 regras', 'ag:m'),
        actionButton('🔎 revisar funil', 'ag:s'),
      ),
      ...row(linkButton('abrir estúdio no CRM', crm(c, '/agente/estudio'))),
    ],
  };
}

export async function memoriaView(c: CommandCtx): Promise<TelegramMessage> {
  const items = await controlTx(
    c.sql,
    (tx) => tx<
      { id: string; scope: string; segment: string | null; content: string; pinned: boolean }[]
    >`
      select id, scope, segment, content, pinned
      from agent_memory_items
      where scope in ('workspace', 'segment')
      order by pinned desc, updated_at desc limit 12
    `,
  ).catch(() => []);

  const lines = items.length
    ? items.map(
        (m, idx) =>
          `${idx + 1}. ${m.pinned ? '📌 ' : ''}${m.segment ? `[${esc(m.segment)}] ` : ''}${esc(clip(m.content, 160))}`,
      )
    : ['nenhuma regra salva na memória ainda.'];

  const delButtons: InlineButton[][] = items
    .slice(0, 5)
    .flatMap((m, idx) =>
      row(actionButton(`🗑 apagar #${idx + 1}: ${clip(m.content, 28)}`, `md:${m.id}`, 'danger')),
    );

  return {
    text: [
      `🧠 ${b('regras na memória do agente')}`,
      '',
      ...lines,
      '',
      i(
        `use ${mono('/ensinar <regra>')} ou ${mono('/ensinar #segmento <regra>')} para gravar uma nova.`,
      ),
    ].join('\n'),
    buttons: [
      ...row(
        actionButton('🧠 ensinar regra', 'ag:t', 'primary'),
        actionButton('⬅️ painel do agente', 'ag:b'),
      ),
      ...delButtons,
    ],
  };
}

export async function ensinarCmd(c: CommandCtx, arg: string): Promise<TelegramMessage> {
  const raw = arg.trim();
  if (!raw) {
    return {
      text: [
        `🧠 ${b('ensinar regra ao agente de vendas')}`,
        'mande a regra direto com o comando, por exemplo:',
        `${mono('/ensinar nunca ofereça mais de 14 dias grátis sem perguntar')}`,
        `${mono('/ensinar #docerias destaque o cardápio de encomendas')}`,
        '',
        'ou toque no botão abaixo para responder em texto ou áudio:',
      ].join('\n'),
      buttons: row(actionButton('🧠 escrever regra agora', 'ag:t', 'primary')),
    };
  }
  const segMatch = /^#([a-z0-9_-]{2,40})\s+([\s\S]+)$/i.exec(raw);
  const segment = segMatch ? segMatch[1]!.toLowerCase() : null;
  const content = segMatch ? segMatch[2]!.trim() : raw;
  const saved = await teachRule(c.sql, {
    content,
    ...(segment ? { segment } : {}),
    idemKey: `telegram:${c.actionKey}:ensinar`,
  });
  return {
    text: [
      `📌 ${b('regra gravada na memória do agente')}${saved.segment ? ` (${esc(saved.segment)})` : ''}`,
      quote(saved.content, 500),
      i('todo turno futuro do agente de vendas passa a seguir essa orientação.'),
    ].join('\n'),
    buttons: row(
      actionButton('🗑 desfazer', `md:${saved.id}`, 'danger'),
      actionButton('📋 ver regras', 'ag:m'),
    ),
  };
}

async function novaCmd(c: CommandCtx): Promise<TelegramMessage> {
  await controlTx(c.sql, (tx) =>
    forgetSubjectTx(
      tx,
      PLATFORM_TENANT_ID,
      { kind: CRM_MANAGER_SUBJECT, id: c.chatId },
      `${CRM_MANAGER_SUBJECT}:${c.chatId}`,
    ),
  );
  return {
    text: `✨ ${b('nova conversa iniciada')} — o histórico anterior deste chat foi limpo. Regras salvas, leads e configurações continuam intactos.`,
  };
}

export function ajudaView(c: Pick<CommandCtx, 'ctx'>): TelegramMessage {
  return {
    text: [
      `🤖 ${b('como gerenciar o agente de vendas por aqui')}`,
      '',
      `${b('conversa livre (texto ou áudio)')}: mande qualquer pergunta ou pedido direto na DM — ex.: "como tá o funil hoje?", "pausa o agente na Padaria Sol", "ensina pra nunca dar desconto sem perguntar".`,
      '',
      `${b('responder direto nos cartões')}:`,
      '• responda um cartão de <b>handoff</b> (texto ou áudio) → o agente recebe sua resposta, despausa o lead e responde ao cliente.',
      '• responda um cartão de <b>rascunho</b> → o agente reescreve com o seu ajuste e manda de volta pra aprovar.',
      '• responda um cartão de <b>lead</b> → envia sua orientação direto pro agente agir naquele lead.',
      '',
      b('comandos rápidos'),
      `${mono('/agente')} — autonomia, rotinas, regras e revisão do funil`,
      `${mono('/ensinar')} — fixar uma regra permanente na memória do agente`,
      `${mono('/memoria')} — ver ou apagar regras salvas`,
      `${mono('/pendencias')} — aprovar rascunhos e ver handoffs`,
      `${mono('/hoje')} — o dia até agora`,
      `${mono('/lead')} e ${mono('/loja')} — ficha com controles do agente`,
      `${mono('/frota')} · ${mono('/resumo')} · ${mono('/silenciar')} · ${mono('/nova')} · ${mono('/bot')}`,
    ].join('\n'),
    buttons: row(
      linkButton('Estúdio do agente', crm(c, '/agente/estudio')),
      linkButton('Config → Telegram', crm(c, '/config?a=telegram')),
    ),
  };
}

export async function runCommand(
  c: CommandCtx,
  name: string,
  arg: string,
): Promise<TelegramMessage> {
  switch (name) {
    case 'start':
      return {
        text: `👋 Olá, ${b(esc(c.staffName))}! Seu Telegram já está conectado à Venduá.\n\nPode conversar em texto ou áudio comigo para acompanhar e orientar o agente de vendas, ou usar ${mono('/agente')}, ${mono('/pendencias')} e ${mono('/hoje')}.`,
        buttons: row(linkButton('abrir o CRM', crm(c, '/'))),
      };
    case 'agente':
      return agenteView(c);
    case 'ensinar':
      return ensinarCmd(c, arg);
    case 'memoria':
      return memoriaView(c);
    case 'nova':
      return novaCmd(c);
    case 'hoje':
      return hoje(c);
    case 'pendencias':
      return pendingView(c);
    case 'lead':
      return lead(c, arg);
    case 'loja':
      return loja(c, arg);
    case 'frota':
      return frotaView(c);
    case 'resumo':
      return resumo(c);
    case 'silenciar':
      return silenciar(c, arg);
    case 'bot':
      return botStatus(c);
    case 'ajuda':
    case 'help':
      return ajudaView(c);
    default:
      return { text: `não conheço o comando /${esc(clip(name, 32))} — tente /ajuda` };
  }
}
