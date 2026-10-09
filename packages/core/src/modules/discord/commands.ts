import { createHash } from 'node:crypto';
import type { Sql } from '../../platform/db.ts';
import { UUID_RE } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import { claimControl, controlTx } from '../control.ts';
import { getSettingTx } from '../integrations.ts';
import { CATEGORY_META, STAFF_CATEGORIES, type StaffCategory } from '../staff-events.ts';
import {
  channelFor,
  artLink,
  crmLink,
  mutedUntil,
  updateDiscordState,
  updateDiscordStateTx,
  type DiscordContext,
} from './config.ts';
import { computeDigest } from './digest.ts';
import {
  COLORS,
  FLAG_EPHEMERAL,
  actionButton,
  brl,
  clip,
  esc,
  fitMessage,
  int,
  label,
  linkButton,
  row,
  ts,
  usd,
  type ActionRow,
  type Embed,
  type MessagePayload,
} from './format.ts';
import { cid, digestCard } from './render.ts';
import { DiscordError, type DiscordClient } from './rest.ts';
import {
  leadSnapshot,
  onboardingSteps,
  searchLeads,
  searchStores,
  storeSnapshot,
} from './snapshot.ts';

// Slash commands (ADR 0023). Registered per guild (instant) whenever their definition, the
// application or the guild changes; answered within Discord's 3 s budget, ephemeral by default.

const clog = log.child({ mod: 'discord' });

const MUTE_CHOICES = [
  { name: '30 minutos', value: 30 },
  { name: '1 hora', value: 60 },
  { name: '2 horas', value: 120 },
  { name: '4 horas', value: 240 },
  { name: '8 horas', value: 480 },
  { name: '24 horas', value: 1440 },
  { name: 'reativar agora', value: 0 },
];

const guildOnly = { contexts: [0], integration_types: [0] };

export const COMMANDS = [
  {
    name: 'hoje',
    description: 'o dia até agora: leads, pedidos, pendências e incidentes',
    ...guildOnly,
  },
  {
    name: 'pendencias',
    description: 'o que está esperando alguém da equipe — aprove rascunhos daqui mesmo',
    ...guildOnly,
  },
  {
    name: 'lead',
    description: 'ficha de um lead: estado, conversa, agente, próxima call',
    options: [
      {
        type: 3,
        name: 'busca',
        description: 'nome, empresa, telefone ou email',
        required: true,
        autocomplete: true,
        max_length: 100,
      },
    ],
    ...guildOnly,
  },
  {
    name: 'loja',
    description: 'ficha de uma loja: plano, onboarding, release, sonda e pedidos',
    options: [
      {
        type: 3,
        name: 'busca',
        description: 'nome ou slug da loja',
        required: true,
        autocomplete: true,
        max_length: 100,
      },
    ],
    ...guildOnly,
  },
  {
    name: 'frota',
    description: 'lojas no ar, implantações, sondas e incidentes abertos',
    ...guildOnly,
  },
  {
    name: 'resumo',
    description: 'o resumo das últimas 24 horas, agora',
    options: [
      {
        type: 5,
        name: 'publicar',
        description: 'postar no canal para todos (padrão: só você vê)',
      },
    ],
    ...guildOnly,
  },
  {
    name: 'silenciar',
    description: 'avisos de uma categoria chegam sem notificar por um tempo',
    options: [
      {
        type: 3,
        name: 'categoria',
        description: 'qual categoria',
        required: true,
        choices: [
          { name: 'todas', value: 'todas' },
          ...STAFF_CATEGORIES.map((c) => ({ name: `${CATEGORY_META[c].emoji} ${c}`, value: c })),
        ],
      },
      {
        type: 4,
        name: 'tempo',
        description: 'por quanto tempo',
        required: true,
        choices: MUTE_CHOICES,
      },
    ],
    ...guildOnly,
  },
  {
    name: 'bot',
    description: 'como o bot está: fila, último erro, canais e o seu vínculo',
    ...guildOnly,
  },
  { name: 'ajuda', description: 'o que o bot faz e como usar', ...guildOnly },
];

