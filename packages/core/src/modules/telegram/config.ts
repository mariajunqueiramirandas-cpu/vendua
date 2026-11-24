import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { controlTx } from '../control.ts';
import { getIntegrationTx, getSettingTx, type IntegrationRow } from '../integrations.ts';
import { meetingConfigTx } from '../meetings.ts';
import { TELEGRAM_ID_RE } from '../staff-config.ts';
import {
  STAFF_CATEGORIES,
  STAFF_EVENT_KINDS,
  STAFF_LEVELS,
  isStaffEventKind,
  type StaffCategory,
  type StaffEventKind,
  type StaffLevel,
} from '../staff-events.ts';

// Three places, like every other provider: the `telegram` integration (bot id, username,
// webhookSecret; the token is an env var named by secret_ref), the `telegram` setting (levels,
// digest, excerpts — edited in the CRM), and `telegram_state` (what the bot itself writes:
// mutes, the registered command set, one-tap /start link tokens, and the last delivery error).

const USERNAME_RE = /^[A-Za-z0-9_]{3,64}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{16,256}$/;
export const DEFAULT_TOKEN_ENV = 'TELEGRAM_BOT_TOKEN';

export interface TelegramApp {
  botId: string;
  username: string;
  firstName: string;
  webhookSecret: string;
  token: string;
}

export type TelegramAppStatus =
  | { ok: true; app: TelegramApp }
  | {
      ok: false;
      reason: string;
      botId: string | null;
      username: string | null;
      webhookSecret: string | null;
    };

const cfgStr = (row: IntegrationRow, k: string): string => {
  const v = row.config[k];
  return typeof v === 'string' ? v.trim() : '';
};

/** The enabled `telegram` integration resolved against the environment. */
export function telegramAppOf(row: IntegrationRow | null): TelegramAppStatus {
  if (!row)
    return {
      ok: false,
      reason: 'integração telegram desligada',
      botId: null,
      username: null,
      webhookSecret: null,
    };
  const botId = cfgStr(row, 'botId');
  const username = cfgStr(row, 'username').replace(/^@/, '');
  const firstName = cfgStr(row, 'firstName') || username || 'Venduá';
  const webhookSecret = cfgStr(row, 'webhookSecret');
  const partial = {
    botId: TELEGRAM_ID_RE.test(botId) ? botId : null,
    username: USERNAME_RE.test(username) ? username : null,
    webhookSecret: SECRET_RE.test(webhookSecret) ? webhookSecret : null,
  };
  if (!partial.botId || !partial.username)
    return { ok: false, reason: 'bot ainda não conectado — clique em conectar', ...partial };
  if (!partial.webhookSecret)
    return { ok: false, reason: 'segredo do webhook ausente — clique em conectar', ...partial };
  const envName = row.secret_ref ?? DEFAULT_TOKEN_ENV;
  const token = (process.env[envName] || process.env[DEFAULT_TOKEN_ENV] || '').trim();
  if (!token) return { ok: false, reason: `env ${envName} ausente`, ...partial };
  return {
    ok: true,
    app: {
      botId: partial.botId,
      username: partial.username,
      firstName,
      webhookSecret: partial.webhookSecret,
      token,
    },
  };
}

/** Write-time check for the integration's config. */
export function validateTelegramConfig(config: Record<string, unknown>): void {
  const check = (k: string, re: RegExp, what: string) => {
    const v = config[k];
    if (v === undefined || v === null || v === '') return;
    if (typeof v !== 'string' || !re.test(v.trim()))
      throw new HttpError(422, 'BAD_REQUEST', `config.${k} must be ${what}`, { field: k });
  };
  check('botId', TELEGRAM_ID_RE, 'a Telegram bot id (5–20 digits)');
  check('username', USERNAME_RE, 'a Telegram bot username');
  check('webhookSecret', SECRET_RE, '16–256 characters of A–Z a–z 0–9 _ -');
  if (config.firstName !== undefined && config.firstName !== null && config.firstName !== '') {
    if (typeof config.firstName !== 'string' || config.firstName.trim().length > 128)
      throw new HttpError(422, 'BAD_REQUEST', 'config.firstName must be a string (≤128 chars)', {
        field: 'firstName',
      });
  }
  for (const k of Object.keys(config)) {
    if (!['botId', 'username', 'firstName', 'webhookSecret'].includes(k))
      throw new HttpError(422, 'BAD_REQUEST', `config.${k} is not a telegram field`, { field: k });
  }
}

