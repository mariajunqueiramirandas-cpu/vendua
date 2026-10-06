import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import {
  approvePairingTx,
  devicesTx,
  normalizeUserCode,
  pairingByCodeTx,
} from '../modules/printing/devices.ts';
import {
  notifyDeviceTx,
  orderJobsTx,
  printersTx,
  queueJobsTx,
  type PrinterView,
} from '../modules/printing/jobs.ts';
import { planHas, requireFeature } from '../modules/billing/plans.ts';
import { audit } from './audit.ts';
import { bool, int, oneOf, optText, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';

// Impressoras (ADR 0027): the store's print agents and their printers. Core renders every ticket;
// agents only move bytes. The merchant pairs an agent here, picks which printers print orders
// automatically and how (paper, code page, copies), and can print any order on demand.

const RELEASES = 'https://github.com/mariajunqueiramirandas-cpu/vendua/releases/latest/download';
export const AGENT_DOWNLOADS = {
  windows: `${RELEASES}/vendua-impressora.exe`,
  android: `${RELEASES}/vendua-impressora.apk`,
};

const HOST_RE =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** `192.168.0.50`, `192.168.0.50:9100`, `impressora.local` → `host:port` */
export function networkAddress(v: unknown): string {
  const bad = () =>
    new HttpError(422, 'BAD_REQUEST', 'type the printer IP, e.g. 192.168.0.50', {
      field: 'address',
    });
  if (typeof v !== 'string' || v.length > 260) throw bad();
  const m = /^([^:\s]+)(?::(\d{1,5}))?$/.exec(v.trim().toLowerCase());
  if (!m || !HOST_RE.test(m[1]!)) throw bad();
  const port = m[2] ? Number(m[2]) : 9100;
  if (port < 1 || port > 65535) throw bad();
  return `${m[1]}:${port}`;
}

async function printerOr404(tx: Sql, tenantId: string, id: string): Promise<PrinterView> {
  const p = (await printersTx(tx, tenantId)).find((x) => x.id === id);
  if (!p) throw new HttpError(404, 'PRINTER_NOT_FOUND', 'printer not found');
  return p;
}

async function overview(tx: Sql, tenantId: string) {
  const [s] = await tx<{ print_on: 'placed' | 'confirmed' }[]>`
    select print_on from store_settings where tenant_id = ${tenantId}`;
  // a plan without printing shows no devices: the order screen then offers no "imprimir"
  const included = await planHas(tx, tenantId, 'printing');
  return {
    included,
    printOn: s?.print_on ?? 'confirmed',
    devices: included ? await devicesTx(tx, tenantId) : [],
    downloads: AGENT_DOWNLOADS,
  };
}

export function mountPrinting(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  // attendants read it too: the order screen asks whether there's a printer to send to
  admin.get(
    '/printers',
    read('attendant', (tx, t) => overview(tx, t.id)),
  );

  admin.patch(
    '/printers/settings',
    write('manager', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'printing');
      const body = await bodyJson(c, 1024);
      const printOn = oneOf(body.printOn, 'printOn', ['placed', 'confirmed'] as const);
      await tx`insert into store_settings (tenant_id) values (${t.id}) on conflict do nothing`;
      const [row] = await tx<{ before: string }[]>`
        update store_settings s set print_on = ${printOn}
        from (select print_on as before from store_settings where tenant_id = ${t.id} for update) old
        where s.tenant_id = ${t.id}
        returning old.before`;
      if (!row) throw new HttpError(404, 'STORE_NOT_FOUND', 'store settings not found');
      await audit(tx, t.id, m, {
        action: 'printers.settings',
        entity: 'printers',
        summary:
          printOn === 'placed'
            ? 'passou a imprimir os pedidos assim que chegam'
            : 'passou a imprimir os pedidos ao aceitar',
        before: { printOn: row.before },
        after: { printOn },
      });
      await emitAdminTx(tx, t.id, 'printers', 'settings');
      return { status: 200, body: await overview(tx, t.id) };
    }),
  );

  admin.get(
    '/printers/pairing/:code',
    read('manager', async (tx, t, _m, c) => {
      await requireFeature(tx, t.id, 'printing');
      const code = normalizeUserCode(c.req.param('code'));
      if (!code) throw new HttpError(404, 'PAIRING_NOT_FOUND', 'pairing not found');
      return pairingByCodeTx(tx, t.id, code);
    }),
  );

  admin.post(
    '/printers/pairing',
    write('manager', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'printing');
      const body = await bodyJson(c, 1024);
      const code = normalizeUserCode(body.code);
      if (!code)
        throw new HttpError(422, 'BAD_REQUEST', 'type the 8-character code shown on the device', {
          field: 'code',
        });
      const dev = await approvePairingTx(tx, t.id, code, m.userId);
      if (dev.created) {
        await audit(tx, t.id, m, {
          action: 'printers.pair',
          entity: 'print_device',
          entityId: dev.deviceId,
          summary: `conectou ${dev.name} para imprimir pedidos`,
          after: { name: dev.name, platform: dev.platform },
        });
        await emitAdminTx(tx, t.id, 'printers', dev.deviceId);
      }
      return { status: 200, body: { deviceId: dev.deviceId, ...(await overview(tx, t.id)) } };
    }),
  );

  admin.delete(
    '/printers/devices/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const [dev] = await tx<{ name: string }[]>`
        delete from print_devices where tenant_id = ${t.id} and id = ${id} returning name`;
      if (!dev) throw new HttpError(404, 'DEVICE_NOT_FOUND', 'device not found');
      await notifyDeviceTx(tx, t.id, id, 'revoked');
      await audit(tx, t.id, m, {
        action: 'printers.unpair',
        entity: 'print_device',
        entityId: id,
        summary: `desconectou ${dev.name}`,
        before: { name: dev.name },
      });
      await emitAdminTx(tx, t.id, 'printers', id);
      return { status: 200, body: await overview(tx, t.id) };
    }),
  );

  admin.post(
    '/printers/devices/:id/printers',
    write('manager', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'printing');
      const deviceId = uuidParam(c, 'id');
      const body = await bodyJson(c, 1024);
      const address = networkAddress(body.address);
      const label = optText(body.label, 'label', 60) ?? null;
      const own =
        await tx`select 1 from print_devices where tenant_id = ${t.id} and id = ${deviceId}`;
      if (own.length === 0) throw new HttpError(404, 'DEVICE_NOT_FOUND', 'device not found');
      const [row] = await tx<{ id: string }[]>`
        insert into printers (tenant_id, device_id, key, kind, name, address, source, label)
        values (${t.id}, ${deviceId}, ${`tcp:${address}`}, 'tcp', ${`Rede ${address}`}, ${address},
                'manual', ${label})
        -- the agent may have found it in a scan already: adding it by hand makes it the merchant's,
        -- so a later scan that misses it can't mark it absent
        on conflict (device_id, key) do update
          set present = true, source = 'manual', label = coalesce(excluded.label, printers.label),
              updated_at = now()
        returning id`;
      await notifyDeviceTx(tx, t.id, deviceId, 'config');
      await audit(tx, t.id, m, {
        action: 'printers.add',
        entity: 'printer',
        entityId: row!.id,
        summary: `adicionou a impressora de rede ${address}`,
        after: { address, label },
      });
      await emitAdminTx(tx, t.id, 'printers', row!.id);
      return { status: 201, body: await printerOr404(tx, t.id, row!.id) };
    }),
  );

  admin.patch(
    '/printers/:id',
    write('manager', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'printing');
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c, 2 * 1024);
      const before = await printerOr404(tx, t.id, id);
      const set: Record<string, unknown> = {};
      if (body.label !== undefined) set.label = optText(body.label, 'label', 60) ?? null;
      if (body.auto !== undefined) set.auto = bool(body.auto, 'auto');
      if (body.paper !== undefined) set.paper = oneOf(String(body.paper), 'paper', ['58', '80']);
      if (body.codepage !== undefined)
        set.codepage = oneOf(body.codepage, 'codepage', ['cp850', 'cp860', 'ascii'] as const);
      if (body.copies !== undefined) set.copies = int(body.copies, 'copies', 1, 3);
      if (body.cut !== undefined) set.cut = bool(body.cut, 'cut');
      if (Object.keys(set).length === 0)
        throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
      if (set.paper) set.paper = Number(set.paper);
      await tx`
        update printers set ${tx(set)}, updated_at = now()
        where tenant_id = ${t.id} and id = ${id}`;
      const after = await printerOr404(tx, t.id, id);
      if ('label' in set) await notifyDeviceTx(tx, t.id, after.deviceId, 'config');
      await audit(tx, t.id, m, {
        action: 'printers.update',
        entity: 'printer',
        entityId: id,
        summary: `ajustou a impressora ${after.name}`,
        before: pick(before, Object.keys(set)),
        after: pick(after, Object.keys(set)),
      });
      await emitAdminTx(tx, t.id, 'printers', id);
      return { status: 200, body: after };
    }),
  );

  admin.delete(
    '/printers/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const p = await printerOr404(tx, t.id, id);
      await tx`delete from printers where tenant_id = ${t.id} and id = ${id}`;
      await notifyDeviceTx(tx, t.id, p.deviceId, 'config');
      await audit(tx, t.id, m, {
        action: 'printers.remove',
        entity: 'printer',
        entityId: id,
        summary: `removeu a impressora ${p.name}`,
        before: { name: p.name, address: p.address },
      });
      await emitAdminTx(tx, t.id, 'printers', id);
      return { status: 200, body: await overview(tx, t.id) };
    }),
  );

  admin.post(
    '/printers/:id/test',
    write('attendant', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'printing');
      const id = uuidParam(c, 'id');
      await printerOr404(tx, t.id, id);
      const [jobId] = await queueJobsTx(tx, t.id, [id], {
        kind: 'test',
        trigger: 'test',
        requestedBy: m.userId,
      });
      await emitAdminTx(tx, t.id, 'printers', id);
      return { status: 202, body: { jobId } };
    }),
  );

  // the order's tickets: "impresso às 12:03 na Cozinha", or why one didn't come out
  admin.get(
    '/orders/:id/prints',
    read('attendant', async (tx, t, _m, c) => {
      const orderId = uuidParam(c, 'id');
      const order = await tx`select 1 from orders where tenant_id = ${t.id} and id = ${orderId}`;
      if (order.length === 0) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
      return { jobs: await orderJobsTx(tx, t.id, orderId) };
    }),
  );

  // "imprimir comanda": one printer when picked, else every automatic one, else every printer
  admin.post(
    '/orders/:id/print',
    write('attendant', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'printing');
      const orderId = uuidParam(c, 'id');
      const body = await bodyJson(c, 1024);
      const printerId = body.printerId;
      if (printerId !== undefined && printerId !== null && typeof printerId !== 'string')
        throw new HttpError(422, 'BAD_REQUEST', 'printerId must be a uuid', { field: 'printerId' });
      const order = await tx`select 1 from orders where tenant_id = ${t.id} and id = ${orderId}`;
      if (order.length === 0) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
      const printers = await printersTx(tx, t.id);
      let targets: PrinterView[];
      if (printerId) {
        const p = printers.find((x) => x.id === printerId);
        if (!p) throw new HttpError(404, 'PRINTER_NOT_FOUND', 'printer not found');
        targets = [p];
      } else {
        const auto = printers.filter((p) => p.auto && p.present);
        targets = auto.length > 0 ? auto : printers.filter((p) => p.present);
      }
      if (targets.length === 0)
        throw new HttpError(409, 'NO_PRINTERS', 'no printer connected to this store');
      const jobs = await queueJobsTx(
        tx,
        t.id,
        targets.map((p) => p.id),
        { kind: 'order', trigger: 'manual', orderId, requestedBy: m.userId },
      );
      await emitAdminTx(tx, t.id, 'printers', orderId);
      return {
        status: 202,
        body: { jobs: jobs.length, printers: targets.map((p) => p.name) },
      };
    }),
  );
}

function pick(p: PrinterView, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (p as unknown as Record<string, unknown>)[k];
  return out;
}
