import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { sendEmail } from '../agent/channels/email.ts';
import { getIntegrationTx, getSettingTx, type IntegrationRow } from './integrations.ts';
import { controlTx } from './control.ts';

// daily staff email — sweep claims the day via digest_state once the local hour passes, sends via sendEmail
export interface DigestConfig {
  enabled: boolean;
  /** staff recipient — there is no other staff-email field in the settings
   *  schema, so digest carries its own. */
  to: string;
  /** local hour (guardrails.timezone) after which it fires — "≥" so a worker down at the hour still sends on boot. */
  hour: number;
}

export const DEFAULT_DIGEST: DigestConfig = { enabled: false, to: '', hour: 8 };

export interface DigestReport {
  /** local date (guardrails.timezone) this digest covers. */
  date: string;
  newLeads: number;
  repliesIn: number;
  meetingsBooked: number;
  meetingsNext24h: number;
  agentRuns: number;
  /** board-scoped failures (no lead card to flag) — the digest must carry them. */
  failedBoardRuns: number;
  costCents: number;
  pendingDrafts: number;
  openTasks: number;
}

interface DigestState {
  date?: string;
  status?: 'claimed' | 'sent' | 'skipped' | 'error';
  fails?: number;
  /** last claim timestamp — a stale claim is reclaimable. */
  at?: string;
  /** claim-owner token — outcome writes filter on it so a superseded worker can't clobber a newer 'sent'. */
  tok?: string;
  error?: string;
}

const digestLog = log.child({ mod: 'digest' });
const MAX_SEND_ATTEMPTS = 3;

export async function digestConfigTx(tx: Sql): Promise<DigestConfig> {
  const stored = await getSettingTx(tx, 'digest', {} as Partial<DigestConfig>);
  return { ...DEFAULT_DIGEST, ...stored };
}

// 24h board rollup
export async function digestReportTx(tx: Sql, date: string): Promise<DigestReport> {
  const one = async (q: Promise<{ n: number }[]>) => (await q)[0]!.n;
  const [
    newLeads,
    repliesIn,
    meetingsBooked,
    meetingsNext24h,
    runs,
    failedBoardRuns,
    pendingDrafts,
    openTasks,
  ] = await Promise.all([
    one(
      tx<{ n: number }[]>`
          select count(*)::int as n from leads
          where created_at > now() - interval '24 hours' and archived_at is null
        `,
    ),
    one(
      tx<{ n: number }[]>`
          select count(*)::int as n from lead_messages
          where direction = 'in' and created_at > now() - interval '24 hours'
        `,
    ),
    one(
      tx<{ n: number }[]>`
          select count(*)::int as n from meetings
          where created_at > now() - interval '24 hours'
        `,
    ),
    one(
      tx<{ n: number }[]>`
          select count(*)::int as n from meetings
          where status = 'scheduled' and starts_at between now() and now() + interval '24 hours'
        `,
    ),
    tx<{ runs: number; cost_cents: number }[]>`
        select count(*)::int as runs, coalesce(sum(cost_cents), 0)::int as cost_cents
        from agent_runs where created_at > now() - interval '24 hours'
      `.then((r) => r[0]!),
    one(
      tx<{ n: number }[]>`
          select count(*)::int as n from agent_runs
          where status = 'failed' and lead_id is null
            and finished_at > now() - interval '24 hours'
        `,
    ),
    one(
      tx<{ n: number }[]>`
          select count(*)::int as n from lead_messages where status = 'draft'
        `,
    ),
    one(
      tx<{ n: number }[]>`
          select count(*)::int as n from lead_tasks where done_at is null
        `,
    ),
  ]);
  return {
    date,
    newLeads,
    repliesIn,
    meetingsBooked,
    meetingsNext24h,
    agentRuns: runs.runs,
    failedBoardRuns,
    costCents: runs.cost_cents,
    pendingDrafts,
    openTasks,
  };
}

// agent_runs.cost_cents is metered in USD (model/tool pricing) — never BRL.
const fmtUsdCents = (cents: number) => `US$ ${(cents / 100).toFixed(2)}`;

export function digestText(r: DigestReport): { subject: string; body: string } {
  return {
    subject: `Venduá — resumo do dia ${r.date}`,
    body: [
      `Resumo ${r.date}`,
      '',
      'Últimas 24h:',
      `• leads novos: ${r.newLeads}`,
      `• respostas recebidas: ${r.repliesIn}`,
      `• calls marcadas: ${r.meetingsBooked} (próximas 24h: ${r.meetingsNext24h})`,
      `• runs do agente: ${r.agentRuns} — custo ${fmtUsdCents(r.costCents)}${r.failedBoardRuns ? ` — ${r.failedBoardRuns} run(s) do board falharam` : ''}`,
      '',
      'Na fila agora:',
      `• rascunhos aguardando aprovação: ${r.pendingDrafts}`,
      `• tarefas abertas: ${r.openTasks}`,
    ].join('\n'),
  };
}