export function commandsHash(ctx: DiscordContext): string | null {
  if (!ctx.app.ok) return null;
  return createHash('sha256')
    .update(JSON.stringify([COMMANDS, ctx.app.app.applicationId, ctx.app.app.guildId]))
    .digest('hex')
    .slice(0, 16);
}

/** Bulk-overwrites the guild's commands when the set changed. Never throws. */
export async function ensureCommands(
  sql: Sql,
  ctx: DiscordContext,
  client: DiscordClient,
  force = false,
): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.app.ok) return { ok: false, error: ctx.app.reason };
  const hash = commandsHash(ctx)!;
  if (!force && ctx.state.commands?.hash === hash) return { ok: true };
  const lastFail = ctx.state.commandsError ? Date.parse(ctx.state.commandsError.at) : 0;
  if (!force && Date.now() - lastFail < 10 * 60_000) return { ok: false, error: 'aguardando' };
  const { applicationId, guildId } = ctx.app.app;
  try {
    await client.request(
      'PUT',
      `/applications/${applicationId}/guilds/${guildId}/commands`,
      COMMANDS,
    );
    const at = new Date().toISOString();
    ctx.state = await updateDiscordState(sql, () => ({
      commands: { hash, at },
      commandsError: null,
    }));
    return { ok: true };
  } catch (e) {
    if (e instanceof DiscordError && e.rateLimited) return { ok: false, error: 'rate limited' };
    const message = e instanceof Error ? e.message : String(e);
    clog.warn({ err: e }, 'discord command registration failed');
    ctx.state = await updateDiscordState(sql, () => ({
      commandsError: { at: new Date().toISOString(), message: message.slice(0, 300) },
    })).catch(() => ctx.state);
    return { ok: false, error: message };
  }
}

export interface InteractionResponse {
  type: number;
  data?: unknown;
}

export const ephemeral = (m: MessagePayload): InteractionResponse => ({
  type: 4,
  data: fitMessage({
    allowed_mentions: { parse: [] },
    ...m,
    flags: (m.flags ?? 0) | FLAG_EPHEMERAL,
  }),
});

export const say = (content: string) => ephemeral({ content });

const embedOf = (e: Embed): MessagePayload => ({ embeds: [e] });

export interface CommandCtx {
  sql: Sql;
  ctx: DiscordContext;
  staffName: string;
  userId: string;
  /** Discord's id for this interaction — the idempotency key of anything it changes */
  interactionId: string;
}

interface Opt {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
}

const optValue = (opts: Opt[] | undefined, name: string) =>
  opts?.find((o) => o.name === name)?.value;
const crm = (c: CommandCtx, path: string) => crmLink(c.ctx.crmBase, path);

async function staffTz(sql: Sql): Promise<string> {
  return controlTx(sql, async (tx) => {
    const g = await getSettingTx<{ timezone?: string }>(tx, 'guardrails', {});
    return g.timezone ?? 'America/Sao_Paulo';
  });
}

type N = { n: number };

