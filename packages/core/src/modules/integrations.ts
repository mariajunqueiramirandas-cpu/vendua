import { ANTHROPIC_MODEL, EFFORTS, isEffort } from '../platform/anthropic.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError, str } from '../platform/http.ts';
import { claimControl, controlTx, type ClaimResult } from './control.ts';
import { emitControlEvent } from './control-events.ts';
import { LEAD_STATES, type LeadState } from './leads.ts';
import { JOB_KINDS } from '../agent/tool-meta.ts';
import { normalizeStaff } from './staff-config.ts';
import { validateDiscordConfig, validateDiscordSetting } from './discord/config.ts';
import { validateMediaRoutes } from '../vendedor/media.ts';

// modular provider config: `secret_ref` is the NAME of the env var holding the
// credential — secret values never enter the DB

export const INTEGRATION_KINDS = [
  'llm',
  'email',
  'whatsapp',
  'instagram',
  'discovery',
  'discord',
] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

// driver names per kind — the API and the driver registry agree here
export const DRIVERS: Record<IntegrationKind, readonly string[]> = {
  llm: ['gemini', 'openrouter', 'anthropic', 'openai', 'mock'],
  email: ['resend', 'log'],
  whatsapp: ['baileys', 'log'],
  instagram: ['sidecar', 'log'],
  discovery: ['tinyfish', 'mock'],
  discord: ['bot'],
};

// fallback env var per driver when secret_ref is null — mirrors the drivers'
// `?? process.env.X` fallback so the UI reports what's actually in effect
export const DEFAULT_SECRET: Record<string, string> = {
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  resend: 'RESEND_API_KEY',
  tinyfish: 'TINYFISH_API_KEY',
  sidecar: 'IG_SIDECAR_SECRET',
  bot: 'DISCORD_BOT_TOKEN',
};

// drivers that read `(env[ref]) ?? env[DEFAULT]` — a configured-but-missing
// ref still authenticates via the default; LLM drivers are strict
const SECRET_FALLBACK: ReadonlySet<string> = new Set(['resend', 'tinyfish', 'sidecar', 'bot']);

export interface IntegrationRow {
  id: string;
  kind: IntegrationKind;
  driver: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secret_ref: string | null;
  created_at: string;
  updated_at: string;
}