export interface TelegramSetting {
  /** per-kind override of the catalog's default level */
  levels: Partial<Record<StaffEventKind, StaffLevel>>;
  digest: { enabled: boolean; hour: number };
  /** message excerpts (lead replies, drafts, help requests) leave our infrastructure */
  excerpts: boolean;
}

export const DEFAULT_TELEGRAM: TelegramSetting = {
  levels: {},
  digest: { enabled: true, hour: 8 },
  excerpts: true,
};

/** Lenient read: anything malformed falls back to the default instead of breaking delivery. */
export function telegramSettingOf(stored: unknown): TelegramSetting {
  const v = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const levels: TelegramSetting['levels'] = {};
  for (const [k, l] of Object.entries((v.levels ?? {}) as Record<string, unknown>)) {
    if (isStaffEventKind(k) && (STAFF_LEVELS as readonly unknown[]).includes(l))
      levels[k] = l as StaffLevel;
  }
  const d = (v.digest ?? {}) as Record<string, unknown>;
  const hour =
    typeof d.hour === 'number' && Number.isInteger(d.hour) && d.hour >= 0 && d.hour <= 23
      ? d.hour
      : DEFAULT_TELEGRAM.digest.hour;
  return {
    levels,
    digest: { enabled: d.enabled !== false, hour },
    excerpts: v.excerpts !== false,
  };
}

/** Strict write-time validation (PUT /control/v1/settings/telegram). */
export function validateTelegramSetting(value: unknown): void {
  const bad = (field: string, why: string) =>
    new HttpError(422, 'BAD_REQUEST', `settings.telegram.${field} ${why}`, { field });
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw bad('*', 'must be an object');
  const v = value as Record<string, unknown>;
  for (const k of Object.keys(v)) {
    if (!['levels', 'digest', 'excerpts'].includes(k)) throw bad(k, 'is not a telegram field');
  }
  const obj = (k: string) => {
    const o = v[k];
    if (o === undefined) return {};
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad(k, 'must be an object');
    return o as Record<string, unknown>;
  };
  for (const [k, l] of Object.entries(obj('levels'))) {
    if (!isStaffEventKind(k)) throw bad(`levels.${k}`, 'is not an event kind');
    if (STAFF_EVENT_KINDS[k].fixed) throw bad(`levels.${k}`, 'cannot be changed');
    if (!(STAFF_LEVELS as readonly unknown[]).includes(l))
      throw bad(`levels.${k}`, `must be ${STAFF_LEVELS.join(' | ')}`);
  }
  const d = obj('digest');
  for (const k of Object.keys(d)) {
    if (!['enabled', 'hour'].includes(k)) throw bad(`digest.${k}`, 'is not a digest field');
  }
  if (d.enabled !== undefined && typeof d.enabled !== 'boolean')
    throw bad('digest.enabled', 'must be a boolean');
  if (
    d.hour !== undefined &&
    (typeof d.hour !== 'number' || !Number.isInteger(d.hour) || d.hour < 0 || d.hour > 23)
  )
    throw bad('digest.hour', 'must be an integer hour in [0, 23]');
  if (v.excerpts !== undefined && typeof v.excerpts !== 'boolean')
    throw bad('excerpts', 'must be a boolean');
}

