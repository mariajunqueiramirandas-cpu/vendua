import { join } from 'node:path';
import type { Context, Hono } from 'hono';
import type { Sql } from '../../platform/db.ts';
import { HttpError, bodyJson, boundedText, parseJsonObject } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import type { Tenant } from '../../platform/tenancy.ts';
import { claimControl, controlTx } from '../control.ts';
import { getSettingTx, upsertIntegration } from '../integrations.ts';
import {
  CATEGORY_META,
  STAFF_CATEGORIES,
  STAFF_EVENT_KINDS,
  STAFF_EVENT_KIND_LIST,
  STAFF_LEVELS,
  type StaffCategory,
} from '../staff-events.ts';
import { staffConfigTx } from '../staff.ts';
import { COMMANDS, commandsHash, ensureCommands } from './commands.ts';
import {
  CHANNEL_KEYS,
  DEFAULT_TOKEN_ENV,
  SNOWFLAKE_RE,
  artLink,
  channelFor,
  discordContext,
  discordSettingOf,
  mutedUntil,
  updateDiscordStateTx,
  type DiscordContext,
} from './config.ts';
import { COLORS, fitMessage } from './format.ts';
import { handleInteraction, verifyDiscordSignature, type Interaction } from './interactions.ts';
import { DiscordError, discordClient, type DiscordFetch } from './rest.ts';

const rlog = log.child({ mod: 'discord' });

// permissions the bot asks for when invited: view, send, embed links, read history,
// mention roles (a staff role that isn't mentionable), manage channels ("criar canais")
const VIEW = 1 << 10;
const SEND = 1 << 11;
const EMBED = 1 << 14;
const HISTORY = 1 << 16;
const MENTION = 1 << 17;
const MANAGE_CHANNELS = 1 << 4;
export const BOT_PERMISSIONS = VIEW + SEND + EMBED + HISTORY + MENTION + MANAGE_CHANNELS;

export const CHANNEL_NAMES: Record<StaffCategory, string> = {
  atendimento: 'atendimento',
  crm: 'crm',
  vendas: 'vendas',
  assinaturas: 'assinaturas',
  frota: 'frota',
  agente: 'agente',
  sistema: 'sistema',
  resumo: 'resumo',
};
const CATEGORY_NAME = 'Venduá';
const ENDPOINT_PATH = '/control/v1/discord/interactions';
// Duá's head on a lime disc: the bot's avatar and the app's icon (served with the CRM too)
const AVATAR_PNG = join(import.meta.dir, '../../../../../apps/control/public/discord/avatar.png');

export function inviteUrl(applicationId: string, guildId: string | null): string {
  const q = new URLSearchParams({
    client_id: applicationId,
    scope: 'bot applications.commands',
    permissions: String(BOT_PERMISSIONS),
    ...(guildId ? { guild_id: guildId, disable_guild_select: 'true' } : {}),
  });
  return `https://discord.com/oauth2/authorize?${q}`;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  position?: number;
}