// claims the day via conditional upsert (stale claims reclaimable); send runs outside the claim tx, errors release it for retry
const RECLAIM_AFTER_MINUTES = 10;

interface DigestClaim {
  cfg: DigestConfig;
  date: string;
  fails: number;
  tok: string;
  integration: IntegrationRow;
}

export async function sweepDigest(sql: Sql): Promise<boolean> {
  const claimed = await controlTx(sql, async (tx): Promise<DigestClaim | null> => {
    const cfg = await digestConfigTx(tx);
    if (!cfg.enabled || !cfg.to) return null;
    const g = await getSettingTx(tx, 'guardrails', {} as { timezone?: string });
    const tz = g.timezone ?? 'America/Sao_Paulo';
    const now = (
      await tx<{ date: string; hour: number }[]>`
        select (now() at time zone ${tz})::date::text as date,
               extract(hour from now() at time zone ${tz})::int as hour
      `
    )[0]!;
    if (now.hour < cfg.hour) return null;
    const integration = await getIntegrationTx(tx, 'email');
    if (!integration) {
      // 'skipped' marks the day consumed without sending — never downgrade an in-flight/done claim
      digestLog.warn('digest due but no enabled email integration — skipping today');
      await tx`
        insert into control_settings (key, value)
        values ('digest_state', ${tx.json({ date: now.date, status: 'skipped' } as never)})
        on conflict (key) do update set value = excluded.value
        where control_settings.value->>'date' is distinct from ${now.date}
           or (control_settings.value->>'status' = 'claimed'
               and (control_settings.value->>'at')::timestamptz
                   < now() - make_interval(mins => ${RECLAIM_AFTER_MINUTES}))
           or (control_settings.value->>'status' = 'error'
               and coalesce((control_settings.value->>'fails')::int, 0) < ${MAX_SEND_ATTEMPTS})
      `;
      return null;
    }
    // atomic claim — WHERE re-checks the committed row; tok guards outcome writes from superseded workers
    const tok = crypto.randomUUID();
    const win = await tx<{ fails: number }[]>`
      insert into control_settings (key, value)
      values ('digest_state',
              ${tx.json({ date: now.date, status: 'claimed', fails: 0, at: new Date().toISOString(), tok } as never)})
      on conflict (key) do update
        set value = jsonb_build_object(
          'date', ${now.date}::text,
          'status', 'claimed',
          'fails', case when control_settings.value->>'date' is distinct from ${now.date}
                        then 0
                        else coalesce((control_settings.value->>'fails')::int, 0) end,
          'at', to_jsonb(now()),
          'tok', ${tok}::text)
        where control_settings.value->>'date' is distinct from ${now.date}
           or (control_settings.value->>'status' = 'claimed'
               and (control_settings.value->>'at')::timestamptz
                   < now() - make_interval(mins => ${RECLAIM_AFTER_MINUTES}))
           or (control_settings.value->>'status' = 'error'
               and coalesce((control_settings.value->>'fails')::int, 0) < ${MAX_SEND_ATTEMPTS})
      returning (value->>'fails')::int as fails
    `;
    if (!win[0]) return null;
    return { cfg, date: now.date, fails: win[0].fails, tok, integration };
  });
  if (!claimed) return false;

  const { cfg, date, fails, tok, integration } = claimed;
  // only the claim owner writes the outcome — tok mismatch makes a superseded worker's write a no-op
  const setState = async (state: DigestState) => {
    const res = await controlTx(
      sql,
      (tx) => tx`
        update control_settings set value = ${tx.json({ ...state, tok } as never)}
        where key = 'digest_state' and value->>'tok' = ${tok}
      `,
    );
    if (!res.count)
      digestLog.warn({ date, status: state.status }, 'superseded digest claim — outcome discarded');
    return res.count > 0;
  };
  try {
    const report = await controlTx(sql, (tx) => digestReportTx(tx, date));
    const { subject, body } = digestText(report);
    // per-day idem key — the provider dedupes a reclaim-driven resend
    const pmid = await sendEmail(integration, {
      to: cfg.to,
      subject,
      body,
      idemKey: `digest:${claimed.date}`,
    });
    if (await setState({ date, status: 'sent' })) {
      digestLog.info({ to: cfg.to, pmid }, 'daily digest sent');
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setState({ date, status: 'error', fails: fails + 1, error: msg });
    throw e;
  }
}
