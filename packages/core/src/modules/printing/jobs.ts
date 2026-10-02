import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import { loadOrderView } from '../orders.ts';
import type { CodePage, Paper } from './escpos.ts';
import { renderOrderTicket, renderTestTicket } from './ticket.ts';

const printLog = log.child({ mod: 'printing' });

/** LISTEN channel for agent streams — payload `tenantId|deviceId|job|config|revoked` */
export const PRINT_CHANNEL = 'vendua_print';

/** a stream older than this without a beat is a device that went away without saying so */
export const ONLINE_WINDOW_S = 70;
/** a job handed to an agent that hasn't answered by now is handed over again */
const RESEND_AFTER_S = 60;
const MAX_ATTEMPTS = 5;
const BATCH = 20;

export type PrinterKind = 'spooler' | 'tcp' | 'serial' | 'usb' | 'bluetooth';
export const PRINTER_KINDS: readonly PrinterKind[] = [
  'spooler',
  'tcp',
  'serial',
  'usb',
  'bluetooth',
];
export type PrintTrigger = 'placed' | 'confirmed';

interface PrinterRow {
  id: string;
  device_id: string;
  key: string;
  kind: PrinterKind;
  name: string;
  label: string | null;
  address: string;
  source: 'agent' | 'manual';
  present: boolean;
  auto: boolean;
  paper: Paper;
  codepage: CodePage;
  copies: number;
  cut: boolean;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

export interface PrinterView {
  id: string;
  deviceId: string;
  kind: PrinterKind;
  /** the merchant's label, else what the agent calls it */
  name: string;
  reportedName: string;
  label: string | null;
  address: string;
  source: 'agent' | 'manual';
  present: boolean;
  auto: boolean;
  paper: Paper;
  codepage: CodePage;
  copies: number;
  cut: boolean;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

/** what an agent needs to reach a printer — nothing about tickets */
export interface AgentPrinter {
  id: string;
  key: string;
  kind: PrinterKind;
  name: string;
  address: string;
}

const PRINTER_COLS = (tx: Sql) => tx`
  id, device_id, key, kind, name, label, address, source, present, auto, paper, codepage, copies,
  cut, last_ok_at, last_error, last_error_at`;

export function printerView(r: PrinterRow): PrinterView {
  return {
    id: r.id,
    deviceId: r.device_id,
    kind: r.kind,
    name: r.label ?? r.name,
    reportedName: r.name,
    label: r.label,
    address: r.address,
    source: r.source,
    present: r.present,
    auto: r.auto,
    paper: r.paper,
    codepage: r.codepage,
    copies: r.copies,
    cut: r.cut,
    lastOkAt: r.last_ok_at,
    lastError: r.last_error,
    lastErrorAt: r.last_error_at,
  };
}

export async function printersTx(tx: Sql, tenantId: string, deviceId?: string) {
  const rows = await tx<PrinterRow[]>`
    select ${PRINTER_COLS(tx)} from printers
    where tenant_id = ${tenantId} ${deviceId ? tx`and device_id = ${deviceId}` : tx``}
    order by created_at, key`;
  return rows.map(printerView);
}

export async function agentPrintersTx(
  tx: Sql,
  tenantId: string,
  deviceId: string,
): Promise<AgentPrinter[]> {
  return tx<AgentPrinter[]>`
    select id, key, kind, coalesce(label, name) as name, address from printers
    where tenant_id = ${tenantId} and device_id = ${deviceId}
    order by created_at, key`;
}

/** Wake this device's open streams (config changed, or it was removed). On commit. */
export async function notifyDeviceTx(
  tx: Sql,
  tenantId: string,
  deviceId: string,
  what: 'config' | 'revoked',
) {
  await tx`select pg_notify(${PRINT_CHANNEL}, ${`${tenantId}|${deviceId}|${what}`})`;
}

/** Queue one job per printer; returns the job ids (skipping automatic repeats). */
export async function queueJobsTx(
  tx: Sql,
  tenantId: string,
  printerIds: string[],
  job: {
    kind: 'order' | 'test';
    trigger: PrintTrigger | 'manual' | 'test';
    orderId?: string | null;
    requestedBy?: string | null;
  },
): Promise<string[]> {
  if (printerIds.length === 0) return [];
  // a sweep on ~1 in 50 queues bounds the table without a worker; a device that never comes
  // back would otherwise keep its jobs pending forever
  if (Math.random() < 0.02) {
    await tx`
      update print_jobs set status = 'expired', finished_at = now()
      where tenant_id = ${tenantId} and status in ('pending', 'sent') and expires_at < now()`;
    await tx`
      delete from print_jobs where tenant_id = ${tenantId} and created_at < now() - interval '30 days'`;
  }
  const rows = await tx<{ id: string }[]>`
    insert into print_jobs (tenant_id, printer_id, device_id, order_id, kind, trigger, requested_by)
    select ${tenantId}, p.id, p.device_id, ${job.orderId ?? null}, ${job.kind}, ${job.trigger},
           ${job.requestedBy ?? null}
    from printers p where p.tenant_id = ${tenantId} and p.id = any(${printerIds}::uuid[])
    on conflict (printer_id, order_id, trigger) where trigger in ('placed', 'confirmed') do nothing
    returning id`;
  return rows.map((r) => r.id);
}

/**
 * Queue this order's ticket on every automatic printer when the store prints at this step.
 * Call inside the tenant transaction that commits the step, after any Promise.all batch: it runs
 * in a savepoint and never throws, so a printing bug can't block an order.
 */
export async function enqueueOrderPrintTx(
  tx: Sql,
  tenantId: string,
  orderId: string,
  trigger: PrintTrigger,
): Promise<number> {
  try {
    return await (
      tx as unknown as { savepoint<T>(fn: (s: Sql) => Promise<T>): Promise<T> }
    ).savepoint(async (sp) => {
      const printers = await sp<{ id: string }[]>`
        select p.id from printers p
        join store_settings s on s.tenant_id = p.tenant_id and s.print_on = ${trigger}
        where p.tenant_id = ${tenantId} and p.auto and p.present`;
      if (printers.length === 0) return 0;
      const ids = await queueJobsTx(
        sp,
        tenantId,
        printers.map((p) => p.id),
        { kind: 'order', trigger, orderId },
      );
      return ids.length;
    });
  } catch (err) {
    printLog.error({ err, orderId, trigger }, 'order ticket not queued');
    return 0;
  }
}

export interface AgentJob {
  id: string;
  printerId: string;
  createdAt: string;
  /** base64 ESC/POS */
  data: string;
}

/**
 * The device's due jobs, rendered and marked sent: new ones, and sent ones nobody answered for a
 * minute (the agent dedupes by id, so a resend never prints twice). Expired and given-up jobs
 * are closed on the way.
 */
export async function claimDueJobsTx(
  tx: Sql,
  tenantId: string,
  deviceId: string,
  now = new Date(),
): Promise<AgentJob[]> {
  await tx`
    update print_jobs set status = 'expired', finished_at = now()
    where tenant_id = ${tenantId} and device_id = ${deviceId}
      and status in ('pending', 'sent') and expires_at < now()`;
  await tx`
    update print_jobs set status = 'failed', finished_at = now(),
           error = 'O aparelho não confirmou a impressão'
    where tenant_id = ${tenantId} and device_id = ${deviceId} and status = 'sent'
      and attempts >= ${MAX_ATTEMPTS}
      and sent_at < now() - make_interval(secs => ${RESEND_AFTER_S})`;
  const due = await tx<
    {
      id: string;
      printer_id: string;
      order_id: string | null;
      kind: 'order' | 'test';
      created_at: Date;
      printer_name: string;
      paper: Paper;
      codepage: CodePage;
      copies: number;
      cut: boolean;
    }[]
  >`
    select j.id, j.printer_id, j.order_id, j.kind, j.created_at,
           coalesce(p.label, p.name) as printer_name, p.paper, p.codepage, p.copies, p.cut
    from print_jobs j join printers p on p.id = j.printer_id
    where j.tenant_id = ${tenantId} and j.device_id = ${deviceId}
      and (j.status = 'pending'
           or (j.status = 'sent' and j.sent_at < now() - make_interval(secs => ${RESEND_AFTER_S})))
    order by j.created_at, j.id
    limit ${BATCH}
    for update of j skip locked`;
  if (due.length === 0) return [];
  const [store] = await tx<{ name: string; timezone: string | null }[]>`
    select t.name, s.hours->>'timezone' as timezone
    from tenants t left join store_settings s on s.tenant_id = t.id
    where t.id = ${tenantId}`;
  const shop = { name: store?.name ?? '', timezone: store?.timezone || 'America/Sao_Paulo' };
  const out: AgentJob[] = [];
  const broken: { id: string; error: string }[] = [];
  for (const j of due) {
    const opts = { paper: j.paper, codepage: j.codepage, copies: j.copies, cut: j.cut };
    try {
      const bytes =
        j.kind === 'test' || !j.order_id
          ? renderTestTicket(shop, { name: j.printer_name }, opts, now)
          : renderOrderTicket(
              await loadOrderView(tx, tenantId, j.order_id),
              shop,
              opts,
              new Date(j.created_at),
              now,
            );
      out.push({
        id: j.id,
        printerId: j.printer_id,
        createdAt: new Date(j.created_at).toISOString(),
        data: Buffer.from(bytes).toString('base64'),
      });
    } catch (err) {
      printLog.error({ err, jobId: j.id }, 'ticket render failed');
      broken.push({ id: j.id, error: 'Não foi possível montar o cupom' });
    }
  }
  if (out.length > 0)
    await tx`
      update print_jobs set status = 'sent', attempts = attempts + 1, sent_at = now()
      where tenant_id = ${tenantId} and id = any(${out.map((j) => j.id)}::uuid[])`;
  for (const b of broken)
    await tx`
      update print_jobs set status = 'failed', finished_at = now(), error = ${b.error}
      where tenant_id = ${tenantId} and id = ${b.id}`;
  return out;
}

/** The agent's answer. A late "printed" still wins over expired/failed: the paper is out. */
export async function recordJobResultTx(
  tx: Sql,
  tenantId: string,
  deviceId: string,
  jobId: string,
  result: { ok: boolean; error: string | null },
): Promise<void> {
  const rows = await tx<{ printer_id: string; status: string }[]>`
    select printer_id, status from print_jobs
    where tenant_id = ${tenantId} and id = ${jobId} and device_id = ${deviceId}
    for update`;
  const job = rows[0];
  if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'job not found');
  if (job.status === 'done') return;
  await tx`
    update print_jobs
    set status = ${result.ok ? 'done' : 'failed'}, finished_at = now(),
        error = ${result.ok ? null : result.error}
    where tenant_id = ${tenantId} and id = ${jobId}`;
  if (result.ok)
    await tx`
      update printers set last_ok_at = now(), last_error = null, last_error_at = null
      where tenant_id = ${tenantId} and id = ${job.printer_id}`;
  else
    await tx`
      update printers set last_error = ${result.error}, last_error_at = now()
      where tenant_id = ${tenantId} and id = ${job.printer_id}`;
}

export interface ReportedPrinter {
  key: string;
  kind: PrinterKind;
  name: string;
  address: string;
}

/** Replace what the agent discovers: new ones appear, missing ones stay but marked absent. */
export async function reportPrintersTx(
  tx: Sql,
  tenantId: string,
  deviceId: string,
  printers: ReportedPrinter[],
) {
  for (const p of printers) {
    await tx`
      insert into printers (tenant_id, device_id, key, kind, name, address, source, present)
      values (${tenantId}, ${deviceId}, ${p.key}, ${p.kind}, ${p.name}, ${p.address}, 'agent', true)
      on conflict (device_id, key) do update
        set kind = excluded.kind, name = excluded.name, address = excluded.address,
            present = true, updated_at = now()`;
  }
  await tx`
    update printers set present = false, updated_at = now()
    where tenant_id = ${tenantId} and device_id = ${deviceId} and source = 'agent' and present
      and not (key = any(${printers.map((p) => p.key)}::text[]))`;
}
