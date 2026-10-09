import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { controlTx } from '../control.ts';
import { getIntegrationTx, getSettingTx, type IntegrationRow } from '../integrations.ts';
import { meetingConfigTx } from '../meetings.ts';
import {
  STAFF_CATEGORIES,
  STAFF_EVENT_KINDS,
  STAFF_LEVELS,
  isStaffEventKind,
  type StaffCategory,
  type StaffEventKind,
  type StaffLevel,
} from '../staff-events.ts';

// Three places, like every other provider: the `discord` integration (application id, public key,
// guild; the token is an env var named by secret_ref), the `discord` setting (routing, levels,
// digest — edited in the CRM), and `discord_state` (what the bot itself writes: mutes, the
// registered command set, the last delivery error).

export const SNOWFLAKE_RE = /^\d{17,20}$/;
const PUBLIC_KEY_RE = /^[0-9a-f]{64}$/i;
export const DEFAULT_TOKEN_ENV = 'DISCORD_BOT_TOKEN';

export interface DiscordApp {
  applicationId: string;
  publicKey: string;
  guildId: string;
  token: string;
}

export type DiscordAppStatus =
  | { ok: true; app: DiscordApp }
  | { ok: false; reason: string; publicKey: string | null; guildId: string | null };

const cfgStr = (row: IntegrationRow, k: string): string => {
  const v = row.config[k];
  return typeof v === 'string' ? v.trim() : '';
};

/** The enabled `discord` integration resolved against the environment. */
export function discordAppOf(row: IntegrationRow | null): DiscordAppStatus {
  if (!row)
    return { ok: false, reason: 'integração discord desligada', publicKey: null, guildId: null };
  const applicationId = cfgStr(row, 'applicationId');
  const publicKey = cfgStr(row, 'publicKey').toLowerCase();
  const guildId = cfgStr(row, 'guildId');
  const partial = {
    publicKey: PUBLIC_KEY_RE.test(publicKey) ? publicKey : null,
    guildId: SNOWFLAKE_RE.test(guildId) ? guildId : null,
  };
  if (!SNOWFLAKE_RE.test(applicationId))
    return { ok: false, reason: 'application id ausente ou inválido', ...partial };
  if (!partial.publicKey)
    return { ok: false, reason: 'public key ausente ou inválida', ...partial };
  if (!partial.guildId)
    return { ok: false, reason: 'id do servidor ausente ou inválido', ...partial };
  const envName = row.secret_ref ?? DEFAULT_TOKEN_ENV;
  const token = (process.env[envName] || process.env[DEFAULT_TOKEN_ENV] || '').trim();
  if (!token) return { ok: false, reason: `env ${envName} ausente`, ...partial };
  return { ok: true, app: { applicationId, publicKey, guildId, token } };
}

/** Write-time check for the integration's config (the CRM saves fields as they're typed). */
export function validateDiscordConfig(config: Record<string, unknown>): void {
  const check = (k: string, re: RegExp, what: string) => {
    const v = config[k];
    if (v === undefined || v === null || v === '') return;
    if (typeof v !== 'string' || !re.test(v.trim()))
      throw new HttpError(422, 'BAD_REQUEST', `config.${k} must be ${what}`, { field: k });
  };
  check('applicationId', SNOWFLAKE_RE, 'a Discord id (17–20 digits)');
  check('guildId', SNOWFLAKE_RE, 'a Discord id (17–20 digits)');
  check('publicKey', PUBLIC_KEY_RE, 'the 64-hex public key');
  for (const k of Object.keys(config)) {
    if (!['applicationId', 'guildId', 'publicKey'].includes(k))
      throw new HttpError(422, 'BAD_REQUEST', `config.${k} is not a discord field`, { field: k });
  }
}

export type ChannelKey = StaffCategory | 'default';
export const CHANNEL_KEYS: readonly ChannelKey[] = ['default', ...STAFF_CATEGORIES];

