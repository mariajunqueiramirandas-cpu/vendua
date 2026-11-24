import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Context, Hono } from 'hono';
import type { Sql } from '../../platform/db.ts';
import { HttpError, bodyJson, boundedText, parseJsonObject } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import type { Tenant } from '../../platform/tenancy.ts';
import { mediaProviders, type MediaProviders } from '../../vendedor/media.ts';
import { claimControl, controlTx } from '../control.ts';
import { upsertIntegration } from '../integrations.ts';
import { linkedTelegramMembers } from '../staff-config.ts';
import { staffConfigTx } from '../staff.ts';
import {
  CATEGORY_META,
  STAFF_CATEGORIES,
  STAFF_EVENT_KINDS,
  STAFF_EVENT_KIND_LIST,
  STAFF_LEVELS,
  type StaffCategory,
} from '../staff-events.ts';
import { COMMANDS, commandsHash, ensureCommands } from './commands.ts';
import {
  DEFAULT_TOKEN_ENV,
  mutedUntil,
  telegramContext,
  updateTelegramStateTx,
  type TelegramContext,
} from './config.ts';
import { sendCard } from './deliver.ts';
import { b, esc } from './format.ts';
import { TelegramError, telegramClient, type TelegramFetch } from './rest.ts';
import { handleUpdate, verifyWebhookSecret, type TelegramUpdate } from './webhook.ts';

const rlog = log.child({ mod: 'telegram' });

const WEBHOOK_PATH = '/control/v1/telegram/webhook';
// Duá's head on a lime disc: set as the bot's Telegram profile photo when none is set yet
const AVATAR_PNG = join(import.meta.dir, '../../../../../apps/control/public/telegram/avatar.png');
const LINK_TTL_MS = 24 * 60 * 60_000;
const MAX_LINK_TOKENS = 25;

