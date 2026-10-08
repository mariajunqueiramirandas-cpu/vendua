import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import { planHas } from '../billing/plans.ts';
import { loadOrderView } from '../orders.ts';
import type { CodePage, Paper } from './escpos.ts';
import type { CaixaDetail, TabDetail } from '../pdv/ledger.ts';
import {
  renderBillTicket,
  renderCaixaTicket,
  renderOrderTicket,
  renderTestTicket,
} from './ticket.ts';

const printLog = log.child({ mod: 'printing' });

/** LISTEN channel for agent streams — payload `tenantId|deviceId|job|config|revoked` */
export const PRINT_CHANNEL = 'vendua_print';

/** a stream older than this without a beat is a device that went away without saying so */
export const ONLINE_WINDOW_S = 70;
/** a job handed to an agent that hasn't answered by now is handed over again */
const RESEND_AFTER_S = 60;
/** a job is given up only when both hold: handed over this many times (an agent that was offline
 *  gets it again on reconnect, it isn't failed for the time it was away) and unanswered this long
 *  since it first reached the agent (more than its own retries and result reports take: it may sit
 *  behind a slow printer, resends alone don't fail it) */
const GIVE_UP_ATTEMPTS = 5;
const GIVE_UP_AFTER_S = 15 * 60;
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
    kind: 'order' | 'test' | 'bill' | 'caixa';
    trigger: PrintTrigger | 'manual' | 'test';
    orderId?: string | null;
    requestedBy?: string | null;
    /** bill | caixa: what to print, as Core computed it when it was asked for */
    doc?: unknown;
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
    insert into print_jobs (tenant_id, printer_id, device_id, order_id, kind, trigger, requested_by, doc)
    select ${tenantId}, p.id, p.device_id, ${job.orderId ?? null}, ${job.kind}, ${job.trigger},
           ${job.requestedBy ?? null}, ${job.doc === undefined ? null : tx.json(job.doc as never)}
    from printers p where p.tenant_id = ${tenantId} and p.id = any(${printerIds}::uuid[])
    on conflict (printer_id, order_id) where trigger in ('placed', 'confirmed') do nothing
    returning id`;
  return rows.map((r) => r.id);
}

/**
 * Queue this order's ticket on every automatic printer: on arrival when the store prints then,
 * and on accept always — an order that arrived before the store switched to "assim que chega"
 * still prints once, and one already printed on arrival is skipped by the unique index. A printer
 * the agent's last report missed still gets it: a report can miss one that is there (a scan not
 * done yet, a USB permission), and a ticket that never prints shows in printTrouble.
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
        left join store_settings s on s.tenant_id = p.tenant_id
        where p.tenant_id = ${tenantId} and p.auto
          and (${trigger} = 'confirmed' or coalesce(s.print_on, 'confirmed') = 'placed')`;
      if (printers.length === 0 || !(await planHas(sp, tenantId, 'printing'))) return 0;
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
  // an automatic ticket for an order cancelled while it waited would send the kitchen to cook it
  await tx`
    update print_jobs j set status = 'expired', finished_at = now(), error = 'Pedido cancelado'
    from orders o
    where j.tenant_id = ${tenantId} and j.device_id = ${deviceId}
      and j.status in ('pending', 'sent') and j.trigger in ('placed', 'confirmed')
      and o.tenant_id = j.tenant_id and o.id = j.order_id
      and o.state in ('cancelled', 'refunded')`;
  await tx`
    update print_jobs set status = 'failed', finished_at = now(),
           error = 'O aparelho não confirmou a impressão'
    where tenant_id = ${tenantId} and device_id = ${deviceId} and status = 'sent'
      and attempts >= ${GIVE_UP_ATTEMPTS}
      and coalesce(first_sent_at, sent_at) < now() - make_interval(secs => ${GIVE_UP_AFTER_S})
      and sent_at < now() - make_interval(secs => ${RESEND_AFTER_S})
      -- a device that was away gets each one once more before its silence counts
      and sent_at >= coalesce((select d.connected_at from print_devices d
                               where d.tenant_id = ${tenantId} and d.id = ${deviceId}), '-infinity')`;
  const due = await tx<
    {
      id: string;
      printer_id: string;
      order_id: string | null;
      kind: 'order' | 'test' | 'bill' | 'caixa';
      doc: unknown;
      created_at: Date;
      printer_name: string;
      paper: Paper;
      codepage: CodePage;
      copies: number;
      cut: boolean;
    }[]
  >`
    select j.id, j.printer_id, j.order_id, j.kind, j.doc, j.created_at,
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
        j.kind === 'bill' && j.doc
          ? renderBillTicket(j.doc as TabDetail, shop, opts, new Date(j.created_at))
          : j.kind === 'caixa' && j.doc
            ? renderCaixaTicket(j.doc as CaixaDetail, shop, opts, new Date(j.created_at))
            : j.kind === 'test' || !j.order_id
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
      update print_jobs set status = 'sent', attempts = attempts + 1, sent_at = now(),
             first_sent_at = coalesce(first_sent_at, now())
      where tenant_id = ${tenantId} and id = any(${out.map((j) => j.id)}::uuid[])`;
  for (const b of broken)
    await tx`
      update print_jobs set status = 'failed', finished_at = now(), error = ${b.error}
      where tenant_id = ${tenantId} and id = ${b.id}`;
  return out;
}