// API view — secret names only, never values
export function integrationJson(row: IntegrationRow) {
  // the var the driver actually reads: fallbackable drivers report the default
  // when the custom ref is unset; `!== undefined` because an EMPTY custom var
  // is what the driver reads
  const secretName =
    row.secret_ref &&
    (process.env[row.secret_ref] !== undefined || !SECRET_FALLBACK.has(row.driver))
      ? row.secret_ref
      : (DEFAULT_SECRET[row.driver] ?? row.secret_ref ?? null);
  const present = secretName ? !!process.env[secretName] : null;
  return {
    id: row.id,
    kind: row.kind,
    driver: row.driver,
    enabled: row.enabled,
    config: row.config ?? {},
    secretRef: row.secret_ref,
    secretName,
    secretPresent: present,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listIntegrations(sql: Sql) {
  const rows = await controlTx(
    sql,
    (tx) => tx<IntegrationRow[]>`select * from control_integrations order by kind, driver`,
  );
  return rows.map(integrationJson);
}

export async function getIntegration(
  sql: Sql,
  kind: IntegrationKind,
): Promise<IntegrationRow | null> {
  return controlTx(sql, (tx) => getIntegrationTx(tx, kind));
}

// tx-local — the enabled row is THE provider; `sql.begin` doesn't exist on tx handles
export async function getIntegrationTx(
  tx: Sql,
  kind: IntegrationKind,
): Promise<IntegrationRow | null> {
  const rows = await tx<IntegrationRow[]>`
    select * from control_integrations
    where kind = ${kind} and enabled order by updated_at desc limit 1
  `;
  return rows[0] ?? null;
}

export function integrationKind(v: unknown): IntegrationKind {
  if (typeof v !== 'string' || !(INTEGRATION_KINDS as readonly string[]).includes(v)) {
    throw new HttpError(
      422,
      'INVALID_KIND',
      `kind must be one of: ${INTEGRATION_KINDS.join(', ')}`,
    );
  }
  return v as IntegrationKind;
}

export async function upsertIntegration(
  sql: Sql,
  input: {
    kind: IntegrationKind;
    driver: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
    secretRef?: string | null;
  },
  idemKey: string,
): Promise<ClaimResult<{ integration: ReturnType<typeof integrationJson> }>> {
  const kind = input.kind;
  const driver = str(input.driver, 'driver', 60);
  if (!DRIVERS[kind].includes(driver)) {
    throw new HttpError(
      422,
      'INVALID_DRIVER',
      `driver must be one of: ${DRIVERS[kind].join(', ')}`,
      {
        field: 'driver',
      },
    );
  }
  if (
    input.config !== undefined &&
    (typeof input.config !== 'object' || input.config === null || Array.isArray(input.config))
  ) {
    throw new HttpError(422, 'BAD_REQUEST', 'config must be an object', { field: 'config' });
  }
  if (kind === 'discord' && input.config) validateDiscordConfig(input.config);
  if (kind === 'llm' && driver === 'anthropic' && input.config)
    validateAnthropicConfig(input.config);
  const secretRef =
    input.secretRef === undefined || input.secretRef === null
      ? null
      : str(input.secretRef, 'secretRef', 120);
  if (secretRef && !/^[A-Z_][A-Z0-9_]*$/.test(secretRef)) {
    throw new HttpError(422, 'BAD_REQUEST', 'secretRef must be an env var name (UPPER_SNAKE)', {
      field: 'secretRef',
    });
  }
  const res = await claimControl(sql, idemKey, async (tx) => {
    const rows = await tx<IntegrationRow[]>`
      insert into control_integrations (kind, driver, enabled, config, secret_ref)
      values (${kind}, ${driver}, ${input.enabled ?? false}, ${tx.json((input.config ?? {}) as never)}, ${secretRef})
      on conflict (kind, driver) do update set
        config = excluded.config,
        secret_ref = excluded.secret_ref,
        -- enabled only changes when the caller passes it explicitly.
        enabled = case when ${input.enabled !== undefined}
          then excluded.enabled else control_integrations.enabled end,
        updated_at = now()
      returning *
    `;
    // One enabled driver per kind: enabling this one clears the others.
    if (input.enabled === true) {
      await tx`
        update control_integrations set enabled = false
        where kind = ${kind} and driver <> ${driver}
      `;
      await tx`update control_integrations set enabled = true where id = ${rows[0]!.id}`;
      rows[0]!.enabled = true;
    } else if (input.enabled === false) {
      rows[0]!.enabled = false;
    }
    return { status: 200, body: { integration: integrationJson(rows[0]!) } };
  });
  // a driver/enable flip changes what the channel's health cards and live socket do
  if (!res.replayed && (kind === 'whatsapp' || kind === 'email' || kind === 'instagram')) {
    emitControlEvent('channel.health', kind);
  }
  return res;
}

export const DEFAULT_GUARDRAILS = {
  /** agent sends to one lead in 24h *without an answer*: a lead reply resets the
   *  count, so an active negotiation is never capped; 0 = no cap */
  maxOutboundPerLeadPerDay: 3,
  /** false = no quiet window at all (quietStart/quietEnd kept for when it's back on) */
  quietHoursEnabled: true,
  quietStart: '21:00',
  quietEnd: '08:00',
  timezone: 'America/Sao_Paulo',
  /** a discovered lead ≥ discoveryContactMinScore with a phone channel gets an
   *  outreach run (the autonomy preset still decides draft vs send) */
  discoveryAutoContact: true,
  discoveryContactMinScore: 8,
  /** reply run is queued with run_at = now() + N min; 0 = answer at once */
  inboundReplyDelayMin: 0,
  /** staff-created lead's outreach run is scheduled N min after create;
   *  0 = fire at once but draft-only */
  firstContactDelayMin: 0,
  /** after an agent send with no reply, book a follow-up N days out on the lead's
   *  agenda unless something is already there; 0 = off */
  followupCadenceDays: 2,
  /** approving a draft older than N days supersedes it and recomposes against
   *  current state; 0 = approve always sends */
  staleDraftDays: 7,
  /** a brief whose last N runs produced zero leads auto-pauses; 0 = never */
  briefAutoPauseRuns: 5,
  /** account-wide cap on agent cold DMs (instagram threads the lead never wrote
   *  in) per rolling 24h — new accounts get restricted above a few dozen */
  instagramColdDmsPerDay: 15,
  /** retired: team numbers now come from the `staff` setting (blockedPhonesTx);
   *  entries still stored here keep being honored */
  ignoredPhones: [] as string[],
  /** per-lead agent spend ceiling (USD): ≥ cap refuses new runs and flags the
   *  card; 0 = uncapped */
  leadLifetimeCostCapUsd: 5,
} as const;

// canonical cap-usd → cap-cents for every enforcement site; ceil so a positive
// sub-cent cap still binds; ≤0 = uncapped
export function capCentsOf(g: Partial<Guardrails>): number {
  const usd = g.leadLifetimeCostCapUsd ?? DEFAULT_GUARDRAILS.leadLifetimeCostCapUsd;
  return usd <= 0 ? 0 : Math.ceil(usd * 100);
}

export type Guardrails = {
  maxOutboundPerLeadPerDay: number;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  timezone: string;
  discoveryAutoContact: boolean;
  discoveryContactMinScore: number;
  inboundReplyDelayMin: number;
  firstContactDelayMin: number;
  followupCadenceDays: number;
  staleDraftDays: number;
  briefAutoPauseRuns: number;
  instagramColdDmsPerDay: number;
  ignoredPhones: string[];
  leadLifetimeCostCapUsd: number;
};

// digits-only match on both sides; entries need ≥6 digits to be meaningful
export function phoneDigits(v: string): string {
  return v.replace(/\D/g, '');
}

export function phoneIsIgnored(
  ignored: readonly string[],
  ...candidates: (string | undefined | null)[]
): boolean {
  const set = new Set(ignored.map(phoneDigits).filter((d) => d.length >= 6));
  if (set.size === 0) return false;
  return candidates.some((c) => {
    if (!c) return false;
    const d = phoneDigits(c);
    return d.length >= 6 && set.has(d);
  });
}

export const DEFAULT_PITCH = {
  product:
    'Venduá: plataforma que coloca no ar, em poucos dias, a loja online própria de um pequeno negócio de comida, com catálogo, pedidos e pagamento integrados.',
  audience:
    'donos de pequenos negócios de comida no Brasil (docerias, confeitarias, marmitas, pizzarias, padarias, lanchonetes) que hoje vendem por WhatsApp, Instagram ou marketplace',
  tone: 'direto e caloroso, como um bom vendedor brasileiro no WhatsApp: mensagens curtas, português falado, zero formalidade de e-mail',
  offerRange:
    'nenhuma condição especial pré-aprovada: desconto, teste grátis, prazo ou exceção são decisão da equipe, então escale para humano',
  /** the only commercial claims the agent may state verbatim; empty = nothing may be quoted */
  offer: '',
  goal: 'entender o negócio da pessoa e levar a um próximo passo real: uma conversa curta com a equipe',
} as const;

/** default `agent.instructions` (policy.ts) — the standing rules every run carries */
export const DEFAULT_AGENT_RULES = [
  'nunca invente funcionalidades, prazos, preços ou resultados',
  'nunca pressione quem disse não ou pediu para parar',
  'uma mensagem curta por vez, com no máximo uma pergunta; sem listas nem jargão',
  'não se identifique como IA a menos que perguntem; se perguntarem, seja honesto',
] as const;

export type Pitch = typeof DEFAULT_PITCH;

/** The agent mode a lead starts in when nobody on staff picked one. 'auto' follows the
 *  workspace autonomy level; 'draft' holds every message on that lead for approval. */
export type LeadStartMode = 'draft' | 'auto';
export interface NewLeadModes {
  /** a lead minted by an inbound message (they wrote to us first) */
  inbound: LeadStartMode;
  /** a lead the agent created (discovery) */
  discovery: LeadStartMode;
}
export const DEFAULT_NEW_LEAD_MODES: NewLeadModes = { inbound: 'auto', discovery: 'auto' };

/** `agent.newLeadMode` with defaults — lives here, not in policy.ts, so the inbound path can read it. */
export function newLeadModesOf(agentSetting: unknown): NewLeadModes {
  const raw = (agentSetting as { newLeadMode?: unknown } | null)?.newLeadMode;
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const pick = (v: unknown, d: LeadStartMode): LeadStartMode =>
    v === 'draft' || v === 'auto' ? v : d;
  return {
    inbound: pick(o.inbound, DEFAULT_NEW_LEAD_MODES.inbound),
    discovery: pick(o.discovery, DEFAULT_NEW_LEAD_MODES.discovery),
  };
}

/** What the pairing-time WhatsApp history sync may do. Defaults keep the original
 *  behavior: every DM chat in the phone becomes a lead. */
export interface WhatsappHistory {
  /** 'leads' = unknown contacts become leads; 'existing' = only attach to leads we
   *  already have; 'off' = drop the history entirely */
  mode: 'leads' | 'existing' | 'off';
  /** skip messages older than N days; 0 = no limit */
  maxAgeDays: number;
  /** agent mode for a lead minted from history — 'inbound' follows agent.newLeadMode.inbound.
   *  Old chats are often friends/clients, so 'off' keeps the agent away until staff opts in. */
  leadMode: 'inbound' | 'draft' | 'off';
}
export const DEFAULT_WHATSAPP_HISTORY: WhatsappHistory = {
  mode: 'leads',
  maxAgeDays: 0,
  leadMode: 'inbound',
};
const WA_HISTORY_MODES = ['leads', 'existing', 'off'] as const;
const WA_HISTORY_LEAD_MODES = ['inbound', 'draft', 'off'] as const;
export const WA_HISTORY_MAX_AGE_DAYS = 3650;

/** `whatsapp_history` with defaults — bad fields fall back instead of breaking ingest. */
export function whatsappHistoryOf(stored: unknown): WhatsappHistory {
  const o =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const d = DEFAULT_WHATSAPP_HISTORY;
  const age = o.maxAgeDays;
  return {
    mode: (WA_HISTORY_MODES as readonly unknown[]).includes(o.mode)
      ? (o.mode as WhatsappHistory['mode'])
      : d.mode,
    maxAgeDays:
      typeof age === 'number' && Number.isInteger(age) && age >= 0 && age <= WA_HISTORY_MAX_AGE_DAYS
        ? age
        : d.maxAgeDays,
    leadMode: (WA_HISTORY_LEAD_MODES as readonly unknown[]).includes(o.leadMode)
      ? (o.leadMode as WhatsappHistory['leadMode'])
      : d.leadMode,
  };
}

// shared bound — validateSetting, the `remember` tool and the discovery debrief all truncate to this
export const AGENT_MEMORY_MAX_FACTS = 100;

// stage close-probabilities; the 'forecast' setting stores overrides under `probabilities`
export const DEFAULT_FORECAST_PROBABILITIES: Record<LeadState, number> = {
  lead: 0.05,
  contacted: 0.2,
  invited: 0.6,
  live: 1,
};

// defaults merged with the stored row; unknown/out-of-range keys ignored so a
// hand-edited row can't poison the math
export function forecastProbabilities(stored: unknown): Record<LeadState, number> {
  const out = { ...DEFAULT_FORECAST_PROBABILITIES };
  const p = (stored as { probabilities?: unknown } | null)?.probabilities;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    for (const st of LEAD_STATES) {
      const v = (p as Record<string, unknown>)[st];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) out[st] = v;
    }
  }
  return out;
}

