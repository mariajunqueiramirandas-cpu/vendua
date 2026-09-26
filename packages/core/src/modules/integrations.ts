import type { Sql } from '../platform/db.ts';
import { HttpError, str } from '../platform/http.ts';
import { claimControl, controlTx, type ClaimResult } from './control.ts';
import { emitControlEvent } from './control-events.ts';
import { LEAD_STATES, type LeadState } from './leads.ts';
import { JOB_KINDS } from '../agent/tool-meta.ts';

// modular provider config: `secret_ref` is the NAME of the env var holding the
// credential — secret values never enter the DB

export const INTEGRATION_KINDS = ['llm', 'email', 'whatsapp', 'instagram', 'discovery'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

// driver names per kind — the API and the driver registry agree here
export const DRIVERS: Record<IntegrationKind, readonly string[]> = {
  llm: ['gemini', 'openrouter', 'anthropic', 'openai', 'mock'],
  email: ['resend', 'log'],
  whatsapp: ['baileys', 'log'],
  instagram: ['sidecar', 'log'],
  discovery: ['tinyfish', 'mock'],
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
};

// drivers that read `(env[ref]) ?? env[DEFAULT]` — a configured-but-missing
// ref still authenticates via the default; LLM drivers are strict
const SECRET_FALLBACK: ReadonlySet<string> = new Set(['resend', 'tinyfish', 'sidecar']);

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
  maxOutboundPerLeadPerDay: 3,
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
  /** staff/founder numbers the agent never touches — compared on digits */
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
    'Venduá — plataforma que cria uma loja online própria para pequenos negócios de comida (docerias, marmitas, pizzarias) em poucos dias, com catálogo, pedidos e checkout integrados.',
  audience: 'donos de pequenos negócios de alimentação no Brasil',
  tone: 'direto, caloroso, português brasileiro, mensagens curtas estilo WhatsApp',
  offerRange:
    'pode oferecer teste gratuito e desconto de lançamento; nunca prometa preço final nem isenção — escale para humano quando pedirem desconto além do lançamento',
  /** the only commercial claims the agent may state verbatim; empty = nothing may be quoted */
  offer: '',
  goal: 'descobrir interesse e marcar uma conversa curta ou pedido de demonstração',
} as const;

/** default `agent.instructions` (policy.ts) — the standing rules every run carries */
export const DEFAULT_AGENT_RULES = [
  'nunca invente funcionalidades, prazos ou preços',
  'nunca pressione quem disse não ou pediu para parar',
  'uma mensagem por vez; sem listas longas ou jargão',
  'não se identifique como IA a menos que perguntem — e se perguntarem, seja honesto',
] as const;

export type Pitch = typeof DEFAULT_PITCH;

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

// write-time validation for the settings the safety layer reads — a malformed
// guardrails object must never silently disable the caps; unknown keys pass
export function validateSetting(key: string, value: unknown): void {
  const bad = (field: string, why: string) =>
    new HttpError(422, 'BAD_REQUEST', `settings.${key}.${field} ${why}`, { field });

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
    intField('maxOutboundPerLeadPerDay', 1, 100);
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

  // 'digest' daily staff email; `to` is the only staff-address field
  if (key === 'digest') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw bad('*', 'must be an object');
    }
    const v = value as Record<string, unknown>;
    if (v.enabled !== undefined && typeof v.enabled !== 'boolean') {
      throw bad('enabled', 'must be a boolean');
    }
    if (v.hour !== undefined) {
      if (typeof v.hour !== 'number' || !Number.isInteger(v.hour) || v.hour < 0 || v.hour > 23) {
        throw bad('hour', 'must be an integer 0–23');
      }
    }
    if (v.to !== undefined) {
      if (typeof v.to !== 'string' || v.to.length > 320) {
        throw bad('to', 'must be a string (≤320 chars)');
      }
      if (v.to !== v.to.trim()) {
        throw bad('to', 'must not have surrounding whitespace');
      }
      if (v.to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.to)) {
        throw bad('to', 'must be an email address');
      }
    }
    if (v.enabled === true && !v.to) {
      throw bad('to', 'is required when the digest is enabled');
    }
    return;
  }

  if (key === 'agent') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw bad('*', 'must be an object');
    }
    const v = value as Record<string, unknown>;
    for (const f of Object.keys(v)) {
      if (!['level', 'jobs', 'instructions', 'weeklyDiscoveryUsd', 'schedule'].includes(f))
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