export function mountDiscord(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  kickDrain: () => void;
  /** tests swap Discord's network */
  fetch?: DiscordFetch | undefined;
}) {
  const { app, sql, controlGate, kickDrain } = o;

  const idemKey = (c: Context, scope: string) => {
    const key = c.req.header('idempotency-key');
    if (!key)
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    if (key.length > 120) throw new HttpError(400, 'BAD_REQUEST', 'Idempotency-Key too long');
    return `discord:${scope}:${key}`;
  };

  const ready = async (): Promise<DiscordContext & { app: { ok: true } }> => {
    const ctx = await discordContext(sql);
    if (!ctx.app.ok)
      throw new HttpError(409, 'DISCORD_NOT_CONFIGURED', `discord: ${ctx.app.reason}`);
    return ctx as DiscordContext & { app: { ok: true } };
  };

  const clientFor = (ctx: DiscordContext & { app: { ok: true } }) =>
    discordClient(ctx.app.app.token, o.fetch);

  const discordFail = (e: unknown): never => {
    if (e instanceof DiscordError) {
      const why =
        e.status === 401
          ? 'token do bot recusado — confira DISCORD_BOT_TOKEN'
          : e.code === 10004
            ? 'o bot não está nesse servidor — adicione pelo link de convite'
            : e.code === 50001 || e.code === 50013
              ? 'o bot não tem permissão para isso no servidor'
              : `discord respondeu ${e.status}: ${e.message}`;
      throw new HttpError(502, 'DISCORD_ERROR', why);
    }
    throw e;
  };

  // Discord → Core. Not behind the staff gate: Ed25519 over timestamp+body is the credential;
  // a bad or missing signature is 401, which is what Discord's endpoint check expects.
  app.post(ENDPOINT_PATH, async (c) => {
    const ctx = await discordContext(sql);
    const publicKey = ctx.app.ok ? ctx.app.app.publicKey : ctx.app.publicKey;
    if (!publicKey) throw new HttpError(404, 'NOT_FOUND', 'not found');
    const raw = await boundedText(c, 256 * 1024);
    const ok = await verifyDiscordSignature(
      publicKey,
      c.req.header('x-signature-ed25519'),
      c.req.header('x-signature-timestamp'),
      raw,
    );
    if (!ok) throw new HttpError(401, 'BAD_SIGNATURE', 'invalid request signature');
    const body = parseJsonObject(raw) as unknown as Interaction;
    if (typeof body.type !== 'number' || typeof body.id !== 'string')
      throw new HttpError(400, 'BAD_REQUEST', 'not an interaction');
    return c.json(await handleInteraction(sql, ctx, body, { kickDrain }));
  });

  app.get('/control/v1/discord', async (c) => {
    controlGate(c);
    const ctx = await discordContext(sql);
    const [queue, team, integration] = await controlTx(sql, (tx) =>
      Promise.all([
        tx<
          {
            pending: number;
            failed: number;
            skipped: number;
            sent: number;
            last: Date | null;
            oldest: Date | null;
          }[]
        >`
          select count(*) filter (where state = 'pending')::int as pending,
                 count(*) filter (where state = 'failed' and created_at > now() - interval '24 hours')::int as failed,
                 count(*) filter (where state = 'skipped' and created_at > now() - interval '24 hours')::int as skipped,
                 count(*) filter (where state = 'sent' and delivered_at > now() - interval '24 hours')::int as sent,
                 max(delivered_at) as last,
                 min(created_at) filter (where state = 'pending') as oldest
          from staff_events
        `,
        staffConfigTx(tx),
        tx<{ config: Record<string, unknown>; secret_ref: string | null; enabled: boolean }[]>`
          select config, secret_ref, enabled from control_integrations
          where kind = 'discord' order by updated_at desc limit 1
        `,
      ]),
    );
    const cfg = integration[0]?.config ?? {};
    const applicationId = typeof cfg.applicationId === 'string' ? cfg.applicationId : '';
    const guildId = typeof cfg.guildId === 'string' ? cfg.guildId : '';
    // Discord calls it the public key: it only verifies signatures, it can't sign
    const publicKey = typeof cfg.publicKey === 'string' ? cfg.publicKey : '';
    const tokenEnv = integration[0]?.secret_ref ?? DEFAULT_TOKEN_ENV;
    const failures = await controlTx(
      sql,
      (tx) => tx<{ kind: string; error: string | null; at: Date }[]>`
        select kind, last_error as error, created_at as at from staff_events
        where state = 'failed' and created_at > now() - interval '24 hours'
        order by id desc limit 5
      `,
    );
    c.header('cache-control', 'no-store');
    return c.json({
      catalog: {
        levels: STAFF_LEVELS,
        categories: STAFF_CATEGORIES.map((k) => ({ key: k, ...CATEGORY_META[k] })),
        kinds: STAFF_EVENT_KIND_LIST.filter((k) => !STAFF_EVENT_KINDS[k].fixed).map((k) => {
          const m = STAFF_EVENT_KINDS[k];
          return {
            kind: k,
            category: m.category,
            level: m.level,
            label: m.label,
            hint: m.hint ?? null,
            follows: m.anchor?.role === 'follows',
          };
        }),
        channelKeys: CHANNEL_KEYS,
      },
      app: {
        ok: ctx.app.ok,
        reason: ctx.app.ok ? null : ctx.app.reason,
        enabled: integration[0]?.enabled ?? false,
        applicationId: applicationId || null,
        guildId: guildId || null,
        publicKey: publicKey || null,
        tokenEnv,
        tokenPresent: !!(process.env[tokenEnv] || process.env[DEFAULT_TOKEN_ENV]),
        invite: SNOWFLAKE_RE.test(applicationId)
          ? inviteUrl(applicationId, SNOWFLAKE_RE.test(guildId) ? guildId : null)
          : null,
        endpointPath: ENDPOINT_PATH,
        endpointUrl: `${ctx.crmBase}${ENDPOINT_PATH}`,
      },
      setting: ctx.setting,
      state: {
        mutes: Object.fromEntries(
          STAFF_CATEGORIES.filter((k) => mutedUntil(ctx.state, k)).map((k) => [
            k,
            ctx.state.mutes[k],
          ]),
        ),
        commands: ctx.state.commands,
        commandsCurrent: !!ctx.state.commands && ctx.state.commands.hash === commandsHash(ctx),
        commandsError: ctx.state.commandsError,
        lastError: ctx.state.lastError,
      },
      queue: queue[0],
      failures,
      team: {
        members: team.members.length,
        linked: team.members.filter((m) => (m as { discord?: unknown }).discord).length,
      },
    });
  });

  // the guild's channels and roles, for the CRM's pickers (live from Discord)
  app.get('/control/v1/discord/guild', async (c) => {
    controlGate(c);
    const ctx = await ready();
    const client = clientFor(ctx);
    const g = ctx.app.app.guildId;
    try {
      const [guild, channels, roles] = await Promise.all([
        client.request<{ id: string; name: string }>('GET', `/guilds/${g}`),
        client.request<DiscordChannel[]>('GET', `/guilds/${g}/channels`),
        client.request<
          { id: string; name: string; color: number; managed: boolean; position: number }[]
        >('GET', `/guilds/${g}/roles`),
      ]);
      const parents = new Map(channels.filter((ch) => ch.type === 4).map((ch) => [ch.id, ch.name]));
      c.header('cache-control', 'no-store');
      return c.json({
        guild: { id: guild.id, name: guild.name },
        channels: channels
          .filter((ch) => ch.type === 0 || ch.type === 5)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((ch) => ({
            id: ch.id,
            name: ch.name,
            category: ch.parent_id ? (parents.get(ch.parent_id) ?? null) : null,
          })),
        roles: roles
          .filter((r) => !r.managed && r.id !== g)
          .sort((a, b) => b.position - a.position)
          .map((r) => ({ id: r.id, name: r.name, color: r.color })),
      });
    } catch (e) {
      return discordFail(e);
    }
  });

  // "conectar": everything but the token comes from Discord. The token reads the application's
  // id and public key and the servers the bot is in (one → that's the team's), and sets the
  // interactions URL — after the commit, since Discord PINGs it with the key we just saved.
  app.post('/control/v1/discord/connect', async (c) => {
    controlGate(c);
    const key = idemKey(c, 'connect');
    const body = await bodyJson(c);
    const wanted = body.guildId === undefined || body.guildId === '' ? null : body.guildId;
    if (wanted !== null && (typeof wanted !== 'string' || !SNOWFLAKE_RE.test(wanted)))
      throw new HttpError(422, 'BAD_REQUEST', 'guildId must be a Discord id', {
        field: 'guildId',
      });
    const [row] = await controlTx(
      sql,
      (tx) => tx<{ config: Record<string, unknown>; secret_ref: string | null }[]>`
        select config, secret_ref from control_integrations
        where kind = 'discord' and driver = 'bot'
      `,
    );
    const tokenEnv = row?.secret_ref ?? DEFAULT_TOKEN_ENV;
    const token = (process.env[tokenEnv] || process.env[DEFAULT_TOKEN_ENV] || '').trim();
    if (!token)
      throw new HttpError(
        422,
        'DISCORD_TOKEN_MISSING',
        `coloque o token do bot em ${tokenEnv} no ambiente do Core e reinicie`,
      );
    const client = discordClient(token, o.fetch);
    const [me, guilds, bot] = await Promise.all([
      client.request<{
        id: string;
        verify_key: string;
        icon?: string | null;
        interactions_endpoint_url?: string | null;
      }>('GET', '/applications/@me'),
      client.request<{ id: string; name: string }[]>('GET', '/users/@me/guilds'),
      client.request<{ avatar?: string | null }>('GET', '/users/@me'),
    ]).catch(discordFail);
    const inGuild = (id: unknown) => guilds.some((g) => g.id === id);
    if (wanted && !inGuild(wanted))
      throw new HttpError(
        422,
        'BAD_REQUEST',
        'o bot não está nesse servidor — adicione pelo convite',
        { field: 'guildId' },
      );
    const g0 = row?.config.guildId;
    const current = typeof g0 === 'string' && SNOWFLAKE_RE.test(g0) ? g0 : null;
    const guildId =
      wanted ??
      (current && inGuild(current) ? current : guilds.length === 1 ? guilds[0]!.id : null);

    const res = await upsertIntegration(
      sql,
      {
        kind: 'discord',
        driver: 'bot',
        enabled: true,
        config: {
          applicationId: me.id,
          publicKey: me.verify_key.toLowerCase(),
          ...(guildId ? { guildId } : {}),
        },
        secretRef: row?.secret_ref ?? null,
      },
      key,
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');

    const { crmBase } = await discordContext(sql);
    const endpointUrl = `${crmBase}${ENDPOINT_PATH}`;
    let endpointError: string | null = null;
    if (me.interactions_endpoint_url !== endpointUrl) {
      try {
        await client.request('PATCH', '/applications/@me', {
          interactions_endpoint_url: endpointUrl,
        });
      } catch (e) {
        endpointError = e instanceof DiscordError ? e.message : String(e);
        rlog.warn({ err: endpointError, endpointUrl }, 'interactions url not accepted');
      }
    }
    // Duá's face on a bot and app still wearing Discord's default; a picture the team chose stays
    if (!bot.avatar || !me.icon) {
      try {
        const image = `data:image/png;base64,${Buffer.from(await Bun.file(AVATAR_PNG).arrayBuffer()).toString('base64')}`;
        if (!bot.avatar) await client.request('PATCH', '/users/@me', { avatar: image });
        if (!me.icon) await client.request('PATCH', '/applications/@me', { icon: image });
      } catch (e) {
        rlog.warn({ err: e instanceof Error ? e.message : String(e) }, 'bot avatar not set');
      }
    }
    return c.json({
      applicationId: me.id,
      guildId,
      guilds: guilds.map((g) => ({ id: g.id, name: g.name })),
      invite: inviteUrl(me.id, guildId),
      endpoint: { url: endpointUrl, ok: !endpointError, error: endpointError },
    });
  });

  // "criar canais": a private category with one channel per category, saved as the routing.
  // Idempotent by name — running it again only fills what's missing.
  app.post('/control/v1/discord/setup', async (c) => {
    controlGate(c);
    const key = idemKey(c, 'setup');
    const body = await bodyJson(c);
    const ctx = await ready();
    const roleId =
      typeof body.staffRoleId === 'string' && SNOWFLAKE_RE.test(body.staffRoleId)
        ? body.staffRoleId
        : ctx.setting.staffRoleId;
    if (!roleId)
      throw new HttpError(
        422,
        'BAD_REQUEST',
        'escolha o cargo da equipe antes de criar os canais',
        {
          field: 'staffRoleId',
        },
      );
    const client = clientFor(ctx);
    const g = ctx.app.app.guildId;
    const res = await claimControl(sql, key, async (tx) => {
      try {
        const me = await client.request<{ id: string }>('GET', '/users/@me');
        const overwrites = [
          { id: g, type: 0, allow: '0', deny: String(VIEW) },
          { id: roleId, type: 0, allow: String(VIEW + SEND + HISTORY), deny: '0' },
          { id: me.id, type: 1, allow: String(VIEW + SEND + EMBED + HISTORY), deny: '0' },
        ];
        const existing = await client.request<DiscordChannel[]>('GET', `/guilds/${g}/channels`);
        let parent = existing.find(
          (ch) => ch.type === 4 && ch.name.toLowerCase() === CATEGORY_NAME.toLowerCase(),
        );
        parent ??= await client.request<DiscordChannel>('POST', `/guilds/${g}/channels`, {
          name: CATEGORY_NAME,
          type: 4,
          permission_overwrites: overwrites,
        });
        const channels: Record<string, string> = {};
        const created: string[] = [];
        for (const cat of STAFF_CATEGORIES) {
          const name = CHANNEL_NAMES[cat];
          let ch = existing.find(
            (x) => x.type === 0 && x.name === name && x.parent_id === parent.id,
          );
          if (!ch) {
            ch = await client.request<DiscordChannel>('POST', `/guilds/${g}/channels`, {
              name,
              type: 0,
              parent_id: parent.id,
              topic: `${CATEGORY_META[cat].emoji} ${CATEGORY_META[cat].hint} — avisos do bot da Venduá`,
              permission_overwrites: overwrites,
            });
            created.push(name);
          }
          channels[cat] = ch.id;
        }
        const stored = await getSettingTx<Record<string, unknown>>(tx, 'discord', {});
        const prev = discordSettingOf(stored);
        const next = {
          ...stored,
          channels: { ...prev.channels, ...channels },
          staffRoleId: roleId,
        };
        await tx`
          insert into control_settings (key, value) values ('discord', ${tx.json(next as never)})
          on conflict (key) do update set value = excluded.value
        `;
        return { status: 200, body: { channels, created, categoryId: parent.id } };
      } catch (e) {
        return discordFail(e);
      }
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body, res.status as 200);
  });

  // one test card in every channel that receives something — proves routing and permissions
  app.post('/control/v1/discord/test', async (c) => {
    controlGate(c);
    const key = idemKey(c, 'test');
    const ctx = await ready();
    const client = clientFor(ctx);
    const res = await claimControl(sql, key, async () => {
      const targets = new Map<string, StaffCategory[]>();
      for (const cat of STAFF_CATEGORIES) {
        const ch = channelFor(ctx.setting, cat);
        if (ch) targets.set(ch, [...(targets.get(ch) ?? []), cat]);
      }
      const results: { channelId: string; categories: string[]; ok: boolean; error?: string }[] =
        [];
      for (const [channelId, cats] of targets) {
        try {
          await client.request(
            'POST',
            `/channels/${channelId}/messages`,
            fitMessage({
              embeds: [
                {
                  title: '✅ o bot da Venduá está funcionando',
                  description: `teste enviado pelo CRM.\neste canal recebe: ${cats
                    .map((k) => `${CATEGORY_META[k].emoji} ${k}`)
                    .join(', ')}`,
                  color: COLORS.success,
                  thumbnail: { url: artLink(ctx.crmBase, 'sucesso') },
                },
              ],
              allowed_mentions: { parse: [] },
            }),
          );
          results.push({ channelId, categories: cats, ok: true });
        } catch (e) {
          results.push({
            channelId,
            categories: cats,
            ok: false,
            error:
              e instanceof DiscordError
                ? e.code === 10003
                  ? 'canal não existe'
                  : e.code === 50001 || e.code === 50013
                    ? 'sem permissão no canal'
                    : `discord ${e.status}: ${e.message}`
                : String(e),
          });
        }
      }
      return { status: 200, body: { results } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.post('/control/v1/discord/commands', async (c) => {
    controlGate(c);
    const key = idemKey(c, 'commands');
    const ctx = await ready();
    const res = await claimControl(sql, key, async () => {
      const r = await ensureCommands(sql, ctx, clientFor(ctx), true);
      return { status: 200, body: { ok: r.ok, error: r.error ?? null, commands: COMMANDS.length } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  // mute or unmute a category from the CRM ({ minutes: 0 } = unmute)
  app.put('/control/v1/discord/mutes/:category', async (c) => {
    controlGate(c);
    const category = c.req.param('category');
    if (category !== 'todas' && !(STAFF_CATEGORIES as readonly string[]).includes(category))
      throw new HttpError(400, 'BAD_REQUEST', 'unknown category');
    const key = idemKey(c, `mute:${category}`);
    const body = await bodyJson(c);
    const minutes = body.minutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440)
      throw new HttpError(422, 'BAD_REQUEST', 'minutes must be an integer in [0, 1440]', {
        field: 'minutes',
      });
    const cats = category === 'todas' ? [...STAFF_CATEGORIES] : [category as StaffCategory];
    const res = await claimControl(sql, key, async (tx) => {
      const until = minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
      const st = await updateDiscordStateTx(tx, (s) => {
        const mutes = { ...s.mutes };
        for (const k of cats) {
          if (until) mutes[k] = until;
          else delete mutes[k];
        }
        return { mutes };
      });
      return { status: 200, body: { mutes: st.mutes } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  rlog.debug('discord routes mounted');
}