// tx-local read inside an existing control tx
export async function getForecastConfigTx(tx: Sql): Promise<Record<LeadState, number>> {
  return forecastProbabilities(await getSettingTx<unknown>(tx, 'forecast', null));
}

export async function getSetting<T>(sql: Sql, key: string, fallback: T): Promise<T> {
  return controlTx(sql, (tx) => getSettingTx(tx, key, fallback));
}

// tx-local — call inside an existing control tx
export async function getSettingTx<T>(tx: Sql, key: string, fallback: T): Promise<T> {
  const rows = await tx<{ value: T }[]>`select value from control_settings where key = ${key}`;
  return (rows[0]?.value as T | undefined) ?? fallback;
}

export async function getGuardrails(sql: Sql): Promise<Guardrails> {
  const stored = await getSetting(sql, 'guardrails', {} as Partial<Guardrails>);
  return { ...DEFAULT_GUARDRAILS, ...stored };
}

export async function getPitch(sql: Sql): Promise<Pitch> {
  const stored = await getSetting(sql, 'pitch', {} as Partial<Pitch>);
  return { ...DEFAULT_PITCH, ...stored };
}

// the CRM agent's anthropic driver: the model is fixed, effort is the choice
function validateAnthropicConfig(config: Record<string, unknown>) {
  const bad = (field: string, why: string) =>
    new HttpError(422, 'BAD_REQUEST', `config.${field} ${why}`, { field: `config.${field}` });
  if (config.model !== undefined && config.model !== ANTHROPIC_MODEL)
    throw bad('model', `is fixed: anthropic runs ${ANTHROPIC_MODEL} (leave it out)`);
  if (config.effort !== undefined && !isEffort(config.effort))
    throw bad('effort', `must be ${EFFORTS.join(' | ')}`);
}