export function mountTelegram(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  /** tests swap Telegram's network */
  fetch?: TelegramFetch | undefined;
  /** voice note transcription (defaults to Core's media_routes.transcribe) */
  media?: MediaProviders | null | undefined;
}) {
  const { app, sql, controlGate } = o;
  const media = o.media === undefined ? mediaProviders(sql) : o.media;

  const idemKey = (c: Context, scope: string) => {
    const key = c.req.header('idempotency-key');
    if (!key)
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    if (key.length > 120) throw new HttpError(400, 'BAD_REQUEST', 'Idempotency-Key too long');
    return `telegram:${scope}:${key}`;
  };

  const ready = async (): Promise<TelegramContext & { app: { ok: true } }> => {
    const ctx = await telegramContext(sql);
    if (!ctx.app.ok)
      throw new HttpError(409, 'TELEGRAM_NOT_CONFIGURED', `telegram: ${ctx.app.reason}`);
    return ctx as TelegramContext & { app: { ok: true } };
  };

  const clientFor = (ctx: TelegramContext & { app: { ok: true } }) =>
    telegramClient(ctx.app.app.token, o.fetch);

  const telegramFail = (e: unknown): never => {
    if (e instanceof TelegramError) {
      const why = e.unauthorized
        ? 'token do bot recusado — confira TELEGRAM_BOT_TOKEN'
        : `telegram respondeu ${e.errorCode ?? e.status}: ${e.description}`;
      throw new HttpError(502, 'TELEGRAM_ERROR', why);
    }
    throw e;
  };

  // Telegram → Core. Not behind the staff gate: `x-telegram-bot-api-secret-token` is the
  // credential set by setWebhook; missing or wrong secret returns 401.
  app.post(WEBHOOK_PATH, async (c) => {
    const ctx = await telegramContext(sql);
    const expected = ctx.app.ok ? ctx.app.app.webhookSecret : ctx.app.webhookSecret;
    if (!expected) throw new HttpError(404, 'NOT_FOUND', 'not found');
    const provided = c.req.header('x-telegram-bot-api-secret-token');
    if (!verifyWebhookSecret(expected, provided)) {
      throw new HttpError(401, 'BAD_SIGNATURE', 'invalid webhook secret');
    }
    const raw = await boundedText(c, 256 * 1024);
    const update = parseJsonObject(raw) as unknown as TelegramUpdate;
    if (typeof update.update_id !== 'number') {
      throw new HttpError(400, 'BAD_REQUEST', 'not a telegram update');
    }
    if (ctx.app.ok) {
      await handleUpdate(
        sql,
        ctx,
        update,
        telegramClient(ctx.app.app.token, o.fetch),
        media ? { media } : {},
      );
    }
    return c.json({ ok: true });
  });

  app.get('/control/v1/telegram', async (c) => {
    controlGate(c);
    const ctx = await telegramContext(sql);
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
          where kind = 'telegram' order by updated_at desc limit 1
        `,
      ]),
    );
    const cfg = integration[0]?.config ?? {};
    const botId = typeof cfg.botId === 'string' ? cfg.botId : null;
    const username = typeof cfg.username === 'string' ? cfg.username : null;
    const firstName = typeof cfg.firstName === 'string' ? cfg.firstName : null;
    const tokenEnv = integration[0]?.secret_ref ?? DEFAULT_TOKEN_ENV;
    const failures = await controlTx(
      sql,
      (tx) => tx<{ kind: string; error: string | null; at: Date }[]>`
        select kind, last_error as error, created_at as at from staff_events
        where state = 'failed' and created_at > now() - interval '24 hours'
        order by id desc limit 5
      `,
    );
    const linked = linkedTelegramMembers(team);
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
      },
      app: {
        ok: ctx.app.ok,
        reason: ctx.app.ok ? null : ctx.app.reason,
        enabled: integration[0]?.enabled ?? false,
        botId,
        username,
        firstName,
        botUrl: username ? `https://t.me/${username}` : null,
        tokenEnv,
        tokenPresent: !!(process.env[tokenEnv] || process.env[DEFAULT_TOKEN_ENV]),
        webhookPath: WEBHOOK_PATH,
        webhookUrl: `${ctx.crmBase}${WEBHOOK_PATH}`,
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
        linked: linked.length,
        recipients: linked,
      },
    });
  });

  // "conectar": everything except the token comes from Telegram. Core calls getMe, generates
  // (or reuses) a webhook secret, sets the webhook URL, registers private-chat commands, and
  // gives the bot Duá's avatar if it still has no profile photo.
  app.post('/control/v1/telegram/connect', async (c) => {
    controlGate(c);
    const key = idemKey(c, 'connect');
    const body: Record<string, unknown> = await bodyJson(c).catch(() => ({}));
    const customEnv =
      typeof body.secretRef === 'string' && body.secretRef.trim() ? body.secretRef.trim() : null;
    if (customEnv && !/^[A-Z_][A-Z0-9_]*$/.test(customEnv)) {
      throw new HttpError(422, 'BAD_REQUEST', 'secretRef must be an env var name (UPPER_SNAKE)', {
        field: 'secretRef',
      });
    }
    const [row] = await controlTx(
      sql,
      (tx) => tx<{ config: Record<string, unknown>; secret_ref: string | null }[]>`
        select config, secret_ref from control_integrations
        where kind = 'telegram' and driver = 'bot'
      `,
    );
    const tokenEnv = customEnv ?? row?.secret_ref ?? DEFAULT_TOKEN_ENV;
    const token = (process.env[tokenEnv] || process.env[DEFAULT_TOKEN_ENV] || '').trim();
    if (!token)
      throw new HttpError(
        422,
        'TELEGRAM_TOKEN_MISSING',
        `coloque o token do bot em ${tokenEnv} no ambiente do Core e reinicie`,
      );
    const client = telegramClient(token, o.fetch);
    const me = await client
      .call<{ id: number; username?: string; first_name?: string }>('getMe')
      .catch(telegramFail);
    if (!me.username) {
      throw new HttpError(502, 'TELEGRAM_ERROR', 'o bot retornado pelo Telegram não tem username');
    }
    const existingSecret =
      typeof row?.config.webhookSecret === 'string' && row.config.webhookSecret.length >= 16
        ? row.config.webhookSecret
        : null;
    const webhookSecret = existingSecret ?? randomBytes(24).toString('hex');

    const res = await upsertIntegration(
      sql,
      {
        kind: 'telegram',
        driver: 'bot',
        enabled: true,
        config: {
          botId: String(me.id),
          username: me.username,
          firstName: (me.first_name ?? me.username).slice(0, 128),
          webhookSecret,
        },
        secretRef: customEnv ?? row?.secret_ref ?? null,
      },
      key,
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');

    const ctx = await telegramContext(sql);
    const webhookUrl = `${ctx.crmBase}${WEBHOOK_PATH}`;
    let webhookError: string | null = null;
    try {
      await client.call('setWebhook', {
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message', 'callback_query'],
      });
    } catch (e) {
      webhookError = e instanceof TelegramError ? e.description : String(e);
      rlog.warn({ err: webhookError, webhookUrl }, 'telegram setWebhook failed');
    }

    await ensureCommands(sql, ctx, client, true);

    // Duá's avatar when the bot still has no profile photo; best-effort, never blocks connect
    try {
      const photos = await client
        .call<{ total_count?: number }>('getUserProfilePhotos', { user_id: me.id, limit: 1 })
        .catch(() => null);
      if (photos && (photos.total_count ?? 0) === 0) {
        const bytes = await Bun.file(AVATAR_PNG).arrayBuffer();
        const form = new FormData();
        form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }));
        form.append('avatar', new Blob([bytes], { type: 'image/png' }), 'avatar.png');
        await client.callForm('setMyProfilePhoto', form);
      }
    } catch (e) {
      rlog.debug({ err: e instanceof Error ? e.message : String(e) }, 'telegram avatar not set');
    }

    return c.json({
      botId: String(me.id),
      username: me.username,
      firstName: me.first_name ?? me.username,
      botUrl: `https://t.me/${me.username}`,
      webhook: { url: webhookUrl, ok: !webhookError, error: webhookError },
    });
  });

  // "desligar": disables the integration while preserving its config and removes the webhook
  app.post('/control/v1/telegram/disconnect', async (c) => {
    controlGate(c);
    const key = idemKey(c, 'disconnect');
    const ctx = await telegramContext(sql);
    const res = await claimControl(sql, key, async (tx) => {
      await tx`
        update control_integrations set enabled = false, updated_at = now()
        where kind = 'telegram'
      `;
      return { status: 200, body: { ok: true } };
    });
    if (!res.replayed && ctx.app.ok) {
      await telegramClient(ctx.app.app.token, o.fetch)
        .call('deleteWebhook', { drop_pending_updates: false })
        .catch((e) =>
          rlog.debug({ err: e instanceof Error ? e.message : String(e) }, 'deleteWebhook failed'),
        );
    }
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  // One-tap deep link: `https://t.me/<bot>?start=link_<token>`. Opening it and tapping Start
  // links the user's DM automatically without copying any numeric IDs.
  app.post('/control/v1/telegram/link', async (c) => {
    controlGate(c);
    const key = idemKey(c, 'link');
    const body: Record<string, unknown> = await bodyJson(c).catch(() => ({}));
    const ctx = await ready();
    const memberIndex =
      typeof body.memberIndex === 'number' &&
      Number.isInteger(body.memberIndex) &&
      body.memberIndex >= 0 &&
      body.memberIndex < 20
        ? body.memberIndex
        : null;

    const res = await claimControl(sql, key, async (tx) => {
      const staff = await staffConfigTx(tx);
      const target = memberIndex !== null ? staff.members[memberIndex] : null;
      const token = randomBytes(18).toString('base64url');
      const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();
      const now = Date.now();
      await updateTelegramStateTx(tx, (s) => {
        const live = s.linkTokens
          .filter((t) => new Date(t.expiresAt).getTime() > now)
          .slice(-(MAX_LINK_TOKENS - 1));
        return {
          linkTokens: [
            ...live,
            {
              token,
              ...(memberIndex !== null ? { memberIndex } : {}),
              ...(target?.email ? { memberEmail: target.email } : {}),
              ...(target?.whatsapp ? { memberWhatsapp: target.whatsapp } : {}),
              ...(target?.name ? { memberName: target.name } : {}),
              expiresAt,
            },
          ],
        };
      });
      return {
        status: 200,
        body: {
          url: `https://t.me/${ctx.app.app.username}?start=link_${token}`,
          expiresAt,
        },
      };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body, res.status as 200);
  });

  // Sends a test card to every linked team member's DM — proves token, webhook & DMs work.
  app.post('/control/v1/telegram/test', async (c) => {
    controlGate(c);
    const key = idemKey(c, 'test');
    const ctx = await ready();
    const client = clientFor(ctx);
    const res = await claimControl(sql, key, async (tx) => {
      const staff = await staffConfigTx(tx);
      const recipients = linkedTelegramMembers(staff);
      const results: { chatId: string; name: string; ok: boolean; error?: string }[] = [];
      for (const r of recipients) {
        try {
          await sendCard(client, r.chatId, {
            text: [
              `✅ ${b('o bot da Venduá está funcionando')}`,
              `teste enviado pelo CRM para ${esc(r.name)}.`,
              'os avisos da operação chegam aqui na sua DM.',
            ].join('\n'),
          });
          results.push({ chatId: r.chatId, name: r.name, ok: true });
        } catch (e) {
          results.push({
            chatId: r.chatId,
            name: r.name,
            ok: false,
            error:
              e instanceof TelegramError
                ? e.blocked
                  ? 'abra a conversa com o bot e toque em Começar'
                  : `telegram ${e.errorCode ?? e.status}: ${e.description}`
                : String(e),
          });
        }
      }
      return { status: 200, body: { results } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.post('/control/v1/telegram/commands', async (c) => {
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
  app.put('/control/v1/telegram/mutes/:category', async (c) => {
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
      const st = await updateTelegramStateTx(tx, (s) => {
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

  rlog.debug('telegram routes mounted');
}