async function hoje(c: CommandCtx): Promise<InteractionResponse> {
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
      one(tx<N[]>`
          select count(*)::int as n from lead_messages where status = 'draft'
        `),
      one(tx<N[]>`
          select count(*)::int as n from lead_tasks where done_at is null and title like '[humano]%'
        `),
      tx<{ n: number; cents: number; failed: number }[]>`
          select count(*)::int as n, coalesce(sum(cost_cents), 0)::int as cents,
                 count(*) filter (where status = 'failed')::int as failed
          from agent_runs where created_at >= ${start}
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
  const lines = (xs: (string | null | false)[]) => xs.filter(Boolean).join('\n') || '—';
  return ephemeral(
    embedOf({
      title: 'hoje na Venduá',
      color: 0x5865f2,
      fields: [
        {
          name: '🙋 esperando a equipe',
          value: lines([
            `rascunhos: **${int(r.drafts)}**`,
            `handoffs abertos: **${int(r.tasks)}**`,
          ]),
          inline: true,
        },
        {
          name: '💬 crm',
          value: lines([`leads novos: **${int(r.leads)}**`, `respostas: **${int(r.replies)}**`]),
          inline: true,
        },
        {
          name: '🤖 agente',
          value: lines([
            `runs: **${int(r.runs.n)}** · ${usd(r.runs.cents)}`,
            r.runs.failed ? `⚠️ ${int(r.runs.failed)} falharam` : null,
          ]),
          inline: true,
        },
        {
          name: '📅 calls de hoje',
          value: lines(r.meetings.map((m) => `${ts(m.starts_at, 't')} · ${esc(m.name)}`)),
          inline: false,
        },
        {
          name: '🛍️ vendas',
          value: lines([
            `pedidos: **${int(Number(o.n))}** · **${brl(Number(o.cents))}**`,
            o.first?.length ? `🎉 primeiro pedido: ${o.first.map(esc).join(', ')}` : null,
          ]),
          inline: true,
        },
        {
          name: '🧾 assinaturas',
          value: lines([`lojas novas: **${int(r.stores)}**`, `faturas pagas: **${int(r.paid)}**`]),
          inline: true,
        },
        {
          name: '🚀 frota e sistema',
          value: lines([
            r.incidents.length
              ? r.incidents
                  .map(
                    (i) => `${i.severity === 'critical' ? '🔴' : '🟠'} ${esc(clip(i.summary, 80))}`,
                  )
                  .join('\n')
              : 'sem incidentes abertos',
            r.errors ? `erros 500: ${int(r.errors)}` : null,
            r.failing.length
              ? `⚠️ rotinas falhando: ${r.failing.map((f) => esc(f.name)).join(', ')}`
              : null,
          ]),
          inline: false,
        },
      ],
    }),
  );
}

export async function pendingView(c: CommandCtx): Promise<MessagePayload> {
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
  const fieldsOut: Embed['fields'] = [];
  fieldsOut.push({
    name: `✍️ rascunhos esperando aprovação (${int(p.draftCount)})`,
    value: p.drafts.length
      ? p.drafts
          .map(
            (d) =>
              `• **${esc(d.name)}** · ${label('channel', d.channel)} · ${ts(d.created_at, 'R')}${d.author === 'agent' ? '' : ' · rascunho da equipe'}\n  ${c.ctx.setting.excerpts ? esc(clip(d.body.replace(/\s+/g, ' '), 90)) : '_oculto_'}`,
          )
          .join('\n')
      : 'nenhum 🎉',
  });
  fieldsOut.push({
    name: `🙋 handoffs abertos (${int(p.handoffs.length)})`,
    value: p.handoffs.length
      ? p.handoffs
          .map(
            (h) =>
              `• [${esc(h.name)}](${crm(c, `/pipeline/${h.lead_id}`)}) · ${esc(clip(h.title.replace(/^\[humano\]\s*/, ''), 80))} · ${ts(h.created_at, 'R')}`,
          )
          .join('\n')
      : 'nenhum',
  });
  if (p.help.length)
    fieldsOut.push({
      name: '🆘 pedidos de ajuda (48h)',
      value: p.help.map((h) => `• ${esc(h.store)} · ${ts(h.at, 'R')}`).join('\n'),
    });
  if (p.manual.length)
    fieldsOut.push({
      name: '🧾 faturas esperando baixa',
      value: p.manual.map((m) => `• ${esc(m.store)} · ${brl(m.cents)}`).join('\n'),
    });
  const rows: ActionRow[] = p.drafts
    .slice(0, 4)
    .flatMap((d) =>
      row(
        actionButton(`aprovar · ${clip(d.name, 40)}`, cid('draft', 'approve', d.id), 3, '✅'),
        actionButton('rejeitar', cid('draft', 'reject', d.id), 4),
        linkButton('abrir', crm(c, `/inbox/${d.thread_id}`)),
      ),
    );
  rows.push(
    ...row(
      linkButton('inbox de rascunhos', crm(c, '/inbox?f=rascunhos')),
      linkButton('lojas e planos', crm(c, '/lojas/planos')),
    ),
  );
  return {
    embeds: [{ title: 'pendências da equipe', color: COLORS.warning, fields: fieldsOut }],
    components: rows.slice(0, 5),
  };
}

async function lead(c: CommandCtx, opts: Opt[] | undefined): Promise<InteractionResponse> {
  const q = String(optValue(opts, 'busca') ?? '').trim();
  const id = UUID_RE.test(q) ? q : (await searchLeads(c.sql, q, 1))[0]?.id;
  const l = id ? await leadSnapshot(c.sql, id) : null;
  if (!l) return say(`nenhum lead encontrado para “${esc(clip(q, 60))}”`);
  const thread = l.threads[0];
  const convo = l.last
    .map(
      (m) =>
        `${m.direction === 'in' ? '⬅️' : '➡️'} ${ts(m.at, 'R')} · ${label('channel', m.channel)}\n> ${c.ctx.setting.excerpts ? esc(clip(m.body.replace(/\s+/g, ' '), 180)) : '_oculto_'}`,
    )
    .join('\n');
  const agent = l.unsubscribed
    ? '⛔ pediu para sair'
    : l.paused
      ? '⏸️ pausado (handoff)'
      : `${l.agentMode === 'off' ? 'desligado' : l.agentMode === 'draft' ? 'rascunhos' : 'automático'}${l.threads.some((t) => !t.agentEnabled) ? ' · algum canal pausado' : ''}`;
  return ephemeral({
    embeds: [
      {
        title: `${esc(l.name)}${l.business && l.business !== l.name ? ` · ${esc(l.business)}` : ''}`,
        url: crm(c, `/pipeline/${l.id}`),
        color: l.state === 'live' ? COLORS.success : COLORS.info,
        description: convo || '_sem mensagens ainda_',
        fields: [
          { name: 'estado', value: label('leadState', l.state), inline: true },
          { name: 'dono', value: esc(l.owner) || '—', inline: true },
          { name: 'agente', value: agent, inline: true },
          {
            name: 'próximo contato',
            value: l.nextActionAt ? ts(l.nextActionAt, 'R') : '—',
            inline: true,
          },
          {
            name: 'próxima call',
            value: l.nextMeeting ? ts(l.nextMeeting, 'f') : '—',
            inline: true,
          },
          { name: 'custo do agente', value: usd(l.costCents), inline: true },
          ...(l.openHumanTasks
            ? [{ name: 'handoffs abertos', value: String(l.openHumanTasks), inline: true }]
            : []),
          ...(l.city || l.segment
            ? [
                {
                  name: 'perfil',
                  value: [l.segment, l.city]
                    .filter(Boolean)
                    .map((x) => esc(x))
                    .join(' · '),
                  inline: true,
                },
              ]
            : []),
        ],
        footer: { text: `no funil desde ${new Date(l.createdAt).toLocaleDateString('pt-BR')}` },
      },
    ],
    components: row(
      linkButton('abrir lead', crm(c, `/pipeline/${l.id}`)),
      thread ? linkButton('abrir conversa', crm(c, `/inbox/${thread.id}`)) : null,
    ),
  });
}

async function loja(c: CommandCtx, opts: Opt[] | undefined): Promise<InteractionResponse> {
  const q = String(optValue(opts, 'busca') ?? '').trim();
  const id = UUID_RE.test(q) ? q : (await searchStores(c.sql, q, 1))[0]?.id;
  const s = id ? await storeSnapshot(c.sql, id) : null;
  if (!s) return say(`nenhuma loja encontrada para “${esc(clip(q, 60))}”`);
  const steps = onboardingSteps(s);
  const url = s.host ? `https://${s.host}` : null;
  const probe = !s.probe
    ? 'sem sonda'
    : s.probe.status === 'failing'
      ? `🔴 falhando desde ${ts(s.probe.failingSince, 'R')}`
      : s.probe.status === 'ok'
        ? `🟢 ok ${ts(s.probe.lastOkAt, 'R')}`
        : 'ainda não checada';
  return ephemeral({
    embeds: [
      {
        title: esc(s.name),
        ...(url ? { url } : {}),
        color: s.openIncidents ? COLORS.warning : COLORS.info,
        description: steps.map((x) => `${x.done ? '✅' : '⬜'} ${x.label}`).join('\n'),
        fields: [
          {
            name: 'plano',
            value: s.plan
              ? `${esc(s.plan)} · ${s.subscription ?? '—'}${s.openInvoices ? ` · ${s.openInvoices} fatura(s) aberta(s)` : ''}`
              : '—',
            inline: true,
          },
          {
            name: 'pedidos',
            value: `hoje ${int(s.orders.today)} · ${brl(s.orders.todayCents)}\n7 dias ${int(s.orders.week)} · ${brl(s.orders.weekCents)}`,
            inline: true,
          },
          {
            name: 'último pedido',
            value: s.orders.lastAt ? ts(s.orders.lastAt, 'R') : '—',
            inline: true,
          },
          {
            name: 'release',
            value: s.release
              ? `${s.release.slice(0, 8)}${s.kernel ? ` · kernel ${esc(s.kernel)}` : ''}${s.policy === 'pinned' ? ' · 📌 fixada' : ''}`
              : '—',
            inline: true,
          },
          { name: 'sonda', value: probe, inline: true },
          { name: 'incidentes abertos', value: String(s.openIncidents), inline: true },
          { name: 'Mercado Pago', value: s.payments ?? 'não conectado', inline: true },
          { name: 'pessoas no painel', value: String(s.merchants), inline: true },
        ],
        footer: {
          text: `${s.slug} · criada em ${new Date(s.createdAt).toLocaleDateString('pt-BR')}`,
        },
      },
    ],
    components: row(linkButton('ver loja', url), linkButton('lojas no CRM', crm(c, '/lojas'))),
  });
}

