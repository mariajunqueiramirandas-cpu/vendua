import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { withTenant, type Sql } from '../../platform/db.ts';
import { HttpError, bodyJson, clientIp, uuidParam, windowCounter } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import type { AdminApp, AdminDeps } from '../../admin/context.ts';
import { emitAdminTx } from '../../admin/live.ts';
import {
  AGENT_PLATFORMS,
  VERSION_RE,
  authDevice,
  formatUserCode,
  pollPairing,
  startPairing,
  type AgentPlatform,
  type AuthedDevice,
} from './devices.ts';
import { planHas } from '../billing/plans.ts';
import { PrintHub } from './hub.ts';
import {
  PRINTER_KINDS,
  agentPrintersTx,
  claimDueJobsTx,
  notifyDeviceTx,
  queueJobsTx,
  recordJobResultTx,
  reportPrintersTx,
  type AgentJob,
  type PrinterKind,
  type ReportedPrinter,
} from './jobs.ts';

const agentLog = log.child({ mod: 'print-agent' });

const BEAT_MS = 20_000;
const STREAM_MAX_MS = 30 * 60_000;
const MAX_PRINTERS = 50;
const MAX_STREAMS = 3;

export interface PrintAgentOpts {
  admin: AdminApp;
  sql: Sql;
  idempotency: AdminDeps['idempotency'];
  publicOrigin: (c: Context) => string;
  trustProxy: boolean;
  proxyHops: number;
}

function limitByIp(max: number, flags: { trustForwardedFor: boolean; proxyHops: number }) {
  const allow = windowCounter({ windowMs: 60_000, max });
  return async (c: Context, next: () => Promise<void>) => {
    if (!allow(clientIp(c, flags)))
      throw new HttpError(429, 'RATE_LIMITED', 'too many attempts — wait a minute');
    await next();
  };
}

const agentVersion = (c: Context) => {
  const v = c.req.header('x-agent-version');
  return v && VERSION_RE.test(v) ? v : null;
};

function shortText(v: unknown, name: string, max: number): string {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > max)
    throw new HttpError(422, 'BAD_REQUEST', `${name} must be 1–${max} characters`, {
      field: name,
    });
  return v.trim();
}

/**
 * The print agent's API (ADR 0027), under /admin/v1/agent so it rides the admin host. Mounted
 * before the session gate: pairing is anonymous, everything else is a device Bearer token.
 */