/**
 * The agent's answer. A late "printed" still wins over expired/failed: the paper is out.
 * Returns the order whose print status Início shows when this answer changes it (a failure, or
 * a success after one), else null.
 */
export async function recordJobResultTx(
  tx: Sql,
  tenantId: string,
  deviceId: string,
  jobId: string,
  result: { ok: boolean; error: string | null },
): Promise<string | null> {
  const rows = await tx<{ printer_id: string; status: string; order_id: string | null }[]>`
    select printer_id, status, order_id from print_jobs
    where tenant_id = ${tenantId} and id = ${jobId} and device_id = ${deviceId}
    for update`;
  const job = rows[0];
  if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'job not found');
  if (job.status === 'done') return null;
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
  if (!job.order_id) return null;
  if (!result.ok) return job.order_id;
  const failed = await tx`
    select 1 from print_jobs
    where tenant_id = ${tenantId} and order_id = ${job.order_id} and status = 'failed' limit 1`;
  return failed.length ? job.order_id : null;
}

export interface OrderPrintJob {
  id: string;
  status: 'pending' | 'sent' | 'done' | 'failed' | 'expired';
  trigger: 'placed' | 'confirmed' | 'manual';
  printerId: string;
  printer: string;
  device: string;
  deviceOnline: boolean;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** One order's tickets, newest first: what the order screen says about printing. */
export async function orderJobsTx(
  tx: Sql,
  tenantId: string,
  orderId: string,
): Promise<OrderPrintJob[]> {
  const rows = await tx<
    (Omit<OrderPrintJob, 'createdAt' | 'finishedAt'> & {
      createdAt: Date;
      finishedAt: Date | null;
    })[]
  >`
    select j.id, j.status, j.trigger, j.printer_id as "printerId",
           coalesce(p.label, p.name) as printer, d.name as device,
           coalesce(d.connected_at is not null
                    and (d.disconnected_at is null or d.disconnected_at < d.connected_at)
                    and d.last_seen_at > now() - make_interval(secs => ${ONLINE_WINDOW_S}), false)
             as "deviceOnline",
           j.error, j.created_at as "createdAt", j.finished_at as "finishedAt"
    from print_jobs j
      join printers p on p.id = j.printer_id
      join print_devices d on d.id = j.device_id
    where j.tenant_id = ${tenantId} and j.order_id = ${orderId} and j.kind = 'order'
    order by j.created_at desc, j.id
    limit 20`;
  return rows.map((r) => ({
    ...r,
    createdAt: new Date(r.createdAt).toISOString(),
    finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
  }));
}

/**
 * Tickets that didn't come out lately for orders still on the board, and that no later ticket
 * of the same order made up for: failed, or waiting minutes on a device that isn't there.
 */
export async function printTroubleTx(tx: Sql, tenantId: string) {
  return tx<
    {
      orderId: string;
      number: number;
      printer: string;
      error: string | null;
      waiting: boolean;
      at: Date;
    }[]
  >`
    select j.order_id as "orderId", o.number, coalesce(p.label, p.name) as printer, j.error,
           j.status <> 'failed' as waiting, coalesce(j.finished_at, j.created_at) as at
    from print_jobs j
      join orders o on o.tenant_id = j.tenant_id and o.id = j.order_id
      join printers p on p.id = j.printer_id
    where j.tenant_id = ${tenantId} and j.kind = 'order'
      and o.state in ('placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery')
      and (
        (j.status = 'failed' and j.finished_at > now() - interval '3 hours')
        or (j.status in ('pending', 'sent') and j.created_at < now() - interval '3 minutes'
            and j.expires_at > now())
      )
      and not exists (
        select 1 from print_jobs k
        where k.tenant_id = j.tenant_id and k.order_id = j.order_id and k.status = 'done'
          and k.created_at > j.created_at
      )
    order by at desc
    limit 10`;
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