async function frota(c: CommandCtx): Promise<InteractionResponse> {
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
  const rows: ActionRow[] = f.incidents
    .filter((i) => !i.acked_at)
    .slice(0, 4)
    .flatMap((i) =>
      row(
        actionButton(
          `reconhecer · ${clip(i.name ?? label('incident', i.kind), 40)}`,
          cid('incident', 'ack', i.id),
          2,
          '👀',
        ),
        actionButton('resolver', cid('incident', 'resolve', i.id), 3, '✅'),
      ),
    );
  rows.push(...row(linkButton('frota no CRM', crm(c, '/lojas/frota'))));
  return ephemeral({
    embeds: [
      {
        title: 'frota',
        url: crm(c, '/lojas/frota'),
        color: f.incidents.some((i) => i.severity === 'critical')
          ? COLORS.critical
          : f.incidents.length
            ? COLORS.warning
            : COLORS.success,
        fields: [
          {
            name: 'lojas no ar',
            value: `**${int(f.ops.live)}** de ${int(f.ops.total)}`,
            inline: true,
          },
          { name: 'fixadas', value: int(f.ops.pinned), inline: true },
          { name: 'implantações pendentes', value: int(f.pending), inline: true },
          { name: 'sondas falhando', value: int(f.failing), inline: true },
          {
            name: 'provisionando',
            value: f.provisioning.length
              ? f.provisioning.map((p) => `${p.state}: ${p.n}`).join(' · ')
              : 'nada',
            inline: true,
          },
          {
            name: `incidentes abertos (${f.incidents.length})`,
            value: f.incidents.length
              ? f.incidents
                  .map(
                    (i) =>
                      `${i.severity === 'critical' ? '🔴' : '🟠'} ${esc(clip(i.summary, 90))} · ${ts(i.opened_at, 'R')}${i.acked_at ? ' · 👀' : ''}`,
                  )
                  .join('\n')
              : 'nenhum 🎉',
            inline: false,
          },
          {
            name: 'últimos releases',
            value: f.releases.length
              ? f.releases
                  .map(
                    (r) =>
                      `\`${r.id.slice(0, 8)}\` ${esc(r.bundle)} · kernel ${esc(r.kernel_version)} · ${ts(r.published_at, 'R')}`,
                  )
                  .join('\n')
              : '—',
            inline: false,
          },
        ],
      },
    ],
    components: rows.slice(0, 5),
  });
}