export function levelFor(s: TelegramSetting, kind: StaffEventKind): StaffLevel {
  const meta = STAFF_EVENT_KINDS[kind];
  return (meta.fixed ? undefined : s.levels[kind]) ?? meta.level;
}

export interface TelegramLinkToken {
  token: string;
  /** if linking an existing Config → Equipe row, match by its email / whatsapp / name */
  memberIndex?: number | null;
  memberEmail?: string | null;
  memberWhatsapp?: string | null;
  memberName?: string | null;
  expiresAt: string;
}

export interface TelegramState {
  /** category → ISO time the mute ends */
  mutes: Partial<Record<StaffCategory, string>>;
  commands: { hash: string; at: string } | null;
  commandsError: { at: string; message: string } | null;
  lastError: { at: string; message: string } | null;
  lastDeliveredAt: string | null;
  digest: { date: string; at: string } | null;
  /** single-use one-tap /start deep-link tokens (24h expiry, capped at 25) */
  linkTokens: TelegramLinkToken[];
}

const EMPTY_STATE: TelegramState = {
  mutes: {},
  commands: null,
  commandsError: null,
  lastError: null,
  lastDeliveredAt: null,
  digest: null,
  linkTokens: [],
};

export async function telegramStateTx(tx: Sql, forUpdate = false): Promise<TelegramState> {
  const rows = forUpdate
    ? await tx<{ value: Partial<TelegramState> }[]>`
        select value from control_settings where key = 'telegram_state' for update
      `
    : await tx<{ value: Partial<TelegramState> }[]>`
        select value from control_settings where key = 'telegram_state'
      `;
  const raw = rows[0]?.value ?? {};
  return {
    ...EMPTY_STATE,
    ...raw,
    mutes: raw.mutes ?? {},
    linkTokens: Array.isArray(raw.linkTokens) ? raw.linkTokens : [],
  };
}

/** Read-modify-write under the row lock — the job and webhook may both write. */
export async function updateTelegramStateTx(
  tx: Sql,
  change: (s: TelegramState) => Partial<TelegramState>,
): Promise<TelegramState> {
  await tx`
    insert into control_settings (key, value) values ('telegram_state', ${tx.json({} as never)})
    on conflict (key) do nothing
  `;
  const cur = await telegramStateTx(tx, true);
  const next = { ...cur, ...change(cur) };
  await tx`
    update control_settings set value = ${tx.json(next as never)} where key = 'telegram_state'
  `;
  return next;
}

export function updateTelegramState(
  sql: Sql,
  change: (s: TelegramState) => Partial<TelegramState>,
): Promise<TelegramState> {
  return controlTx(sql, (tx) => updateTelegramStateTx(tx, change));
}

export function mutedUntil(
  state: TelegramState,
  category: StaffCategory,
  now = Date.now(),
): string | null {
  const until = state.mutes[category];
  return until && new Date(until).getTime() > now ? until : null;
}

export interface TelegramContext {
  app: TelegramAppStatus;
  setting: TelegramSetting;
  state: TelegramState;
  /** CRM base for deep links (`…/control/#/pipeline/<id>`) */
  crmBase: string;
}

export async function telegramContextTx(tx: Sql): Promise<TelegramContext> {
  const [row, stored, state, meeting] = await Promise.all([
    getIntegrationTx(tx, 'telegram'),
    getSettingTx<unknown>(tx, 'telegram', {}),
    telegramStateTx(tx),
    meetingConfigTx(tx),
  ]);
  return {
    app: telegramAppOf(row),
    setting: telegramSettingOf(stored),
    state,
    // the CRM and the booking page share one host (apps/control/nginx.conf)
    crmBase: meeting.publicBaseUrl,
  };
}

export function telegramContext(sql: Sql): Promise<TelegramContext> {
  return controlTx(sql, telegramContextTx);
}

export const crmLink = (base: string, path: string) => `${base}/control/#${path}`;