export interface DiscordSetting {
  /** category → channel id; `default` catches every unmapped category */
  channels: Partial<Record<ChannelKey, string>>;
  /** per-kind override of the catalog's default level */
  levels: Partial<Record<StaffEventKind, StaffLevel>>;
  /** mentioned by `ping` and critical events; also the role "Criar canais" lets in */
  staffRoleId: string | null;
  digest: { enabled: boolean; hour: number };
  /** message excerpts (lead replies, drafts, help requests) leave our infrastructure */
  excerpts: boolean;
}

export const DEFAULT_DISCORD: DiscordSetting = {
  channels: {},
  levels: {},
  staffRoleId: null,
  digest: { enabled: true, hour: 8 },
  excerpts: true,
};

/** Lenient read: anything malformed falls back to the default instead of breaking delivery. */
export function discordSettingOf(stored: unknown): DiscordSetting {
  const v = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const channels: DiscordSetting['channels'] = {};
  const rawChannels = (v.channels ?? {}) as Record<string, unknown>;
  for (const k of CHANNEL_KEYS) {
    const id = rawChannels[k];
    if (typeof id === 'string' && SNOWFLAKE_RE.test(id)) channels[k] = id;
  }
  const levels: DiscordSetting['levels'] = {};
  for (const [k, l] of Object.entries((v.levels ?? {}) as Record<string, unknown>)) {
    if (isStaffEventKind(k) && (STAFF_LEVELS as readonly unknown[]).includes(l))
      levels[k] = l as StaffLevel;
  }
  const d = (v.digest ?? {}) as Record<string, unknown>;
  const hour =
    typeof d.hour === 'number' && Number.isInteger(d.hour) && d.hour >= 0 && d.hour <= 23
      ? d.hour
      : DEFAULT_DISCORD.digest.hour;
  return {
    channels,
    levels,
    staffRoleId:
      typeof v.staffRoleId === 'string' && SNOWFLAKE_RE.test(v.staffRoleId) ? v.staffRoleId : null,
    digest: { enabled: d.enabled !== false, hour },
    excerpts: v.excerpts !== false,
  };
}

