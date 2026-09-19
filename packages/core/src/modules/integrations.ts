import type { Sql } from '../platform/db.ts';
import { HttpError, str } from '../platform/http.ts';
import { claimControl, controlTx, type ClaimResult } from './control.ts';

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
  llm: ['openrouter', 'anthropic', 'openai', 'mock'],
  email: ['resend', 'smtp', 'log'],
  whatsapp: ['baileys', 'log'],
  discovery: ['tinyfish', 'mock'],
};

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
  return {
    id: row.id,
    kind: row.kind,
    driver: row.driver,
    enabled: row.enabled,
    config: row.config ?? {},
    /** whether process.env actually provides the referenced secret */
    secretRef: row.secret_ref,
    secretPresent: row.secret_ref ? !!process.env[row.secret_ref] : null,
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
  return claimControl(sql, idemKey, async (tx) => {
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
  /** discovery runs: cap on leads created per run */
  discoveryMaxLeads: 20,
} as const;

export type Guardrails = {
  maxOutboundPerLeadPerDay: number;
  quietStart: string;
  quietEnd: string;
  timezone: string;
  firstContactDraftOnly: boolean;
  discoveryMaxLeads: number;
};

export const DEFAULT_PITCH = {
  product:
    'Venduá — plataforma que cria uma loja online própria para pequenos negócios de comida (docerias, marmitas, pizzarias) em poucos dias, com catálogo, pedidos e checkout integrados.',
  audience: 'donos de pequenos negócios de alimentação no Brasil',
  tone: 'direto, caloroso, português brasileiro, mensagens curtas estilo WhatsApp',
  offerRange:
    'pode oferecer teste gratuito e desconto de lançamento; nunca prometa preço final nem isenção — escale para humano quando pedirem desconto além do lançamento',
  goal: 'descobrir interesse e marcar uma conversa curta ou pedido de demonstração',
  hardRules: [
    'nunca invente funcionalidades, prazos ou preços',
    'nunca pressione quem disse não ou pediu para parar',
    'uma mensagem por vez; sem listas longas ou jargão',
    'não se identifique como IA a menos que perguntem — e se perguntarem, seja honesto',
  ],
} as const;

export type Pitch = typeof DEFAULT_PITCH;

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
  return claimControl(sql, idemKey, async (tx) => {
    await tx`
      insert into control_settings (key, value) values (${key}, ${tx.json(value as never)})
      on conflict (key) do update set value = excluded.value
    `;
    return { status: 200, body: { key, value } };
  });
}

export async function listSettings(sql: Sql) {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ key: string; value: unknown }[]>`select * from control_settings order by key`,
  );
  return rows;
}
