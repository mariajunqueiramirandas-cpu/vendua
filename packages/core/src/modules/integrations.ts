import type { Sql } from '../platform/db.ts';
import { HttpError, str } from '../platform/http.ts';
import { claimControl, controlTx, type ClaimResult } from './control.ts';
import { emitControlEvent } from './control-events.ts';
import { LEAD_STATES, type LeadState } from './leads.ts';

/**
 * integrations module — modular provider configuration for the agentic CRM.
 * Each row: a driver of one kind (llm/email/whatsapp/discovery), enabled
 * flag, non-secret config, and `secret_ref` = the NAME of the env var that
 * holds the credential. Secret values never enter the DB.
 */

export const INTEGRATION_KINDS = ['llm', 'email', 'whatsapp', 'discovery'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

/** Drivers each kind can load. Validation lives here so the API and the
 *  driver registry agree on names. */
export const DRIVERS: Record<IntegrationKind, readonly string[]> = {
  llm: ['gemini', 'openrouter', 'anthropic', 'openai', 'mock'],
  email: ['resend', 'log'],
  whatsapp: ['baileys', 'log'],
  discovery: ['tinyfish', 'mock'],
};

/** Fallback env var each secret-bearing driver reads when the row's
 *  secret_ref is null — mirrors the `?? process.env.X` fallback in the
 *  channel/driver code so the UI reports what's actually in effect. */
export const DEFAULT_SECRET: Record<string, string> = {
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  resend: 'RESEND_API_KEY',
  tinyfish: 'TINYFISH_API_KEY',
};

/** Drivers whose credential lookup is `(env[ref]) ?? env[DEFAULT]` — a
 *  configured-but-unset ref still authenticates via the default var.
 *  LLM providers are strict: a set secret_ref that env lacks = missing. */
const SECRET_FALLBACK: ReadonlySet<string> = new Set(['resend', 'tinyfish']);

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

/** API view — secret_ref masked to the env var name only (never a value). */
export function integrationJson(row: IntegrationRow) {
  // The env var the driver will actually read — the row's override or its
  // built-in default when the override is unset/fallbackable. Fallbackable
  // drivers (resend/tinyfish do `(env[ref]) ?? env[DEFAULT]`) report the
  // name they'd actually read, so a configured-but-missing custom ref never
  // displays as "present"; strict LLM drivers keep naming the custom ref.
  // `!== undefined`, not truthy — `??` in the drivers falls through only on
  // absent vars; an EMPTY custom var is what the driver actually reads.
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
    /** whether process.env actually provides the referenced secret.
     *  `secretName` is the var the driver reads today — the configured ref
     *  unless a fallback driver falls through to its built-in default. */
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

/** Tx-local variant — the enabled row for a kind is THE provider (one active
 *  driver per kind). Use inside an existing control tx; `sql.begin` does not
 *  exist on transaction handles. */
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
  // A driver/enable flip on a messaging channel changes what its health
  // cards and the live socket should be doing — material, not per-counter.
  if (!res.replayed && (kind === 'whatsapp' || kind === 'email')) {
    emitControlEvent('channel.health', kind);
  }
  return res;
}

// ---------------------------------------------------------------------------
// control_settings — workspace knobs (guardrails, pitch, autopilot default)
// ---------------------------------------------------------------------------

export const DEFAULT_GUARDRAILS = {
  maxOutboundPerLeadPerDay: 3,
  quietStart: '21:00',
  quietEnd: '08:00',
  timezone: 'America/Sao_Paulo',
  /** first outbound to a lead always goes through the approvals queue */
  firstContactDraftOnly: true,
  /** discovery: a created lead with fitScore >= discoveryContactMinScore and
   *  a whatsapp/phone channel gets an outreach run queued on it (the send
   *  still obeys firstContactDraftOnly). */
  discoveryAutoContact: true,
  discoveryContactMinScore: 8,
  /** pacing before the agent answers an inbound message — the reply run is
   *  queued with run_at = now() + this many minutes. 0 = answer at once. */
  inboundReplyDelayMin: 0,
  /** staff-created lead (POST /leads) gets an outreach run scheduled this
   *  many minutes after creation — the agent makes first contact alone.
   *  0 = off: creation only enqueues triage (draft for approval). */
  firstContactDelayMin: 0,
  /** cadence floor: after an agent send the lead waits at most this many
   *  days for a reply before sweepOutreach picks it up — stamped only when
   *  next_action_at is still NULL (an agent/staff-set value wins). 0 = off. */
  followupCadenceDays: 2,
  /** approving an agent draft older than this many days never sends the
   *  week-old copy — the draft is superseded and a draftOnly run recomposes
   *  it against current state. 0 = off (approve always sends). */
  staleDraftDays: 7,
  /** discovery briefs: a brief whose last N finished runs produced zero
   *  leads pauses itself (enabled=false + a note) instead of burning runs
   *  forever. 0 = never auto-pause. */
  briefAutoPauseRuns: 5,
} as const;

export type Guardrails = {
  maxOutboundPerLeadPerDay: number;
  quietStart: string;
  quietEnd: string;
  timezone: string;
  firstContactDraftOnly: boolean;
  discoveryAutoContact: boolean;
  discoveryContactMinScore: number;
  inboundReplyDelayMin: number;
  firstContactDelayMin: number;
  followupCadenceDays: number;
  staleDraftDays: number;
  briefAutoPauseRuns: number;
};

export const DEFAULT_PITCH = {
  product:
    'Venduá — plataforma que cria uma loja online própria para pequenos negócios de comida (docerias, marmitas, pizzarias) em poucos dias, com catálogo, pedidos e checkout integrados.',
  audience: 'donos de pequenos negócios de alimentação no Brasil',
  tone: 'direto, caloroso, português brasileiro, mensagens curtas estilo WhatsApp',
  offerRange:
    'pode oferecer teste gratuito e desconto de lançamento; nunca prometa preço final nem isenção — escale para humano quando pedirem desconto além do lançamento',
  /** Verbatim quotable facts — the only commercial claims the agent may
   *  state (price, plan, trial length, signup URL, example storefront).
   *  Empty = nothing may be quoted; the agent must confirm with staff. */
  offer: '',
  goal: 'descobrir interesse e marcar uma conversa curta ou pedido de demonstração',
  hardRules: [
    'nunca invente funcionalidades, prazos ou preços',
    'nunca pressione quem disse não ou pediu para parar',
    'uma mensagem por vez; sem listas longas ou jargão',
    'não se identifique como IA a menos que perguntem — e se perguntarem, seja honesto',
  ],
} as const;

export type Pitch = typeof DEFAULT_PITCH;

/** Stage close-probabilities that turn pipeline value into a forecast —
 *  the 'forecast' setting stores overrides under `probabilities`. */
export const DEFAULT_FORECAST_PROBABILITIES: Record<LeadState, number> = {
  lead: 0.05,
  contacted: 0.2,
  invited: 0.6,
  live: 1,
};

/** Effective close-probability per state — defaults merged with the stored
 *  'forecast' row; unknown keys and out-of-range values are ignored so a
 *  hand-edited row can't poison the math. */
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

/** Tx-local read of the forecast probabilities — use inside an existing
 *  control tx (leadStats, snapshotPipelineTx). */
export async function getForecastConfigTx(tx: Sql): Promise<Record<LeadState, number>> {
  return forecastProbabilities(await getSettingTx<unknown>(tx, 'forecast', null));
}

export async function getSetting<T>(sql: Sql, key: string, fallback: T): Promise<T> {
  return controlTx(sql, (tx) => getSettingTx(tx, key, fallback));
}

/** Tx-local variant — call inside an existing control tx. */
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

/** Write-time validation for the settings the safety layer reads — a
 *  malformed guardrails object must never silently disable the caps.
 *  Unknown keys pass through (settings is a schemaless store), but the three
 *  keys the agent depends on get their shape checked. */
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
    if (v.firstContactDraftOnly !== undefined && typeof v.firstContactDraftOnly !== 'boolean') {
      throw bad('firstContactDraftOnly', 'must be a boolean');
    }
    if (v.discoveryAutoContact !== undefined && typeof v.discoveryAutoContact !== 'boolean') {
      throw bad('discoveryAutoContact', 'must be a boolean');
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
    if (v.hardRules !== undefined) {
      if (
        !Array.isArray(v.hardRules) ||
        v.hardRules.length > 50 ||
        v.hardRules.some((r) => typeof r !== 'string' || r.length > 500)
      ) {
        throw bad('hardRules', 'must be an array of ≤50 strings (≤500 chars each)');
      }
    }
    return;
  }

  // 'meeting' — CRM-native booking config. bookingUrl is the legacy static
  // link the agent prompt falls back on when token minting fails; roomUrl is
  // the static video room used when the Daily provider isn't configured;
  // publicBaseUrl is where /agendar links point. All URLs https-only — a
  // prompt-injected javascript:/data: URL would ride out in an outbound
  // message.
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
    // normalizeMeetingConfig clamps to [0,180] — a wider stored value would
    // silently read back different, so validation must not accept it
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

  // 'digest' — daily staff email. `to` is the only staff-address field in the
  // schema; the worker reads hour in the guardrails timezone.
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

  if (key === 'agent_memory') {
    const v = value as { facts?: unknown } | null;
    if (!v || typeof v !== 'object' || !Array.isArray(v.facts)) {
      throw bad('facts', 'must be { facts: string[] }');
    }
    if (v.facts.length > 100 || v.facts.some((f) => typeof f !== 'string' || f.length > 500)) {
      throw bad('facts', 'must be ≤100 strings of ≤500 chars');
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
  // Meeting windows/tz/slot changes alter the availability grid the
  // meetings surface renders.
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