export function mountPrintAgent(o: PrintAgentOpts) {
  const { admin, sql } = o;
  const hub = new PrintHub(sql);
  const flags = { trustForwardedFor: o.trustProxy, proxyHops: o.proxyHops };
  const pairLimit = limitByIp(10, flags);
  // a poll every 3 s is 20 a minute; room for two agents behind one NAT
  const pollLimit = limitByIp(60, flags);

  admin.post('/agent/pair', pairLimit, async (c) => {
    const body = await bodyJson(c, 2 * 1024);
    const platform = body.platform;
    if (typeof platform !== 'string' || !AGENT_PLATFORMS.includes(platform as AgentPlatform))
      throw new HttpError(422, 'BAD_REQUEST', 'platform must be windows or android', {
        field: 'platform',
      });
    const name = shortText(body.name, 'name', 60);
    const version =
      typeof body.version === 'string' && VERSION_RE.test(body.version) ? body.version : null;
    const p = await startPairing(sql, { platform: platform as AgentPlatform, name, version });
    const code = formatUserCode(p.userCode);
    return c.json({
      deviceCode: p.deviceCode,
      userCode: code,
      approveUrl: `${o.publicOrigin(c)}/admin/impressoras/parear?code=${code}`,
      expiresIn: p.expiresIn,
      interval: 3,
    });
  });

  admin.post('/agent/pair/poll', pollLimit, async (c) => {
    const body = await bodyJson(c, 1024);
    const code = typeof body.deviceCode === 'string' ? body.deviceCode : '';
    const out = await pollPairing(sql, code);
    if (out.status === 'approved') {
      const [tenantId, deviceId] = out.token.split('.') as [string, string];
      await withTenant(sql, tenantId, (tx) =>
        emitAdminTx(tx, tenantId, 'printers', deviceId),
      ).catch(() => undefined);
    }
    c.header('cache-control', 'no-store');
    return c.json(out);
  });

  // a store whose plan has no printing stops getting jobs; it can still report and disconnect
  const device = async (c: Context, o: { plan?: boolean } = {}): Promise<AuthedDevice> => {
    const d = await authDevice(sql, c.req.header('authorization'));
    c.set('tenant', d.tenant);
    if (
      o.plan !== false &&
      !(await withTenant(sql, d.tenant.id, (tx) => planHas(tx, d.tenant.id, 'printing')))
    )
      throw new HttpError(403, 'PLAN_REQUIRED', "the store's plan does not include printing", {
        feature: 'printing',
      });
    return d;
  };

  admin.get('/agent/stream', async (c) => {
    const d = await device(c);
    // one agent holds one stream; a few cover reconnects racing the old one's close
    if (hub.streams(d.id) >= MAX_STREAMS)
      throw new HttpError(429, 'TOO_MANY_STREAMS', 'this device already has open streams');
    const tenantId = d.tenant.id;
    const version = agentVersion(c);
    const res = streamSSE(c, async (stream) => {
      let finish!: () => void;
      const done = new Promise<void>((r) => (finish = r));
      stream.onAbort(() => finish());
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => finish());

      // serialized: a NOTIFY burst becomes one more pass, never two claims racing
      let busy = false;
      let again = false;
      const deliver = async () => {
        if (busy) {
          again = true;
          return;
        }
        busy = true;
        try {
          do {
            again = false;
            const jobs: AgentJob[] = await withTenant(sql, tenantId, (tx) =>
              claimDueJobsTx(tx, tenantId, d.id),
            );
            for (const j of jobs) await send('job', j);
          } while (again);
        } catch (err) {
          agentLog.warn({ err, deviceId: d.id }, 'job delivery failed — next beat retries');
        } finally {
          busy = false;
        }
      };
      const sendConfig = async () => {
        try {
          const printers = await withTenant(sql, tenantId, (tx) =>
            agentPrintersTx(tx, tenantId, d.id),
          );
          await send('config', { printers });
        } catch (err) {
          agentLog.warn({ err, deviceId: d.id }, 'config push failed');
        }
      };
      const revoke = async () => {
        await send('revoked', {});
        finish();
      };

      const unsubscribe = await hub.subscribe(d.id, (s) => {
        if (s === 'job') void deliver();
        else if (s === 'config') void sendConfig();
        else if (s === 'revoked') void revoke();
        else {
          void sendConfig();
          void deliver();
        }
      });
      let beat: ReturnType<typeof setInterval> | undefined;
      let lifetime: ReturnType<typeof setTimeout> | undefined;
      // compared as text: the column keeps microseconds that a Date (or a parameter postgres.js
      // types as timestamptz) drops, and the close below must match this connection exactly
      let connectedAt: string | undefined;
      try {
        const opened = await withTenant(sql, tenantId, async (tx) => {
          const [row] = await tx<{ connected_at: string; name: string }[]>`
            update print_devices
            set connected_at = clock_timestamp(), last_seen_at = clock_timestamp(),
                agent_version = coalesce(${version}, agent_version)
            where tenant_id = ${tenantId} and id = ${d.id}
            returning connected_at::text, name`;
          if (row) await emitAdminTx(tx, tenantId, 'printers', d.id);
          return row ? { ...row, printers: await agentPrintersTx(tx, tenantId, d.id) } : undefined;
        });
        if (!opened) {
          await send('revoked', {});
          return;
        }
        connectedAt = opened.connected_at;
        await send('hello', {
          device: { id: d.id, name: opened.name },
          store: { name: d.tenant.name },
          printers: opened.printers,
        });
        void deliver();

        // each beat proves this credential still opens this device in an active store (a new
        // pairing rotates it, a suspension closes the store), rescans what's due and keeps
        // proxies awake
        beat = setInterval(async () => {
          try {
            const alive = await withTenant(
              sql,
              tenantId,
              (tx) => tx`
                update print_devices d set last_seen_at = now()
                from tenants t
                where d.tenant_id = ${tenantId} and d.id = ${d.id}
                  and d.token_hash = ${d.tokenHash}
                  and t.id = d.tenant_id and t.status = 'active'
                returning d.id`,
            );
            if (alive.length === 0) return void revoke();
            // a plan that lost printing ends the stream; the reconnect is refused PLAN_REQUIRED
            if (!(await withTenant(sql, tenantId, (tx) => planHas(tx, tenantId, 'printing'))))
              return void finish();
          } catch {
            /* the database blinked: keep the stream, the next beat asks again */
          }
          await send('ping', {});
          void deliver();
        }, BEAT_MS);
        lifetime = setTimeout(finish, STREAM_MAX_MS);
        await done;
      } finally {
        unsubscribe();
        clearInterval(beat);
        clearTimeout(lifetime);
      }
      // only this stream's own connection: a reconnect that already landed stays online
      await withTenant(sql, tenantId, async (tx) => {
        const rows = await tx`
          update print_devices set disconnected_at = clock_timestamp()
          where tenant_id = ${tenantId} and id = ${d.id}
            and connected_at::text = ${connectedAt}
          returning id`;
        if (rows.length > 0) await emitAdminTx(tx, tenantId, 'printers', d.id);
      }).catch((err) => agentLog.warn({ err, deviceId: d.id }, 'disconnect not recorded'));
    });
    c.header('cache-control', 'no-cache, no-transform');
    c.header('x-accel-buffering', 'no');
    return c.newResponse(res.body);
  });

  admin.post('/agent/jobs/:id/result', async (c) => {
    const d = await device(c, { plan: false });
    const jobId = uuidParam(c, 'id');
    return o.idempotency(sql, async (c2, tx) => {
      const body = await bodyJson(c2, 2 * 1024);
      if (typeof body.ok !== 'boolean')
        throw new HttpError(422, 'BAD_REQUEST', 'ok must be true or false', { field: 'ok' });
      const error = body.ok
        ? null
        : typeof body.error === 'string' && body.error.trim()
          ? body.error.trim().slice(0, 200)
          : 'Falha ao imprimir';
      const orderId = await recordJobResultTx(tx, d.tenant.id, d.id, jobId, {
        ok: body.ok,
        error,
      });
      await emitAdminTx(tx, d.tenant.id, 'printers', jobId);
      // Início's "a comanda não imprimiu" follows the order's tickets
      if (orderId) await emitAdminTx(tx, d.tenant.id, 'order.changed', orderId);
      return { status: 200, body: {} };
    })(c);
  });

  admin.put('/agent/printers', async (c) => {
    const d = await device(c);
    return o.idempotency(sql, async (c2, tx) => {
      const body = await bodyJson(c2, 64 * 1024);
      if (!Array.isArray(body.printers) || body.printers.length > MAX_PRINTERS)
        throw new HttpError(
          422,
          'BAD_REQUEST',
          `printers must be a list of at most ${MAX_PRINTERS}`,
          {
            field: 'printers',
          },
        );
      const seen = new Set<string>();
      const printers: ReportedPrinter[] = [];
      for (const p of body.printers as unknown[]) {
        const r = (p ?? {}) as Record<string, unknown>;
        const kind = r.kind;
        if (typeof kind !== 'string' || !PRINTER_KINDS.includes(kind as PrinterKind))
          throw new HttpError(422, 'BAD_REQUEST', 'unknown printer kind', { field: 'kind' });
        const key = shortText(r.key, 'key', 200);
        if (seen.has(key)) continue;
        seen.add(key);
        printers.push({
          key,
          kind: kind as PrinterKind,
          name: shortText(r.name, 'name', 200),
          address: shortText(r.address, 'address', 200),
        });
      }
      await reportPrintersTx(tx, d.tenant.id, d.id, printers);
      await notifyDeviceTx(tx, d.tenant.id, d.id, 'config');
      await emitAdminTx(tx, d.tenant.id, 'printers', d.id);
      return {
        status: 200,
        body: { printers: await agentPrintersTx(tx, d.tenant.id, d.id) },
      };
    })(c);
  });

  admin.post('/agent/printers/:id/test', async (c) => {
    const d = await device(c);
    const printerId = uuidParam(c, 'id');
    return o.idempotency(sql, async (_c2, tx) => {
      const own = await tx`
        select 1 from printers
        where tenant_id = ${d.tenant.id} and device_id = ${d.id} and id = ${printerId}`;
      if (own.length === 0) throw new HttpError(404, 'PRINTER_NOT_FOUND', 'printer not found');
      const [jobId] = await queueJobsTx(tx, d.tenant.id, [printerId], {
        kind: 'test',
        trigger: 'test',
      });
      return { status: 202, body: { jobId } };
    })(c);
  });

  admin.delete('/agent/self', async (c) => {
    const d = await device(c, { plan: false });
    return o.idempotency(sql, async (_c2, tx) => {
      await tx`delete from print_devices where tenant_id = ${d.tenant.id} and id = ${d.id}`;
      await notifyDeviceTx(tx, d.tenant.id, d.id, 'revoked');
      await emitAdminTx(tx, d.tenant.id, 'printers', d.id);
      return { status: 200, body: {} };
    })(c);
  });
}