async function resumo(c: CommandCtx, opts: Opt[] | undefined): Promise<InteractionResponse> {
  const tz = await staffTz(c.sql);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const report = await computeDigest(c.sql, date);
  const msg = digestCard(
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
    { crm: (p) => crm(c, p), art: (pose) => artLink(c.ctx.crmBase, pose) },
  );
  if (optValue(opts, 'publicar') === true)
    return { type: 4, data: fitMessage({ ...msg, allowed_mentions: { parse: [] } }) };
  return ephemeral(msg);
}

async function silenciar(c: CommandCtx, opts: Opt[] | undefined): Promise<InteractionResponse> {
  const cat = String(optValue(opts, 'categoria') ?? '');
  const minutes = Number(optValue(opts, 'tempo') ?? 0);
  const cats: StaffCategory[] =
    cat === 'todas'
      ? [...STAFF_CATEGORIES]
      : (STAFF_CATEGORIES as readonly string[]).includes(cat)
        ? [cat as StaffCategory]
        : [];
  if (!cats.length || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440)
    return say('categoria ou tempo inválido');
  // a replayed interaction answers with the stored mute instead of extending it
  const { body } = await claimControl(c.sql, `discord:${c.interactionId}`, async (tx) => {
    const at = minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
    await updateDiscordStateTx(tx, (s) => {
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
  // everyone should know the channel went quiet: a visible message, not an ephemeral one
  return {
    type: 4,
    data: {
      content: until
        ? `🔕 ${esc(c.staffName)} silenciou ${what} até ${ts(until, 't')} (${ts(until, 'R')}) — os avisos continuam chegando, sem notificar.`
        : `🔔 ${esc(c.staffName)} reativou ${what}.`,
      allowed_mentions: { parse: [] },
    },
  };
}

async function bot(c: CommandCtx): Promise<InteractionResponse> {
  const q = await controlTx(
    c.sql,
    (tx) => tx<
      { pending: number; failed: number; sent: number; last: Date | null; oldest: Date | null }[]
    >`
      select count(*) filter (where state = 'pending')::int as pending,
             count(*) filter (where state = 'failed' and created_at > now() - interval '24 hours')::int as failed,
             count(*) filter (where state = 'sent' and delivered_at > now() - interval '24 hours')::int as sent,
             max(delivered_at) as last,
             min(created_at) filter (where state = 'pending') as oldest
      from staff_events
    `,
  );
  const s = q[0]!;
  const st = c.ctx.state;
  const muted = STAFF_CATEGORIES.filter((k) => mutedUntil(st, k)).map(
    (k) => `${CATEGORY_META[k].emoji} ${k} até ${ts(st.mutes[k], 't')}`,
  );
  const routes = STAFF_CATEGORIES.map((k) => {
    const ch = channelFor(c.ctx.setting, k);
    return `${CATEGORY_META[k].emoji} ${k} → ${ch ? `<#${ch}>` : '—'}`;
  });
  return ephemeral({
    embeds: [
      {
        title: 'o bot',
        color: st.lastError ? COLORS.warning : COLORS.success,
        fields: [
          { name: 'você', value: `${esc(c.staffName)} · <@${c.userId}>`, inline: true },
          { name: 'enviados (24h)', value: int(s.sent), inline: true },
          {
            name: 'na fila',
            value: `${int(s.pending)}${s.oldest ? ` · mais antigo ${ts(s.oldest, 'R')}` : ''}`,
            inline: true,
          },
          { name: 'falharam (24h)', value: int(s.failed), inline: true },
          { name: 'último envio', value: s.last ? ts(s.last, 'R') : '—', inline: true },
          {
            name: 'comandos',
            value: st.commandsError
              ? `⚠️ ${esc(clip(st.commandsError.message, 150))}`
              : st.commands
                ? `registrados ${ts(st.commands.at, 'R')}`
                : '—',
            inline: true,
          },
          { name: 'canais', value: routes.join('\n'), inline: false },
          ...(muted.length
            ? [{ name: 'silenciados', value: muted.join('\n'), inline: false }]
            : []),
          ...(st.lastError
            ? [
                {
                  name: 'último erro',
                  value: `${esc(clip(st.lastError.message, 300))} · ${ts(st.lastError.at, 'R')}`,
                  inline: false,
                },
              ]
            : []),
        ],
      },
    ],
    components: row(linkButton('configurar no CRM', crm(c, '/config'))),
  });
}

function ajuda(c: CommandCtx): InteractionResponse {
  return ephemeral({
    embeds: [
      {
        title: 'o bot da Venduá',
        color: 0x5865f2,
        description: [
          'avisa a equipe de tudo o que acontece — leads, rascunhos, pedidos, assinaturas, frota, agente e sistema — e deixa resolver o comum daqui.',
          '',
          '**comandos**',
          '`/hoje` o dia até agora',
          '`/pendencias` o que espera a equipe (aprove rascunhos aqui)',
          '`/lead` e `/loja` a ficha de um lead ou de uma loja',
          '`/frota` lojas no ar, sondas e incidentes (reconheça daqui)',
          '`/resumo` o resumo das últimas 24h (`publicar` posta para todos)',
          '`/silenciar` uma categoria sem notificar por um tempo',
          '`/bot` fila, erros e canais',
          '',
          '**botões nos avisos**: aprovar ou rejeitar rascunhos, assumir ou resolver handoffs, reconhecer ou resolver incidentes. Tudo fica registrado com o seu nome.',
          '',
          `canais, níveis e o resumo diário se configuram no CRM em Config → Discord.`,
        ].join('\n'),
      },
    ],
    components: row(linkButton('Config → Discord', crm(c, '/config'))),
  });
}

export async function runCommand(
  c: CommandCtx,
  name: string,
  opts: Opt[] | undefined,
): Promise<InteractionResponse> {
  switch (name) {
    case 'hoje':
      return hoje(c);
    case 'pendencias':
      return ephemeral(await pendingView(c));
    case 'lead':
      return lead(c, opts);
    case 'loja':
      return loja(c, opts);
    case 'frota':
      return frota(c);
    case 'resumo':
      return resumo(c, opts);
    case 'silenciar':
      return silenciar(c, opts);
    case 'bot':
      return bot(c);
    case 'ajuda':
      return ajuda(c);
    default:
      return say(`não conheço o comando /${esc(clip(name, 32))} — tente /ajuda`);
  }
}

export async function autocomplete(
  sql: Sql,
  name: string,
  opts: Opt[] | undefined,
): Promise<InteractionResponse> {
  const focused = opts?.find((o) => o.focused);
  const q = String(focused?.value ?? '')
    .trim()
    .slice(0, 100);
  let choices: { name: string; value: string }[] = [];
  if (name === 'lead') {
    choices = (await searchLeads(sql, q, 10)).map((l) => ({
      name: clip(
        `${l.name}${l.business_name && l.business_name !== l.name ? ` · ${l.business_name}` : ''} (${label('leadState', l.state)})`,
        100,
      ),
      value: l.id,
    }));
  } else if (name === 'loja') {
    choices = (await searchStores(sql, q, 10)).map((s) => ({
      name: clip(`${s.name} (${s.slug})`, 100),
      value: s.id,
    }));
  }
  return { type: 8, data: { choices } };
}
