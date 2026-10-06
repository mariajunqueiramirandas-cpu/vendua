import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import postgres from 'postgres';
import { withTenant } from '../src/platform/db.ts';
import { claimTx, errorJson, HttpError, idempotency } from '../src/platform/http.ts';
import type { Tenant } from '../src/platform/tenancy.ts';

// The claim, the work and the stored result are one transaction: a same-key request that
// arrives while the first is still running waits on the key's row, then replays what committed
// (or runs, when the first rolled back). Only a pending row an older Core committed on its own
// is "in progress", and it is taken over after 30 s.
describe.skipIf(!process.env.TEST_DATABASE_URL)('idempotency claim under concurrency (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  let tenantId = '';
  let runs = 0;
  /** holds the next run open: `entered` once it started, until `release()` */
  type Gate = {
    entered: Promise<void>;
    enter: () => void;
    done: Promise<void>;
    release: () => void;
    fail: boolean;
  };
  let gate: Gate | null = null;
  const hold = (fail = false): Gate => {
    const g = { fail } as Gate;
    g.entered = new Promise<void>((r) => (g.enter = r));
    g.done = new Promise<void>((r) => (g.release = r));
    gate = g;
    return g;
  };

  const app = new Hono<{ Variables: { tenant: Tenant } }>();
  app.onError((e, c) => errorJson(e, c));
  app.use('*', async (c, next) => {
    c.set('tenant', { id: tenantId, slug: 'x', name: 'x', status: 'active' });
    await next();
  });
  app.post(
    '/a',
    idempotency(sql, async () => {
      const n = ++runs;
      const g = gate;
      if (g) {
        gate = null;
        g.enter();
        await g.done;
        if (g.fail) throw new HttpError(422, 'BAD_REQUEST', 'first attempt fails');
      }
      return { status: 201, body: { run: n } };
    }),
  );
  const post = async (key: string, auth = 'Bearer vst.cart-1.sig') =>
    app.request('/a', { method: 'POST', headers: { 'idempotency-key': key, authorization: auth } });
  const pending = (p: Promise<unknown>) => {
    let done = false;
    void p.then(
      () => (done = true),
      () => (done = true),
    );
    return () => done;
  };

  beforeAll(async () => {
    const slug = `claim-${crypto.randomUUID().slice(0, 8)}`;
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`
    )[0]!.id;
  });
  afterAll(() => sql.end());

  test('a duplicate sent while the first runs waits for it, then replays its result', async () => {
    const key = crypto.randomUUID();
    const before = runs;
    const g = hold();
    const first = post(key);
    await g.entered;
    const second = post(key);
    const settled = pending(second);
    await Bun.sleep(150);
    expect(settled()).toBe(false);
    g.release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get('x-idempotent-replay')).toBe('true');
    expect(await b.json()).toEqual(await a.json());
    expect(runs - before).toBe(1);
  });

  test('a duplicate waiting on a first attempt that fails runs itself', async () => {
    const key = crypto.randomUUID();
    const before = runs;
    const g = hold(true);
    const first = post(key);
    await g.entered;
    const second = post(key);
    await Bun.sleep(50);
    g.release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(422);
    expect(b.status).toBe(201);
    expect(b.headers.get('x-idempotent-replay')).toBeNull();
    expect(runs - before).toBe(2);
    // the stored result is the second's, replayed from now on
    const again = await post(key);
    expect(again.headers.get('x-idempotent-replay')).toBe('true');
    expect(await again.json()).toEqual({ run: before + 2 });
  });

  test('another caller waiting on the key gets 422 once the first commits', async () => {
    const key = crypto.randomUUID();
    const g = hold();
    const first = post(key);
    await g.entered;
    const other = post(key, 'Bearer vst.cart-2.sig');
    await Bun.sleep(50);
    g.release();
    const [a, b] = await Promise.all([first, other]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(422);
    expect(((await b.json()) as { error: { code: string } }).error.code).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
  });

  test('a pending row an older Core committed is in progress for 30 s, then taken over', async () => {
    const key = crypto.randomUUID();
    await sql`
      insert into idempotency_keys (tenant_id, key, owner, fingerprint)
      values (${tenantId}, ${key}, ${crypto.randomUUID()}, null)`;
    const busy = await post(key);
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { error: { code: string } }).error.code).toBe(
      'IDEMPOTENCY_IN_PROGRESS',
    );
    await sql`
      update idempotency_keys set created_at = now() - interval '31 seconds'
      where tenant_id = ${tenantId} and key = ${key}`;
    const before = runs;
    const taken = await post(key);
    expect(taken.status).toBe(201);
    expect(runs - before).toBe(1);
  });

  test('the sweep drops keys older than 7 days, inside the claiming tx', async () => {
    const old = crypto.randomUUID();
    await sql`
      insert into idempotency_keys (tenant_id, key, owner, fingerprint, response, status_code, created_at)
      values (${tenantId}, ${old}, ${crypto.randomUUID()}, null, ${sql.json({})}, 200, now() - interval '8 days')`;
    const r = await withTenant(sql, tenantId, (tx) =>
      claimTx(tx, tenantId, crypto.randomUUID(), 'fp', async () => ({ status: 200, body: {} }), {
        sweep: true,
      }),
    );
    expect(r.replayed).toBe(false);
    expect(
      (await sql`select 1 from idempotency_keys where tenant_id = ${tenantId} and key = ${old}`)
        .length,
    ).toBe(0);
  });
});
