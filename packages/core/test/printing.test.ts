import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { networkAddress } from '../src/admin/routes-print.ts';
import { migrate, withTenant } from '../src/platform/db.ts';
import { normalizeUserCode } from '../src/modules/printing/devices.ts';
import { Receipt, encodeText, wrap } from '../src/modules/printing/escpos.ts';
import { claimDueJobsTx, enqueueOrderPrintTx } from '../src/modules/printing/jobs.ts';
import { LATE_AFTER_MS, renderOrderTicket } from '../src/modules/printing/ticket.ts';
import type { OrderView } from '../src/modules/orders.ts';

const bytes = (s: string) => [...s].map((c) => c.charCodeAt(0));
const has = (hay: Uint8Array | number[], needle: number[]) => {
  const h = [...hay];
  outer: for (let i = 0; i <= h.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (h[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};
const count = (hay: Uint8Array | number[], needle: number[]) => {
  let n = 0;
  const h = [...hay];
  for (let i = 0; i <= h.length - needle.length; i++)
    if (needle.every((b, j) => h[i + j] === b)) n++;
  return n;
};
const CUT = [0x1d, 0x56, 0x42, 0x03];

describe('ESC/POS', () => {
  test('text goes out in the printer code page, the rest folds to ASCII', () => {
    expect(encodeText('Ação', 'cp850')).toEqual([0x41, 0x87, 0xc6, 0x6f]);
    expect(encodeText('Ação', 'cp860')).toEqual([0x41, 0x87, 0x84, 0x6f]);
    expect(encodeText('Ação', 'ascii')).toEqual(bytes('Acao'));
    expect(encodeText('Õ É ô', 'cp850')).toEqual([0xe5, 0x20, 0x90, 0x20, 0x93]);
    expect(encodeText('pudim 🍮 – já', 'ascii')).toEqual(bytes('pudim  - ja'));
    expect(encodeText('a\tb\u0007c', 'cp850')).toEqual(bytes('abc'));
  });

  test('wrap keeps words whole and splits only what never fits', () => {
    expect(wrap('Pudim de leite condensado', 10)).toEqual(['Pudim de', 'leite', 'condensado']);
    expect(wrap('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl']);
    expect(wrap('a\nb', 5)).toEqual(['a', 'b']);
  });

  test('a receipt starts by resetting and picking the code page', () => {
    const r = new Receipt(58, 'cp850').text('oi').done();
    expect([...r.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 2]);
    expect(new Receipt(80, 'ascii').columns).toBe(48);
    expect([...new Receipt(80, 'ascii').done()]).toEqual([0x1b, 0x40]);
  });

  const order: OrderView = {
    id: crypto.randomUUID(),
    number: 42,
    state: 'confirmed',
    customer: { name: 'Joana Lima', phone: '22988887777' },
    delivery: { mode: 'delivery', address: 'Rua das Flores, 12', neighborhood: 'Centro' },
    payment: { provider: 'sandbox', method: 'pix', status: 'paid' },
    items: [
      {
        productId: null,
        slug: 'pudim',
        name: 'Pudim de Leite',
        qty: 2,
        unitPriceCents: 1250,
        modifiers: [{ name: 'Calda extra', priceDeltaCents: 200, qty: 1 }],
        combo: [],
        lineTotalCents: 2900,
      },
    ],
    notes: 'Sem açúcar',
    scheduledFor: null,
    subtotalCents: 2900,
    deliveryFeeCents: 500,
    discountCents: 0,
    paymentAdjustmentCents: 0,
    coupon: null,
    totalCents: 123456,
    placedAt: '2026-10-02T15:30:00.000Z',
    updatedAt: '2026-10-02T15:30:00.000Z',
    version: 1,
    timeline: [],
  };
  const store = { name: 'Quero Pudim', timezone: 'America/Sao_Paulo' };

  test('the kitchen ticket: number, mode, items, notes, total; copies each cut', () => {
    const now = new Date('2026-10-02T15:31:00Z');
    const t = renderOrderTicket(
      order,
      store,
      { paper: 80, codepage: 'cp850', copies: 2, cut: true },
      now,
      now,
    );
    expect(has(t, bytes('#42'))).toBe(true);
    expect(has(t, bytes('ENTREGA'))).toBe(true);
    expect(has(t, bytes('2x Pudim de Leite'))).toBe(true);
    expect(has(t, bytes('+ Calda extra'))).toBe(true);
    expect(has(t, encodeText('Sem açúcar', 'cp850'))).toBe(true);
    expect(has(t, bytes('R$ 1.234,56'))).toBe(true);
    expect(has(t, bytes('Pedido 02/10 '))).toBe(true);
    expect(has(t, bytes('12:30'))).toBe(true);
    expect(count(t, CUT)).toBe(2);
    expect(has(t, bytes('ATRASADA'))).toBe(false);

    const uncut = renderOrderTicket(
      order,
      store,
      { paper: 58, codepage: 'ascii', copies: 1, cut: false },
      new Date(now.getTime() - LATE_AFTER_MS - 1000),
      now,
    );
    expect(count(uncut, CUT)).toBe(0);
    expect(has(uncut, bytes('*** IMPRESSAO ATRASADA ***'))).toBe(true);

    // a partial refund leaves the rest captured: the door must not charge again
    const refunded = renderOrderTicket(
      { ...order, payment: { ...order.payment, status: 'partially_refunded' } },
      store,
      { paper: 80, codepage: 'cp850', copies: 1, cut: true },
      now,
      now,
    );
    expect(has(refunded, bytes('Pix - PAGO'))).toBe(true);
    expect(has(refunded, bytes('cobrar'))).toBe(false);
  });

  test('inputs from the merchant and the agent are bounded', () => {
    expect(networkAddress('192.168.0.50')).toBe('192.168.0.50:9100');
    expect(networkAddress(' Impressora.local:9101 ')).toBe('impressora.local:9101');
    expect(() => networkAddress('http://x')).toThrow();
    expect(() => networkAddress('1.2.3.4:70000')).toThrow();
    expect(normalizeUserCode('k7qd-4mxa')).toBe('K7QD4MXA');
    expect(normalizeUserCode('K7QD4MX')).toBeNull();
    expect(normalizeUserCode(12345678)).toBeNull();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('printing (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const codes = new Map<string, string>();
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => {
      codes.set(phone, /(\d{6})/.exec(text)![1]!);
    },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `pr-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `218${String(Date.now()).slice(-8)}`;
  const otherPhone = `218${String(Date.now() + 3).slice(-8)}`;
  let tenantId = '';
  let tenant2 = '';
  let productId = '';
  let idem = 0;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://core.localhost${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      cookie: res.headers.get('set-cookie'),
    };
  };

  const signIn = async (phone: string) => {
    expect((await call('POST', '/admin/v1/auth/otp/start', { phone })).status).toBe(200);
    const r = await call('POST', '/admin/v1/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.body.signedIn).toBe(true);
    const value = /vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!;
    return (method: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
      call(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${value}`, ...h });
  };

  /** an agent's side of the wire: token auth, its own idempotency keys */
  const agent = (token: string) => (method: string, path: string, body?: unknown) =>
    call(method, `/admin/v1/agent${path}`, body, {
      authorization: `Bearer ${token}`,
      'x-agent-version': '0.1.0',
      'x-agent-platform': 'windows',
    });

  const openStream = async (token: string) => {
    // a dropped connection reaches Core as the request's abort signal
    const ctl = new AbortController();
    const res = await app.request('http://core.localhost/admin/v1/agent/stream', {
      signal: ctl.signal,
      headers: {
        host: 'core.localhost',
        authorization: `Bearer ${token}`,
        'x-agent-version': '0.1.0',
      },
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const events: { event: string; data: any }[] = [];
    let buf = '';
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const raw = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let event = 'message';
            let data = '';
            for (const line of raw.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            events.push({ event, data: data ? JSON.parse(data) : null });
          }
        }
      } catch {
        /* cancelled */
      }
    })();
    const next = async (name: string, ms = 5000) => {
      const deadline = Date.now() + ms;
      for (;;) {
        const i = events.findIndex((e) => e.event === name);
        if (i >= 0) return events.splice(i, 1)[0]!.data;
        if (Date.now() > deadline) throw new Error(`no ${name} event`);
        await new Promise((r) => setTimeout(r, 25));
      }
    };
    return {
      next,
      events,
      close: async () => {
        ctl.abort();
        await reader.cancel().catch(() => undefined);
      },
    };
  };

  const placeOrder = async () => {
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    const auth = { host, authorization: `Bearer ${s.body.sessionToken}` };
    expect(
      (await call('POST', '/checkout/v1/cart/items', { productId, qty: 2 }, auth)).status,
    ).toBe(200);
    const placed = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Joana Lima', phone: '(22) 98888-7777' },
        delivery: { mode: 'pickup' },
        payment: { method: 'pix' },
      },
      auth,
    );
    expect(placed.status).toBe(201);
    return placed.body.order as { id: string; number: number };
  };

  let owner: Awaited<ReturnType<typeof signIn>>;
  let other: Awaited<ReturnType<typeof signIn>>;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const mk = async (s: string) =>
      (
        await sql<
          { id: string }[]
        >`insert into tenants (slug, name) values (${s}, ${'Loja ' + s}) returning id`
      )[0]!.id;
    tenantId = await mk(slug);
    tenant2 = await mk(`${slug}-b`);
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Maria Souza', ${ownerPhone}, 'owner')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenant2}, 'Outra Dona', ${otherPhone}, 'owner')`;
    owner = await signIn(ownerPhone);
    other = await signIn(otherPhone);
    const catId = (
      await sql<
        { id: string }[]
      >`insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id`
    )[0]!.id;
    const p = await owner('POST', '/products', {
      name: 'Pudim de Leite',
      categoryId: catId,
      priceCents: 1250,
    });
    expect(p.status).toBe(201);
    productId = p.body.product.id;
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id in (${tenantId}, ${tenant2})`;
    await sql`delete from print_pairings where device_name like ${`%${nonce}%`}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  let token = '';
  let deviceId = '';
  let printerId = '';

  test('pairing: the agent asks, the merchant approves, the agent collects its token once', async () => {
    const pair = await call('POST', '/admin/v1/agent/pair', {
      platform: 'windows',
      name: `CAIXA-${nonce}`,
      version: '0.1.0',
    });
    expect(pair.status).toBe(200);
    expect(pair.body.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(pair.body.approveUrl).toContain(`/admin/impressoras/parear?code=${pair.body.userCode}`);
    const poll = () =>
      call('POST', '/admin/v1/agent/pair/poll', { deviceCode: pair.body.deviceCode });
    expect((await poll()).body).toEqual({ status: 'pending' });
    expect((await call('POST', '/admin/v1/agent/pair/poll', { deviceCode: 'x' })).status).toBe(404);

    const code = pair.body.userCode.toLowerCase();
    const seen = await owner('GET', `/printers/pairing/${code}`);
    expect(seen.body).toMatchObject({ status: 'pending', platform: 'windows' });
    expect((await owner('GET', '/printers/pairing/nope')).status).toBe(404);

    const ok = await owner('POST', '/printers/pairing', { code });
    expect(ok.status).toBe(200);
    deviceId = ok.body.deviceId;
    expect(ok.body.devices[0]).toMatchObject({ id: deviceId, ready: false, online: false });
    // approving again is the same device; another store can't take the code
    expect((await owner('POST', '/printers/pairing', { code })).body.deviceId).toBe(deviceId);
    expect((await other('POST', '/printers/pairing', { code })).body.error.code).toBe(
      'PAIRING_TAKEN',
    );
    expect((await other('GET', `/printers/pairing/${code}`)).body.status).toBe('taken');

    const first = await poll();
    expect(first.body.status).toBe('approved');
    expect(first.body.store.name).toBe(`Loja ${slug}`);
    // a lost answer is recoverable: polling again rotates, and only the latest token works
    const second = await poll();
    expect((await agent(first.body.token)('PUT', '/printers', { printers: [] })).status).toBe(401);
    token = second.body.token;
    expect((await owner('GET', '/printers')).body.devices[0].ready).toBe(true);

    expect((await agent('nope')('PUT', '/printers', { printers: [] })).status).toBe(401);
    const forged = `${tenantId}.${deviceId}.${'A'.repeat(43)}`;
    expect((await agent(forged)('PUT', '/printers', { printers: [] })).body.error.code).toBe(
      'UNAUTHENTICATED',
    );
  });

  test('the agent reports printers; the merchant configures them; bad input is a 4xx', async () => {
    const a = agent(token);
    const rep = await a('PUT', '/printers', {
      printers: [
        {
          key: 'spooler:EPSON TM-T20',
          kind: 'spooler',
          name: 'EPSON TM-T20',
          address: 'EPSON TM-T20',
        },
        { key: 'serial:COM3', kind: 'serial', name: 'COM3', address: 'COM3' },
      ],
    });
    expect(rep.status).toBe(200);
    expect(rep.body.printers.length).toBe(2);
    printerId = rep.body.printers.find((p: any) => p.kind === 'spooler').id;
    expect((await a('PUT', '/printers', { printers: [{ kind: 'laser' }] })).status).toBe(422);
    expect((await a('PUT', '/printers', { printers: 'x' })).status).toBe(422);

    // COM3 vanished: still listed, marked absent
    await a('PUT', '/printers', {
      printers: [
        {
          key: 'spooler:EPSON TM-T20',
          kind: 'spooler',
          name: 'EPSON TM-T20',
          address: 'EPSON TM-T20',
        },
      ],
    });
    const list = (await owner('GET', '/printers')).body.devices[0].printers;
    expect(list.map((p: any) => [p.reportedName, p.present])).toEqual([
      ['COM3', false],
      ['EPSON TM-T20', true],
    ]);

    const patched = await owner('PATCH', `/printers/${printerId}`, {
      auto: true,
      paper: 58,
      copies: 2,
      label: 'Cozinha',
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ name: 'Cozinha', auto: true, paper: 58, copies: 2 });
    expect((await owner('PATCH', `/printers/${printerId}`, { copies: 9 })).status).toBe(422);
    expect((await owner('PATCH', `/printers/${printerId}`, {})).status).toBe(422);
    expect((await owner('PATCH', '/printers/not-a-uuid', { auto: true })).status).toBe(400);

    const net = await owner('POST', `/printers/devices/${deviceId}/printers`, {
      address: '192.168.0.77',
    });
    expect(net.status).toBe(201);
    expect(net.body).toMatchObject({ kind: 'tcp', address: '192.168.0.77:9100', source: 'manual' });
    expect(
      (await owner('POST', `/printers/devices/${deviceId}/printers`, { address: 'x y' })).status,
    ).toBe(422);
    expect((await owner('DELETE', `/printers/${net.body.id}`)).status).toBe(200);

    // another store sees none of it and can't touch it
    expect((await other('GET', '/printers')).body.devices).toEqual([]);
    expect((await other('PATCH', `/printers/${printerId}`, { auto: false })).status).toBe(404);
    expect((await other('POST', `/printers/${printerId}/test`)).status).toBe(404);
  });

  test('stream: hello, order tickets on accept, results, manual and test prints', async () => {
    const s = await openStream(token);
    try {
      const hello = await s.next('hello');
      expect(hello.device.id).toBe(deviceId);
      expect(hello.printers.find((p: any) => p.id === printerId)).toMatchObject({
        name: 'Cozinha',
        kind: 'spooler',
        address: 'EPSON TM-T20',
      });
      expect((await owner('GET', '/printers')).body.devices[0]).toMatchObject({
        online: true,
        version: '0.1.0',
      });

      // prints at "aceitar" by default: placing queues nothing
      const order = await placeOrder();
      const queued = await sql<{ n: number }[]>`
        select count(*)::int as n from print_jobs where order_id = ${order.id}`;
      expect(queued[0]!.n).toBe(0);
      expect(
        (
          await owner('POST', `/orders/${order.id}/transition`, {
            to: 'confirmed',
            prepMinutes: 15,
          })
        ).status,
      ).toBe(200);
      const job = await s.next('job');
      expect(job.printerId).toBe(printerId);
      const data = Buffer.from(job.data, 'base64');
      expect(has(data, bytes(`#${order.number}`))).toBe(true);
      expect(has(data, bytes('RETIRADA'))).toBe(true);
      expect(count(data, CUT)).toBe(2);

      // a replayed step never prints twice
      expect(
        await withTenant(appSql, tenantId, (tx) =>
          enqueueOrderPrintTx(tx, tenantId, order.id, 'confirmed'),
        ),
      ).toBe(0);

      const a = agent(token);
      const res = await call(
        'POST',
        `/admin/v1/agent/jobs/${job.id}/result`,
        { ok: true },
        {
          authorization: `Bearer ${token}`,
          'idempotency-key': `job-result-${job.id}`,
        },
      );
      expect(res.status).toBe(200);
      const replay = await call(
        'POST',
        `/admin/v1/agent/jobs/${job.id}/result`,
        { ok: true },
        {
          authorization: `Bearer ${token}`,
          'idempotency-key': `job-result-${job.id}`,
        },
      );
      expect(replay.status).toBe(200);
      expect((await a('POST', `/jobs/${crypto.randomUUID()}/result`, { ok: true })).status).toBe(
        404,
      );
      const after = (await owner('GET', '/printers')).body.devices[0].printers.find(
        (p: any) => p.id === printerId,
      );
      expect(after.lastOkAt).not.toBeNull();

      // "imprimir comanda" on demand, then a failure the merchant can see
      const manual = await owner('POST', `/orders/${order.id}/print`, {});
      expect(manual.status).toBe(202);
      expect(manual.body).toEqual({ jobs: 1, printers: ['Cozinha'] });
      const again = await s.next('job');
      expect(
        (await a('POST', `/jobs/${again.id}/result`, { ok: false, error: 'Sem papel' })).status,
      ).toBe(200);
      const failed = (await owner('GET', '/printers')).body.devices[0].printers.find(
        (p: any) => p.id === printerId,
      );
      expect(failed.lastError).toBe('Sem papel');

      expect((await owner('POST', `/printers/${printerId}/test`)).status).toBe(202);
      const testJob = await s.next('job');
      expect(has(Buffer.from(testJob.data, 'base64'), bytes('Teste de impress'))).toBe(true);
      expect((await a('POST', `/printers/${printerId}/test`)).status).toBe(202);
      await s.next('job');

      // print as soon as orders arrive
      expect((await owner('PATCH', '/printers/settings', { printOn: 'placed' })).body.printOn).toBe(
        'placed',
      );
      const fresh = await placeOrder();
      const placedJob = await s.next('job');
      expect(has(Buffer.from(placedJob.data, 'base64'), bytes(`#${fresh.number}`))).toBe(true);

      // switching when the store prints, mid-order, keeps exactly one automatic ticket per order:
      // printed on arrival → not again on accept; arrived before the switch → printed on accept
      const autoJobs = async (orderId: string) =>
        (
          await sql<{ n: number }[]>`
            select count(*)::int as n from print_jobs
            where order_id = ${orderId} and trigger in ('placed', 'confirmed')`
        )[0]!.n;
      await owner('PATCH', '/printers/settings', { printOn: 'confirmed' });
      expect(
        (
          await owner('POST', `/orders/${fresh.id}/transition`, {
            to: 'confirmed',
            prepMinutes: 15,
          })
        ).status,
      ).toBe(200);
      expect(await autoJobs(fresh.id)).toBe(1);
      const before = await placeOrder();
      await owner('PATCH', '/printers/settings', { printOn: 'placed' });
      expect(await autoJobs(before.id)).toBe(0);
      expect(
        (
          await owner('POST', `/orders/${before.id}/transition`, {
            to: 'confirmed',
            prepMinutes: 15,
          })
        ).status,
      ).toBe(200);
      const late = await s.next('job');
      expect(has(Buffer.from(late.data, 'base64'), bytes(`#${before.number}`))).toBe(true);
      expect(await autoJobs(before.id)).toBe(1);

      // an unanswered job is handed over again after a minute; config edits reach the agent
      await sql`update print_jobs set sent_at = now() - interval '2 minutes' where id = ${placedJob.id}`;
      const resent = await withTenant(appSql, tenantId, (tx) =>
        claimDueJobsTx(tx, tenantId, deviceId),
      );
      expect(resent.map((j) => j.id)).toContain(placedJob.id);
      await owner('PATCH', `/printers/${printerId}`, { label: 'Balcão' });
      const cfg = await s.next('config');
      expect(cfg.printers.find((p: any) => p.id === printerId).name).toBe('Balcão');

      // a closed stream is offline at once, not when its last beat goes stale
      await s.close();
      const online = async () => (await owner('GET', '/printers')).body.devices[0].online;
      for (let i = 0; i < 40 && (await online()); i++) await new Promise((r) => setTimeout(r, 50));
      expect(await online()).toBe(false);
      const again2 = await openStream(token);
      await again2.next('hello');
      expect(await online()).toBe(true);

      // removing the device closes its stream and its token
      expect((await owner('DELETE', `/printers/devices/${deviceId}`)).status).toBe(200);
      await again2.next('revoked');
      await again2.close();
      expect((await a('PUT', '/printers', { printers: [] })).body.error.code).toBe(
        'DEVICE_REVOKED',
      );
      expect((await owner('POST', `/orders/${order.id}/print`, {})).body.error.code).toBe(
        'NO_PRINTERS',
      );
    } finally {
      await s.close();
    }
  });
});