// ── agent_runtime.routes / agent_runtime.budgets (Agent Runtime v3, read by agent-host/models.ts
// and agent-host/spend.ts): staff edit them in the CRM's IA hub, so every shape is checked here
const RUNTIME_KEY = /^[a-z0-9_-]{1,60}$/;
// lowercase: spend.ts and models.ts look stores up by the id Postgres prints
const TENANT_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROUTE_PROVIDERS = ['anthropic', 'openrouter', 'openai', 'gemini'];
const ROUTE_MODEL = /^[A-Za-z0-9._/:@-]{1,200}$/;
type Bad = (field: string, why: string) => HttpError;

const plainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function validateRoute(r: unknown, at: string, bad: Bad) {
  if (!plainObject(r)) throw bad(at, 'must be a route object');
  for (const k of Object.keys(r))
    if (!['provider', 'model', 'zdr', 'endpoint', 'effort', 'pricing', 'timeoutMs'].includes(k))
      throw bad(`${at}.${k}`, 'is not a route field');
  if (!ROUTE_PROVIDERS.includes(r.provider as string))
    throw bad(`${at}.provider`, `must be ${ROUTE_PROVIDERS.join(' | ')}`);
  if (typeof r.model !== 'string' || !ROUTE_MODEL.test(r.model))
    throw bad(`${at}.model`, 'must be 1–200 characters of A–Z a–z 0–9 . _ / : @ -');
  if (r.provider === 'anthropic') {
    // models.ts runs and prices every anthropic route as ANTHROPIC_MODEL; say so instead
    if (r.model !== ANTHROPIC_MODEL)
      throw bad(`${at}.model`, `is fixed for anthropic: ${ANTHROPIC_MODEL}`);
    if (r.pricing !== undefined)
      throw bad(`${at}.pricing`, 'is fixed for anthropic (leave it out)');
  }
  if (r.effort !== undefined) {
    if (r.provider !== 'anthropic') throw bad(`${at}.effort`, 'is only for the anthropic provider');
    if (!isEffort(r.effort)) throw bad(`${at}.effort`, `must be ${EFFORTS.join(' | ')}`);
  }
  // a per-route choice since 2026-10-05 (default on in the CRM), but never left implicit
  if (typeof r.zdr !== 'boolean') throw bad(`${at}.zdr`, 'must be true or false');
  if (r.endpoint !== undefined) {
    if (r.provider !== 'openrouter')
      throw bad(`${at}.endpoint`, 'is only for the openrouter provider');
    if (typeof r.endpoint !== 'string' || !ROUTE_MODEL.test(r.endpoint))
      throw bad(`${at}.endpoint`, 'must be 1–200 characters of A–Z a–z 0–9 . _ / : @ -');
  }
  if (r.pricing !== undefined) {
    const p = r.pricing;
    if (!plainObject(p)) throw bad(`${at}.pricing`, 'must be an object');
    for (const k of Object.keys(p))
      if (!['inputPerMTok', 'outputPerMTok', 'cacheReadPerMTok', 'cacheWritePerMTok'].includes(k))
        throw bad(`${at}.pricing.${k}`, 'is not a pricing field');
    for (const k of ['inputPerMTok', 'outputPerMTok', 'cacheReadPerMTok', 'cacheWritePerMTok']) {
      const n = p[k];
      const optional = k.startsWith('cache');
      if (n === undefined && optional) continue;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1000)
        throw bad(`${at}.pricing.${k}`, 'must be a number in [0, 1000] (USD per million tokens)');
    }
  }
  if (r.timeoutMs !== undefined) {
    const t = r.timeoutMs;
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 1000 || t > 300_000)
      throw bad(`${at}.timeoutMs`, 'must be an integer in [1000, 300000]');
  }
}