/** Strict write-time validation (PUT /control/v1/settings/discord). */
export function validateDiscordSetting(value: unknown): void {
  const bad = (field: string, why: string) =>
    new HttpError(422, 'BAD_REQUEST', `settings.discord.${field} ${why}`, { field });
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw bad('*', 'must be an object');
  const v = value as Record<string, unknown>;
  for (const k of Object.keys(v)) {
    if (!['channels', 'levels', 'staffRoleId', 'digest', 'excerpts'].includes(k))
      throw bad(k, 'is not a discord field');
  }
  const obj = (k: string) => {
    const o = v[k];
    if (o === undefined) return {};
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad(k, 'must be an object');
    return o as Record<string, unknown>;
  };
  for (const [k, id] of Object.entries(obj('channels'))) {
    if (!(CHANNEL_KEYS as readonly string[]).includes(k))
      throw bad(`channels.${k}`, `is not a category — one of: ${CHANNEL_KEYS.join(', ')}`);
    if (id !== null && id !== '' && (typeof id !== 'string' || !SNOWFLAKE_RE.test(id)))
      throw bad(`channels.${k}`, 'must be a Discord channel id');
  }
  for (const [k, l] of Object.entries(obj('levels'))) {
    if (!isStaffEventKind(k)) throw bad(`levels.${k}`, 'is not an event kind');
    if (STAFF_EVENT_KINDS[k].fixed) throw bad(`levels.${k}`, 'cannot be changed');
    if (!(STAFF_LEVELS as readonly unknown[]).includes(l))
      throw bad(`levels.${k}`, `must be ${STAFF_LEVELS.join(' | ')}`);
  }
  if (
    v.staffRoleId !== undefined &&
    v.staffRoleId !== null &&
    v.staffRoleId !== '' &&
    (typeof v.staffRoleId !== 'string' || !SNOWFLAKE_RE.test(v.staffRoleId))
  )
    throw bad('staffRoleId', 'must be a Discord role id');
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

export function levelFor(s: DiscordSetting, kind: StaffEventKind): StaffLevel {
  const meta = STAFF_EVENT_KINDS[kind];
  return (meta.fixed ? undefined : s.levels[kind]) ?? meta.level;
}

export function channelFor(s: DiscordSetting, category: StaffCategory): string | null {
  return s.channels[category] ?? s.channels.default ?? null;
}

export interface DiscordState {
  /** category → ISO time the mute ends */
  mutes: Partial<Record<StaffCategory, string>>;
  commands: { hash: string; at: string } | null;
  commandsError: { at: string; message: string } | null;
  lastError: { at: string; message: string } | null;
  lastDeliveredAt: string | null;
  digest: { date: string; at: string } | null;
}

const EMPTY_STATE: DiscordState = {
  mutes: {},
  commands: null,
  commandsError: null,
  lastError: null,
  lastDeliveredAt: null,
  digest: null,
};

export async function discordStateTx(tx: Sql, forUpdate = false): Promise<DiscordState> {
  const rows = forUpdate
    ? await tx<{ value: Partial<DiscordState> }[]>`
        select value from control_settings where key = 'discord_state' for update
      `
    : await tx<{ value: Partial<DiscordState> }[]>`
        select value from control_settings where key = 'discord_state'
      `;
  return { ...EMPTY_STATE, ...(rows[0]?.value ?? {}) };
}

/** Read-modify-write under the row lock — the job and an interaction may both write. */
export async function updateDiscordStateTx(
  tx: Sql,
  change: (s: DiscordState) => Partial<DiscordState>,
): Promise<DiscordState> {
  await tx`
    insert into control_settings (key, value) values ('discord_state', ${tx.json({} as never)})
    on conflict (key) do nothing
  `;
  const cur = await discordStateTx(tx, true);
  const next = { ...cur, ...change(cur) };
  await tx`
    update control_settings set value = ${tx.json(next as never)} where key = 'discord_state'
  `;
  return next;
}

export function updateDiscordState(
  sql: Sql,
  change: (s: DiscordState) => Partial<DiscordState>,
): Promise<DiscordState> {
  return controlTx(sql, (tx) => updateDiscordStateTx(tx, change));
}

export function mutedUntil(
  state: DiscordState,
  category: StaffCategory,
  now = Date.now(),
): string | null {
  const until = state.mutes[category];
  return until && new Date(until).getTime() > now ? until : null;
}

export interface DiscordContext {
  app: DiscordAppStatus;
  setting: DiscordSetting;
  state: DiscordState;
  /** CRM base for deep links (`…/control/#/pipeline/<id>`) */
  crmBase: string;
}

export async function discordContextTx(tx: Sql): Promise<DiscordContext> {
  const [row, stored, state, meeting] = await Promise.all([
    getIntegrationTx(tx, 'discord'),
    getSettingTx<unknown>(tx, 'discord', {}),
    discordStateTx(tx),
    meetingConfigTx(tx),
  ]);
  return {
    app: discordAppOf(row),
    setting: discordSettingOf(stored),
    state,
    // the CRM and the booking page share one host (apps/control/nginx.conf)
    crmBase: meeting.publicBaseUrl,
  };
}

export function discordContext(sql: Sql): Promise<DiscordContext> {
  return controlTx(sql, discordContextTx);
}

export const crmLink = (base: string, path: string) => `${base}/control/#${path}`;

/** Duá's poses for the cards, on a cream tile so the forest green survives Discord's dark theme
 * (apps/control/public/discord, cut from brand/mascote). Served with the CRM, from Core. */
export const DUA_POSES = [
  'avatar-ajuda',
  'avatar-feliz',
  'boas-vindas',
  'erro',
  'horarios',
  'offline',
  'pagamento',
  'publicar',
  'seguranca',
  'sucesso',
] as const;
export type DuaPose = (typeof DUA_POSES)[number];
export const artLink = (base: string, pose: DuaPose) => `${base}/control/discord/${pose}.webp`;
