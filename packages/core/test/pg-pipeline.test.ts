import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { withTenant } from '../src/platform/db.ts';
import { faultProxy, type ClientMessage, type Fault } from './fixtures/pg-fault-proxy.ts';

// Transactions under faults, with patches/postgres@3.4.7.patch: a transaction never writes to a
// connection that closed under it (unpatched, its ROLLBACK hit the dead socket: an uncaught
// TypeError that exits the process), and a savepoint block's statements go out with its SAVEPOINT.
// A proxy between postgres.js and Postgres rejects a statement on a live connection or cuts the
// connection at an exact message; Postgres itself then shows that nothing ran outside the
// transaction: no row is committed, and a sequence (nextval ignores rollbacks) only moves when a
// statement really ran — inside the transaction Postgres then rolled back.
describe.skipIf(!process.env.TEST_DATABASE_URL)('transactions under faults (db)', () => {
  const url = process.env.TEST_DATABASE_URL!;
  const sql = postgres(url, { onnotice: () => {} });
  const uncaught: unknown[] = [];
  const onUncaught = (e: unknown) => void uncaught.push(e);
  let open: { close(): Promise<void>; end?: () => Promise<void> }[] = [];

  beforeAll(async () => {
    await sql`create schema if not exists pipeline_probe`;
    await sql`create table if not exists pipeline_probe.rows (tag text not null)`;
    await sql`create sequence if not exists pipeline_probe.ran`;
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUncaught);
  });
  afterEach(async () => {
    for (const o of open) await o.close();
    open = [];
  });
  afterAll(async () => {
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onUncaught);
    await sql`drop schema if exists pipeline_probe cascade`;
    await sql.end();
  });

  /** a client that reaches Postgres only through a fault proxy, one connection at a time */
  async function client(rule: (m: ClientMessage) => Fault) {
    const px = await faultProxy(url);
    px.rule = rule;
    const app = `pipeline-${crypto.randomUUID().slice(0, 8)}`;
    const db = postgres(px.url, {
      max: 1,
      onnotice: () => {},
      connect_timeout: 5,
      connection: { application_name: app },
    });
    open.push({ close: async () => (await db.end({ timeout: 1 }), await px.close()) });
    return { db, px, app };
  }

  const committed = async (tag: string) =>
    (await sql<{ tag: string }[]>`select tag from pipeline_probe.rows where tag like ${tag + '%'}`)
      .map((r) => r.tag)
      .sort();
  /** how many times nextval ran — it ignores rollbacks, so it counts what executed at all */
  const ran = async () =>
    Number(
      (
        await sql<{ v: string }[]>`
          select (last_value - case when is_called then 0 else 1 end)::text as v
          from pipeline_probe.ran`
      )[0]!.v,
    );
  /** until Postgres has finished with the client's session (it rolls back an open transaction) */
  const sessionGone = async (app: string) => {
    for (let i = 0; i < 200; i++) {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity where application_name = ${app}`;
      if (row!.n === 0) return;
      await Bun.sleep(10);
    }
    throw new Error(`session ${app} still open`);
  };
  /** statements a transaction sends together: none awaited before the next */
  const pipelined = (tx: postgres.TransactionSql, tag: string) =>
    Promise.all([
      tx`select nextval('pipeline_probe.ran')`,
      tx`insert into pipeline_probe.rows (tag) values (${tx.unsafe(`'${tag}'`)})`,
      tx`insert into pipeline_probe.rows (tag) values (${tx.unsafe(`'${tag}-2'`)})`,
    ]);
  const isBegin = (m: ClientMessage) => m.type === 'Q' && /^\s*begin\b/i.test(m.text ?? '');
  /** nothing the dead transaction sent shows up on a later connection, and the pool recovers */
  const cleanAfter = async (c: Awaited<ReturnType<typeof client>>) => {
    const first = c.px.log[0]!.conn;
    c.px.rule = () => 'forward';
    expect((await c.db`select 1 as ok`)[0]!.ok).toBe(1);
    await Bun.sleep(20);
    expect(
      c.px.log.filter((m) => m.conn !== first && /pipeline_probe|rollback/i.test(m.text ?? '')),
    ).toEqual([]);
    expect(uncaught).toEqual([]);
  };

  test('a BEGIN Postgres rejects on a live connection: nothing after it runs', async () => {
    const tag = `rejected-${crypto.randomUUID()}`;
    let failed = false;
    const c = await client((m) => {
      if (!failed && isBegin(m)) {
        failed = true;
        return { sql: 'select 1/0' };
      }
      return 'forward';
    });
    await c.db`select 1`;
    const before = await ran();
    // the caller hears why: BEGIN's own error (here the stand-in's division by zero)
    await expect(c.db.begin((tx) => pipelined(tx, tag))).rejects.toThrow('division by zero');
    await c.db.end({ timeout: 1 }).catch(() => undefined);
    await sessionGone(c.app);
    expect(await committed(tag)).toEqual([]);
    // not even the non-transactional nextval ran: nothing executed outside a transaction
    expect(await ran()).toBe(before);
    expect(uncaught).toEqual([]);
  });

  test('dropped before BEGIN reaches Postgres: nothing runs', async () => {
    const tag = `drop-before-${crypto.randomUUID()}`;
    let armed = true;
    const c = await client((m) => (armed && isBegin(m) ? ((armed = false), 'drop') : 'forward'));
    await c.db`select 1`;
    const before = await ran();
    await expect(c.db.begin((tx) => pipelined(tx, tag))).rejects.toThrow();
    await sessionGone(c.app);
    expect(await committed(tag)).toEqual([]);
    expect(await ran()).toBe(before);
    await cleanAfter(c);
  });

  for (const how of ['forwardThenHangUp', 'forwardThenDrop'] as const)
    test(`dropped right after BEGIN reaches Postgres (${how}): nothing behind it runs`, async () => {
      const tag = `drop-begin-${crypto.randomUUID()}`;
      let armed = true;
      const c = await client((m) => (armed && isBegin(m) ? ((armed = false), how) : 'forward'));
      await c.db`select 1`;
      const before = await ran();
      await expect(c.db.begin((tx) => pipelined(tx, tag))).rejects.toThrow();
      await sessionGone(c.app);
      expect(await committed(tag)).toEqual([]);
      expect(await ran()).toBe(before);
      await cleanAfter(c);
    });

  /** cut the connection right after the Sync that closes the pipelined nextval */
  const afterNextval = (how: 'forwardThenHangUp' | 'forwardThenDrop') => {
    let state: 'wait' | 'nextval' | 'done' = 'wait';
    return (m: ClientMessage): Fault => {
      if (state === 'wait' && m.type === 'P' && /nextval\('pipeline_probe/.test(m.text ?? ''))
        state = 'nextval';
      if (state === 'nextval' && m.type === 'S') return ((state = 'done'), how);
      return 'forward';
    };
  };

  test('hung up mid-pipeline: what reached Postgres ran inside the transaction, then rolled back', async () => {
    const tag = `hangup-mid-${crypto.randomUUID()}`;
    const c = await client(afterNextval('forwardThenHangUp'));
    await c.db`select 1`;
    const before = await ran();
    await expect(c.db.begin((tx) => pipelined(tx, tag))).rejects.toThrow();
    await sessionGone(c.app);
    // the nextval ran (sequences ignore rollback); the inserts never arrived, nothing committed
    expect(await ran()).toBe(before + 1);
    expect(await committed(tag)).toEqual([]);
    await cleanAfter(c);
  });

  test('torn down mid-pipeline: whatever Postgres got to, nothing committed', async () => {
    const tag = `drop-mid-${crypto.randomUUID()}`;
    const c = await client(afterNextval('forwardThenDrop'));
    await c.db`select 1`;
    const before = await ran();
    await expect(c.db.begin((tx) => pipelined(tx, tag))).rejects.toThrow();
    await sessionGone(c.app);
    expect([before, before + 1]).toContain(await ran());
    expect(await committed(tag)).toEqual([]);
    await cleanAfter(c);
  });

  test('dropped instead of COMMIT: the pipelined statements ran in the transaction, none committed', async () => {
    const tag = `drop-commit-${crypto.randomUUID()}`;
    let armed = true;
    const c = await client((m) =>
      armed && m.type === 'P' && /^\s*commit/i.test(m.text ?? '')
        ? ((armed = false), 'drop')
        : 'forward',
    );
    await c.db`select 1`;
    const before = await ran();
    await expect(c.db.begin((tx) => pipelined(tx, tag))).rejects.toThrow();
    await sessionGone(c.app);
    expect(await ran()).toBe(before + 1);
    expect(await committed(tag)).toEqual([]);
    await cleanAfter(c);
  });

  test('a SAVEPOINT Postgres rejects aborts the whole transaction: nothing behind it runs', async () => {
    const tag = `savepoint-${crypto.randomUUID()}`;
    const c = await client((m) =>
      m.type === 'P' && /^\s*savepoint/i.test(m.text ?? '') ? { sql: 'select 1/0' } : 'forward',
    );
    await c.db`select 1`;
    const before = await ran();
    await expect(
      c.db.begin(async (tx) => {
        await tx`insert into pipeline_probe.rows (tag) values (${tx.unsafe(`'${tag}-outer'`)})`;
        await tx.savepoint((sp) => pipelined(sp, tag));
      }),
    ).rejects.toThrow();
    expect(await committed(tag)).toEqual([]);
    expect(await ran()).toBe(before);
    await cleanAfter(c);
  });

  test('healthy transactions through the proxy: committed, tenant GUC applied, one connection', async () => {
    const tag = `healthy-${crypto.randomUUID()}`;
    const c = await client(() => 'forward');
    const tenant = crypto.randomUUID();
    for (let i = 0; i < 100; i++) {
      const [[seen]] = await withTenant(c.db, tenant, (tx) =>
        Promise.all([
          tx<{ t: string }[]>`select current_setting('vendua.tenant_id') as t`,
          tx`insert into pipeline_probe.rows (tag) values (${tx.unsafe(`'${tag}-${i}'`)})`,
        ]),
      );
      expect(seen!.t).toBe(tenant);
    }
    expect((await committed(tag)).length).toBe(100);
    expect(c.px.connections).toBe(1);
    expect(uncaught).toEqual([]);
  });
});