function validateTierRoutes(v: unknown, at: string, bad: Bad) {
  if (!plainObject(v)) throw bad(at, 'must be { fast?, strong? }');
  for (const [tier, list] of Object.entries(v)) {
    if (tier !== 'fast' && tier !== 'strong')
      throw bad(`${at}.${tier}`, 'is not a tier (fast | strong)');
    // an empty list would win over the levels below it and leave the agent with no model
    if (!Array.isArray(list) || list.length < 1 || list.length > 5)
      throw bad(`${at}.${tier}`, 'must be a list of 1 to 5 routes (leave the tier out to inherit)');
    list.forEach((r, i) => validateRoute(r, `${at}.${tier}.${i}`, bad));
  }
}

function validateKeyed(
  v: unknown,
  at: string,
  max: number,
  key: RegExp,
  what: string,
  bad: Bad,
): Record<string, unknown> {
  if (!plainObject(v)) throw bad(at, 'must be an object');
  const keys = Object.keys(v);
  if (keys.length > max) throw bad(at || '*', `takes at most ${max} entries`);
  for (const k of keys)
    if (!key.test(k)) throw bad(at ? `${at}.${k}` : k, `must be keyed by ${what}`);
  return v;
}

function validateModelRoutes(value: unknown, bad: Bad) {
  if (!plainObject(value)) throw bad('*', 'must be an object');
  for (const k of Object.keys(value))
    if (!['default', 'agents', 'tenants'].includes(k)) throw bad(k, 'is not a routes field');
  if (value.default !== undefined) validateTierRoutes(value.default, 'default', bad);
  if (value.agents !== undefined) {
    const agents = validateKeyed(value.agents, 'agents', 20, RUNTIME_KEY, 'agent id', bad);
    for (const [k, v] of Object.entries(agents)) validateTierRoutes(v, `agents.${k}`, bad);
  }
  if (value.tenants !== undefined) {
    const tenants = validateKeyed(value.tenants, 'tenants', 2000, TENANT_KEY, 'store id', bad);
    for (const [k, v] of Object.entries(tenants)) validateTierRoutes(v, `tenants.${k}`, bad);
  }
}

function validateUsdByKey(v: unknown, at: string, bad: Bad) {
  const o = validateKeyed(v, at, 20, RUNTIME_KEY, 'budget key', bad);
  for (const [k, n] of Object.entries(o)) {
    const field = at ? `${at}.${k}` : k;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10_000)
      throw bad(field, 'must be a number in [0, 10000] (USD per day)');
  }
}

function validateBudgets(value: unknown, bad: Bad) {
  if (!plainObject(value)) throw bad('*', 'must be an object');
  const { tenants, ...keys } = value;
  validateUsdByKey(keys, '', bad);
  if (tenants !== undefined) {
    const t = validateKeyed(tenants, 'tenants', 2000, TENANT_KEY, 'store id', bad);
    for (const [k, v] of Object.entries(t)) validateUsdByKey(v, `tenants.${k}`, bad);
  }
}

// write-time validation for the settings the safety layer reads — a malformed
// guardrails object must never silently disable the caps; unknown keys pass
export function validateSetting(key: string, value: unknown): void {
  const bad = (field: string, why: string) =>
    new HttpError(422, 'BAD_REQUEST', `settings.${key}.${field} ${why}`, { field });

  if (key === 'agent_runtime.routes') {
    validateModelRoutes(value, bad);
    return;
  }
  if (key === 'agent_runtime.budgets') {
    validateBudgets(value, bad);
    return;
  }
  if (key === 'agent_runtime.media_routes') {
    validateMediaRoutes(value, bad);
    return;
  }
  if (key === 'signup') {
    const v = value as Record<string, unknown> | null;
    if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.enabled !== 'boolean')
      throw bad('enabled', 'must be true or false');
    if (Object.keys(v).some((k) => k !== 'enabled')) throw bad('*', 'only takes enabled');
    return;
  }
  if (key === 'guardrails') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw bad('*', 'must be an object');
    }
    const v = value as Record<string, unknown>;
    const intField = (k: keyof Guardrails, min: number, max: number) => {
      if (v[k] === undefined) return;
      const n = v[k];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
        throw bad(k, `must be an integer in [${min}, ${max}]`);
      }
    };
    intField('maxOutboundPerLeadPerDay', 0, 100);
    intField('discoveryContactMinScore', 1, 10);
    intField('inboundReplyDelayMin', 0, 1440);
    intField('firstContactDelayMin', 0, 10080);
    intField('followupCadenceDays', 0, 90);
    intField('staleDraftDays', 0, 90);
    intField('briefAutoPauseRuns', 0, 100);
    intField('instagramColdDmsPerDay', 0, 200);
    const numField = (k: keyof Guardrails, min: number, max: number) => {
      if (v[k] === undefined) return;
      const n = v[k];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
        throw bad(k, `must be a number in [${min}, ${max}]`);
      }
    };
    numField('leadLifetimeCostCapUsd', 0, 1000);
    for (const k of ['quietStart', 'quietEnd'] as const) {
      if (v[k] === undefined) continue;
      const t = v[k];
      if (typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
        throw bad(k, 'must be HH:MM (00:00–23:59)');
      }
    }
    if (v.timezone !== undefined) {
      const tz = v.timezone;
      if (typeof tz !== 'string' || !tz.trim() || tz.length > 80) {
        throw bad('timezone', 'must be an IANA name');
      }
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
      } catch {
        throw bad('timezone', `unknown IANA timezone '${tz}'`);
      }
    }
    if (v.quietHoursEnabled !== undefined && typeof v.quietHoursEnabled !== 'boolean') {
      throw bad('quietHoursEnabled', 'must be a boolean');
    }
    if (v.discoveryAutoContact !== undefined && typeof v.discoveryAutoContact !== 'boolean') {
      throw bad('discoveryAutoContact', 'must be a boolean');
    }
    if (v.ignoredPhones !== undefined) {
      if (!Array.isArray(v.ignoredPhones) || v.ignoredPhones.length > 100) {
        throw bad('ignoredPhones', 'must be an array of ≤100 phone numbers');
      }
      for (const p of v.ignoredPhones) {
        const d = typeof p === 'string' ? p.replace(/\D/g, '') : '';
        if (typeof p !== 'string' || p.length > 40 || d.length < 6 || d.length > 15) {
          throw bad('ignoredPhones', 'each entry must be a phone number (6–15 digits)');
        }
      }
    }
    return;
  }

  if (key === 'pitch') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw bad('*', 'must be an object');
    }
    const v = value as Record<string, unknown>;
    for (const k of ['product', 'audience', 'tone', 'offerRange', 'offer', 'goal'] as const) {
      if (v[k] === undefined) continue;
      if (typeof v[k] !== 'string' || (v[k] as string).length > 4000) {
        throw bad(k, 'must be a string (≤4000 chars)');
      }
    }
    return;
  }

  // 'meeting' booking config; URLs https-only so a prompt-injected
  // javascript:/data: URL can't ride out in an outbound message
  if (key === 'meeting') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw bad('*', 'must be an object');
    }
    const v = value as Record<string, unknown>;
    for (const k of ['bookingUrl', 'roomUrl', 'publicBaseUrl'] as const) {
      const u = v[k];
      if (u === undefined || u === null || u === '') continue;
      if (typeof u !== 'string' || u.length > 500) throw bad(k, 'must be a string (≤500 chars)');
      try {
        if (new URL(u).protocol !== 'https:') throw bad(k, 'must be https');
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw bad(k, 'must be a URL');
      }
    }
    if (v.tz !== undefined) {
      if (typeof v.tz !== 'string' || v.tz.length > 80) throw bad('tz', 'must be an IANA name');
      try {
        new Intl.DateTimeFormat('en', { timeZone: v.tz });
      } catch {
        throw bad('tz', `unknown IANA timezone '${v.tz}'`);
      }
    }
    const intField = (k: 'slotMinutes' | 'bufferMinutes' | 'horizonDays') => {
      const n = v[k];
      if (n === undefined || n === null) return undefined;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 240) {
        throw bad(k, 'must be an integer 0–240');
      }
      return n;
    };
    const slotMinutes = intField('slotMinutes');
    const bufferMinutes = intField('bufferMinutes');
    const horizonDays = intField('horizonDays');
    if (slotMinutes !== undefined && (slotMinutes < 5 || slotMinutes > 120)) {
      throw bad('slotMinutes', 'must be 5–120');
    }
    // normalizeMeetingConfig clamps to [0,180] — a wider value would silently read back different
    if (bufferMinutes !== undefined && bufferMinutes > 180) {
      throw bad('bufferMinutes', 'must be 0–180');
    }
    if (horizonDays !== undefined && (horizonDays < 1 || horizonDays > 60)) {
      throw bad('horizonDays', 'must be 1–60');
    }
    if (v.weekly !== undefined) {
      if (typeof v.weekly !== 'object' || v.weekly === null || Array.isArray(v.weekly)) {
        throw bad('weekly', 'must be { sun…sat: [[open, close], …] }');
      }
      for (const day of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) {
        const windows = (v.weekly as Record<string, unknown>)[day];
        if (windows === undefined) continue;
        if (!Array.isArray(windows) || windows.length > 6) {
          throw bad(`weekly.${day}`, 'must be an array of ≤6 [HH:MM, HH:MM] windows');
        }
        for (const w of windows) {
          const ok =
            Array.isArray(w) &&
            w.length === 2 &&
            w.every((t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
          if (!ok) throw bad(`weekly.${day}`, 'windows must be [HH:MM, HH:MM] pairs');
          if (w[0] >= w[1]) throw bad(`weekly.${day}`, 'window open must be before close');
        }
      }
    }
    return;
  }

  if (key === 'forecast') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw bad('*', 'must be an object');
    }
    const p = (value as { probabilities?: unknown }).probabilities;
    if (p === undefined) return;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      throw bad('probabilities', 'must be an object');
    }
    for (const [k, n] of Object.entries(p)) {
      if (!(LEAD_STATES as readonly string[]).includes(k)) {
        throw bad(
          `probabilities.${k}`,
          `unknown state — must be one of: ${LEAD_STATES.join(', ')}`,
        );
      }
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) {
        throw bad(`probabilities.${k}`, 'must be a number in [0, 1]');
      }
    }
    return;
  }

  if (key === 'staff') {
    normalizeStaff(value);
    return;
  }

  if (key === 'discord') {
    validateDiscordSetting(value);
    return;
  }

  if (key === 'whatsapp_history') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw bad('*', 'must be an object');
    }
    const v = value as Record<string, unknown>;
    for (const f of Object.keys(v)) {
      if (!['mode', 'maxAgeDays', 'leadMode'].includes(f)) throw bad(f, 'is not a history field');
    }
    if (v.mode !== undefined && !(WA_HISTORY_MODES as readonly unknown[]).includes(v.mode)) {
      throw bad('mode', `must be ${WA_HISTORY_MODES.join(' | ')}`);
    }
    if (
      v.leadMode !== undefined &&
      !(WA_HISTORY_LEAD_MODES as readonly unknown[]).includes(v.leadMode)
    ) {
      throw bad('leadMode', `must be ${WA_HISTORY_LEAD_MODES.join(' | ')}`);
    }
    const age = v.maxAgeDays;
    if (
      age !== undefined &&
      (typeof age !== 'number' ||
        !Number.isInteger(age) ||
        age < 0 ||
        age > WA_HISTORY_MAX_AGE_DAYS)
    ) {
      throw bad('maxAgeDays', `must be an integer in [0, ${WA_HISTORY_MAX_AGE_DAYS}]`);
    }
    return;
  }

  // retired: the daily summary is Discord's (`discord.digest`), staff hear nothing by email
  if (key === 'digest') throw bad('*', 'is retired: the daily summary is set in settings.discord');

  if (key === 'agent') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw bad('*', 'must be an object');
    }
    const v = value as Record<string, unknown>;
    for (const f of Object.keys(v)) {
      if (
        ![
          'level',
          'jobs',
          'instructions',
          'weeklyDiscoveryUsd',
          'schedule',
          'newLeadMode',
        ].includes(f)
      )
        throw bad(f, 'is not an agent field');
    }
    if (!['off', 'copilot', 'supervised', 'autopilot'].includes(v.level as string)) {
      throw bad('level', 'must be off | copilot | supervised | autopilot');
    }
    if (v.jobs !== undefined) {
      if (!v.jobs || typeof v.jobs !== 'object' || Array.isArray(v.jobs)) {
        throw bad('jobs', 'must be an object');
      }
      for (const [k, on] of Object.entries(v.jobs as Record<string, unknown>)) {
        if (k === 'triage' || !(JOB_KINDS as readonly string[]).includes(k))
          throw bad(`jobs.${k}`, 'is not an automatic job');
        if (typeof on !== 'boolean') throw bad(`jobs.${k}`, 'must be a boolean');
      }
    }
    if (
      v.instructions !== undefined &&
      (typeof v.instructions !== 'string' || v.instructions.length > 8000)
    ) {
      throw bad('instructions', 'must be a string (≤8000 chars)');
    }
    if (v.newLeadMode !== undefined) {
      const m = v.newLeadMode;
      if (!m || typeof m !== 'object' || Array.isArray(m))
        throw bad('newLeadMode', 'must be an object');
      for (const [k, x] of Object.entries(m as Record<string, unknown>)) {
        if (k !== 'inbound' && k !== 'discovery')
          throw bad(`newLeadMode.${k}`, 'is not a lead origin');
        if (x !== 'draft' && x !== 'auto') throw bad(`newLeadMode.${k}`, 'must be draft | auto');
      }
    }
    const usd = v.weeklyDiscoveryUsd;
    if (
      usd !== undefined &&
      (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0 || usd > 50)
    ) {
      throw bad('weeklyDiscoveryUsd', 'must be a number in [0, 50]');
    }
    if (v.schedule !== undefined) {
      if (!v.schedule || typeof v.schedule !== 'object' || Array.isArray(v.schedule)) {
        throw bad('schedule', 'must be an object');
      }
      const bounds: Record<string, number> = { discoveryHour: 23, weeklyDay: 6, weeklyHour: 23 };
      for (const [k, x] of Object.entries(v.schedule as Record<string, unknown>)) {
        const max = bounds[k];
        if (max === undefined) throw bad(`schedule.${k}`, 'is not a schedule field');
        if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > max) {
          throw bad(`schedule.${k}`, `must be an integer in [0, ${max}]`);
        }
      }
    }
    return;
  }

  if (key === 'agent_memory') {
    const v = value as { facts?: unknown } | null;
    if (!v || typeof v !== 'object' || !Array.isArray(v.facts)) {
      throw bad('facts', 'must be { facts: string[] }');
    }
    if (
      v.facts.length > AGENT_MEMORY_MAX_FACTS ||
      v.facts.some((f) => typeof f !== 'string' || f.length > 500)
    ) {
      throw bad('facts', `must be ≤${AGENT_MEMORY_MAX_FACTS} strings of ≤500 chars`);
    }
  }
}

export async function putSetting(
  sql: Sql,
  key: string,
  value: unknown,
  idemKey: string,
): Promise<ClaimResult<{ key: string; value: unknown }>> {
  str(key, 'key', 80);
  if (typeof value !== 'object' || value === null) {
    throw new HttpError(422, 'BAD_REQUEST', 'value must be an object');
  }
  const res = await claimControl(sql, idemKey, async (tx) => {
    await tx`
      insert into control_settings (key, value) values (${key}, ${tx.json(value as never)})
      on conflict (key) do update set value = excluded.value
    `;
    return { status: 200, body: { key, value } };
  });
  // meeting window changes alter the availability grid
  if (!res.replayed && key === 'meeting') emitControlEvent('meeting.change');
  return res;
}

export async function listSettings(sql: Sql) {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ key: string; value: unknown }[]>`select * from control_settings order by key`,
  );
  return rows;
}
