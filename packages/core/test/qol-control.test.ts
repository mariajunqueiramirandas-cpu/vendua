import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { render, type EventRow, type RenderCtx } from '../src/modules/discord/render.ts';
import { recordStaffEvent } from '../src/modules/staff-events.ts';
import { migrate } from '../src/platform/db.ts';

// CRM quality of life: the palette's store search, Discord cards that open the store, archive
// restore, task edits, the new pipeline filters, saved views, bulk lead edits and the store
// timeline. The API runs as vendua_app, so RLS applies as in production.

const rctx: RenderCtx = {
  crm: (p) => `https://crm.test/control/#${p}`,
  excerpts: true,
  storeUrl: 'https://loja.test',
  store: null,
  routedHere: [],
  now: new Date(),
};
const T = 'abcdef12-2222-4333-8444-5555555555aa';
const links = (ev: EventRow) =>
  (render(ev, [ev], rctx).card.components ?? []).flatMap((r) =>
    r.components.map((b) => ('url' in b ? b.url : null)),
  );

describe('discord: cards about a store open its CRM page', () => {
  const ev = (kind: string, data: unknown, tenant: string | null): EventRow =>
    ({
      id: 1,
      kind,
      tenant_id: tenant,
      severity: 'warning',
      anchor: null,
      data,
      created_at: new Date(),
    }) as EventRow;

  test('Duá fora do normal gets a button to /lojas/:id', () => {
    const monitor = ev(
      'vendedor.monitor',
      { storeName: 'Pão', metric: 'blocks', today: 30, baseline: 5, volume: 90 },
      T,
    );
    expect(links(monitor)).toContain(`https://crm.test/control/#/lojas/${T}`);
  });

  test('a store card keeps its own buttons and swaps the generic list link', () => {
    const help = ev(
      'merchant.help',
      {
        storeName: 'Pão',
        slug: 'pao',
        who: 'Bia',
        topic: 'geral',
        message: 'socorro',
        contact: null,
      },
      T,
    );
    const urls = links(help);
    expect(urls).toContain('https://loja.test');
    expect(urls).toContain(`https://crm.test/control/#/lojas/${T}`);
    expect(urls).not.toContain('https://crm.test/control/#/lojas');
  });

  test('an event without a store links nowhere new', () => {
    const lead = ev(
      'lead.created',
      { leadId: T, leadName: 'Ana', business: null, channel: 'site', excerpt: null },
      null,
    );
    expect(links(lead).some((u) => u?.includes('/lojas/'))).toBe(false);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('control quality of life (db)', () => {
  const OWNER_URL = process.env.TEST_DATABASE_URL!;
  const sql = postgres(OWNER_URL, { onnotice: () => {} });
  const appSql = postgres(
    process.env.TEST_APP_DATABASE_URL ??
      OWNER_URL.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@'),
    { onnotice: () => {} },
  );
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const tenants: string[] = [];
  const leads: string[] = [];
  let idem = 0;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    key: string = `qol-${nonce}-${++idem}`,
  ) => {
    const res = await app.request(`http://core.localhost${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        'x-vendua-control': 'ctl',
        ...(method === 'GET' ? {} : { 'idempotency-key': key }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: res.status,
      replayed: res.headers.get('x-idempotent-replay') === 'true',
      body: (await res.json()) as any,
    };
  };

  const store = async (name: string) => {
    const slug = `qol-${nonce}-${name}`;
    const phone = `219${String(Date.now() + tenants.length * 17).slice(-8)}`;
    const id = (
      await sql<{ id: string }[]>`
        select provision_store(${slug}, ${`Loja ${name} ${nonce}`}, 'bandeira',
                               ${`${slug}.vendua.test`}, 'Bia Dona', ${phone},
                               'bia@example.com') as id
      `
    )[0]!.id;
    tenants.push(id);
    return { id, slug, phone };
  };

  const lead = async (fields: Record<string, unknown> = {}) => {
    const r = await call('POST', '/control/v1/leads', {
      name: `QoL ${nonce} ${leads.length}`,
      agentMode: 'off',
      automation: false,
      ...fields,
    });
    expect(r.status).toBe(201);
    leads.push(r.body.lead.id);
    return r.body.lead.id as string;
  };

  const listIds = async (qs: string) => {
    const r = await call('GET', `/control/v1/leads?q=${encodeURIComponent(nonce)}&${qs}`);
    expect(r.status).toBe(200);
    return (r.body.leads as { id: string }[]).map((l) => l.id);
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  afterAll(async () => {
    if (leads.length) {
      await sql`delete from staff_events where data ->> 'leadId' in ${sql(leads)}`;
      await sql`delete from leads where id in ${sql(leads)}`;
    }
    if (tenants.length) await sql`delete from tenants where id in ${sql(tenants)}`;
    await sql`delete from control_saved_views where member like ${`qol-${nonce}%`}`;
    await appSql.end();
    await sql.end();
  });

  test('palette: stores by name, slug or domain; short or long queries are bounded', async () => {
    const a = await store('padaria');
    const b = await store('acai');
    await sql`
      insert into domains (tenant_id, host, is_primary)
      values (${b.id}, ${`acai-${nonce}.com.br`}, false)
    `;
    const byName = await call('GET', `/control/v1/customers/search?q=padaria ${nonce}`);
    expect(byName.status).toBe(200);
    expect(byName.body.stores.map((s: { id: string }) => s.id)).toEqual([a.id]);
    expect(byName.body.stores[0]).toMatchObject({ slug: a.slug, status: 'active' });

    const bySlug = await call('GET', `/control/v1/customers/search?q=${b.slug}`);
    expect(bySlug.body.stores[0].id).toBe(b.id);
    const byHost = await call('GET', `/control/v1/customers/search?q=acai-${nonce}.com`);
    expect(byHost.body.stores.map((s: { id: string }) => s.id)).toEqual([b.id]);

    const both = await call('GET', `/control/v1/customers/search?q=qol-${nonce}&limit=1`);
    expect(both.body.stores).toHaveLength(1);
    expect((await call('GET', '/control/v1/customers/search?q=a')).body.stores).toEqual([]);
    // LIKE wildcards are literal
    expect((await call('GET', '/control/v1/customers/search?q=%25%25')).body.stores).toEqual([]);
    expect((await call('GET', `/control/v1/customers/search?q=${'x'.repeat(101)}`)).status).toBe(
      422,
    );
  });

  test('store detail carries the owner contact', async () => {
    const s = await store('dono');
    const r = await call('GET', `/control/v1/customers/${s.id}`);
    expect(r.status).toBe(200);
    expect(r.body.owner).toEqual({ name: 'Bia Dona', phone: s.phone, email: 'bia@example.com' });
  });

  test('archived leads can be restored', async () => {
    const id = await lead();
    const off = await call('PATCH', `/control/v1/leads/${id}`, { archived: true });
    expect(off.body.lead.archivedAt).toBeTruthy();
    expect(await listIds('')).not.toContain(id);
    expect(await listIds('archived=only')).toContain(id);
    const back = await call('PATCH', `/control/v1/leads/${id}`, { archived: false });
    expect(back.status).toBe(200);
    expect(back.body.lead.archivedAt).toBeNull();
    expect(await listIds('')).toContain(id);
    expect((await call('PATCH', `/control/v1/leads/${id}`, { archived: 'no' })).status).toBe(422);
  });

  test('tasks: due on creation, edit title and due, snooze, delete', async () => {
    const id = await lead();
    const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const made = await call('POST', `/control/v1/leads/${id}/tasks`, {
      title: 'ligar',
      dueAt: due,
    });
    expect(made.status).toBe(201);
    expect(made.body.task.dueAt).toBe(due);
    const task = made.body.task.id as string;
    expect(
      (await call('POST', `/control/v1/leads/${id}/tasks`, { title: 'x', dueAt: 'amanhã' })).status,
    ).toBe(422);

    const renamed = await call('PATCH', `/control/v1/tasks/${task}`, { title: '  ligar às 10  ' });
    expect(renamed.body.task).toMatchObject({ title: 'ligar às 10', dueAt: due, doneAt: null });

    // a future due date moves from itself; an overdue one from now
    const week = await call('PATCH', `/control/v1/tasks/${task}`, { snooze: '1w' });
    expect(new Date(week.body.task.dueAt).getTime()).toBe(new Date(due).getTime() + 7 * 86_400_000);
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await call('PATCH', `/control/v1/tasks/${task}`, { dueAt: past });
    const day = await call('PATCH', `/control/v1/tasks/${task}`, { snooze: '1d' });
    const next = new Date(day.body.task.dueAt).getTime();
    expect(next).toBeGreaterThan(Date.now() + 86_400_000 - 60_000);
    expect(next).toBeLessThan(Date.now() + 86_400_000 + 60_000);

    const cleared = await call('PATCH', `/control/v1/tasks/${task}`, { dueAt: null });
    expect(cleared.body.task.dueAt).toBeNull();
    // the old toggle still works: an empty body completes, done:false reopens
    expect((await call('PATCH', `/control/v1/tasks/${task}`, {})).body.task.doneAt).toBeTruthy();
    expect(
      (await call('PATCH', `/control/v1/tasks/${task}`, { done: false })).body.task.doneAt,
    ).toBeNull();

    for (const bad of [{ snooze: '1y' }, { title: '' }, { done: 'yes' }, { dueAt: 5 }]) {
      expect((await call('PATCH', `/control/v1/tasks/${task}`, bad)).status).toBe(422);
    }
    expect((await call('PATCH', '/control/v1/tasks/nope', { title: 'x' })).status).toBe(400);
    expect((await call('PATCH', `/control/v1/tasks/${crypto.randomUUID()}`, {})).status).toBe(404);

    const key = `qol-${nonce}-del`;
    const del = await call('DELETE', `/control/v1/tasks/${task}`, undefined, key);
    expect(del.body).toEqual({ ok: true, leadId: id });
    expect((await call('DELETE', `/control/v1/tasks/${task}`, undefined, key)).replayed).toBe(true);
    expect((await call('DELETE', `/control/v1/tasks/${task}`)).status).toBe(404);
  });

  test("an agent handoff task keeps its title and isn't deleted while open", async () => {
    const id = await lead();
    const task = (
      await sql<{ id: string }[]>`
        insert into lead_tasks (lead_id, title, created_by)
        values (${id}, '[humano] cliente quer falar com alguém', 'agent') returning id
      `
    )[0]!.id;
    await recordStaffEvent(sql, 'handoff.requested', {
      taskId: task,
      leadId: id,
      leadName: 'x',
      business: null,
      channel: null,
      threadId: null,
      reason: 'r',
    });
    expect((await call('PATCH', `/control/v1/tasks/${task}`, { title: 'outra' })).status).toBe(409);
    expect((await call('DELETE', `/control/v1/tasks/${task}`)).status).toBe(409);
    const snoozed = await call('PATCH', `/control/v1/tasks/${task}`, { snooze: '1d' });
    expect(snoozed.status).toBe(200);
    expect((await call('PATCH', `/control/v1/tasks/${task}`, { done: true })).status).toBe(200);
    const resolved = await sql`
      select 1 from staff_events where kind = 'handoff.resolved' and data ->> 'taskId' = ${task}
    `;
    expect(resolved).toHaveLength(1);
  });

  test('pipeline filters: segment, source, city, has draft, overdue task', async () => {
    const a = await lead({ segment: 'Padaria', source: 'Instagram', city: 'Fortaleza - CE' });
    const b = await lead({ segment: 'açaí', source: 'site', city: 'Recife' });
    const thread = (
      await sql<{ id: string }[]>`
        insert into lead_threads (lead_id, channel) values (${b}, 'whatsapp') returning id
      `
    )[0]!.id;
    await sql`
      insert into lead_messages (thread_id, direction, author, body, status)
      values (${thread}, 'out', 'agent', 'oi', 'draft')
    `;
    await sql`
      insert into lead_tasks (lead_id, title, due_at, created_by)
      values (${a}, 'atrasada', now() - interval '1 hour', 'staff'),
             (${b}, 'futura', now() + interval '1 day', 'staff')
    `;
    expect(await listIds('segment=padaria')).toEqual([a]);
    expect(await listIds('source=SITE')).toEqual([b]);
    expect(await listIds('city=fortal')).toEqual([a]);
    expect(await listIds('city=%25')).toEqual([]);
    expect(await listIds('draft=1')).toEqual([b]);
    expect(await listIds('overdue=1')).toEqual([a]);
    expect(await listIds('overdue=1&segment=açaí')).toEqual([]);
    const row = (await call('GET', `/control/v1/leads/${a}`)).body.lead;
    expect(row).toMatchObject({ openTasks: 1, overdueTasks: 1 });
    expect((await call('GET', `/control/v1/leads?city=${'x'.repeat(121)}`)).status).toBe(422);
  });

  test('saved views: CRUD per staff member', async () => {
    const ana = `qol-${nonce}-ana`;
    const bia = `qol-${nonce}-bia`;
    const made = await call('POST', '/control/v1/views', {
      member: ana,
      name: 'Padarias atrasadas',
      params: { segment: 'padaria', overdue: '1', state: '' },
    });
    expect(made.status).toBe(201);
    expect(made.body.view).toMatchObject({
      member: ana,
      name: 'Padarias atrasadas',
      params: { segment: 'padaria', overdue: '1' },
    });
    await call('POST', '/control/v1/views', {
      member: bia,
      name: 'Padarias atrasadas',
      params: {},
    });
    const dup = await call('POST', '/control/v1/views', {
      member: ana,
      name: 'padarias ATRASADAS',
      params: {},
    });
    expect(dup.status).toBe(409);

    const mine = await call('GET', `/control/v1/views?member=${encodeURIComponent(ana)}`);
    expect(mine.body.views.map((v: { member: string }) => v.member)).toEqual([ana]);
    expect((await call('GET', '/control/v1/views')).status).toBe(422);

    const id = made.body.view.id as string;
    const other = await call('POST', '/control/v1/views', {
      member: ana,
      name: 'Recife',
      params: {},
    });
    const renamed = await call('PATCH', `/control/v1/views/${id}`, {
      name: 'Atrasadas',
      params: { overdue: '1' },
    });
    expect(renamed.body.view).toMatchObject({ name: 'Atrasadas', params: { overdue: '1' } });
    expect((await call('PATCH', `/control/v1/views/${id}`, { name: 'recife' })).status).toBe(409);
    expect(
      (await call('PATCH', `/control/v1/views/${id}`, { params: { orderBy: 'x' } })).status,
    ).toBe(422);
    expect(
      (await call('POST', '/control/v1/views', { member: ana, name: 'x', params: [] })).status,
    ).toBe(422);
    expect((await call('PATCH', '/control/v1/views/zzz', { name: 'x' })).status).toBe(400);

    expect((await call('DELETE', `/control/v1/views/${other.body.view.id}`)).status).toBe(200);
    expect((await call('DELETE', `/control/v1/views/${other.body.view.id}`)).status).toBe(404);
    const left = await call('GET', `/control/v1/views?member=${encodeURIComponent(ana)}`);
    expect(left.body.views.map((v: { name: string }) => v.name)).toEqual(['Atrasadas']);
  });

  test('bulk: the same side effects as one PATCH per lead, bounded and idempotent', async () => {
    const single = await lead({ tags: ['frio'] });
    const [x, y] = [await lead({ tags: ['frio'] }), await lead()];
    await call('PATCH', `/control/v1/leads/${single}`, { state: 'invited' });

    const key = `qol-${nonce}-bulk`;
    const res = await call(
      'POST',
      '/control/v1/leads/bulk',
      { ids: [x, y], state: 'invited' },
      key,
    );
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.leads.map((l: { state: string }) => l.state)).toEqual(['invited', 'invited']);

    const effects = async (id: string) => ({
      history: (
        await sql`select from_state, to_state, actor from lead_state_history where lead_id = ${id}
                  order by at`
      ).map((r) => `${r.from_state}>${r.to_state}:${r.actor}`),
      activities: (
        await sql`select kind, body from lead_activities where lead_id = ${id} order by at`
      ).map((r) => `${r.kind}:${r.body}`),
      milestones: (
        await sql`select dedupe_key from staff_events
                  where kind = 'lead.milestone' and data ->> 'leadId' = ${id}`
      ).length,
    });
    const want = await effects(single);
    expect(want.milestones).toBe(1);
    expect(await effects(x)).toEqual(want);
    expect(await effects(y)).toEqual(want);

    // a retry replays the stored answer and writes nothing again
    const again = await call('POST', '/control/v1/leads/bulk', { ids: [x, y], state: 'live' }, key);
    expect(again.replayed).toBe(true);
    expect(again.body).toEqual(res.body);
    expect(await effects(x)).toEqual(want);

    const tagged = await call('POST', '/control/v1/leads/bulk', {
      ids: [x, y],
      addTags: ['quente', 'Quente'],
      removeTags: ['FRIO'],
    });
    expect(tagged.body.leads.map((l: { tags: string[] }) => l.tags)).toEqual([
      ['quente'],
      ['quente'],
    ]);

    const archived = await call('POST', '/control/v1/leads/bulk', { ids: [x, y], archived: true });
    expect(archived.body.leads.every((l: { archivedAt: string | null }) => l.archivedAt)).toBe(
      true,
    );
    const restored = await call('POST', '/control/v1/leads/bulk', {
      ids: [x, y],
      archived: false,
    });
    expect(restored.body.leads.every((l: { archivedAt: string | null }) => !l.archivedAt)).toBe(
      true,
    );

    // one bad id fails the whole batch and changes nothing
    const ghost = crypto.randomUUID();
    const missing = await call('POST', '/control/v1/leads/bulk', {
      ids: [x, ghost],
      state: 'live',
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error.details.ids).toEqual([ghost]);
    expect((await call('GET', `/control/v1/leads/${x}`)).body.lead.state).toBe('invited');

    const bad: unknown[] = [
      { ids: [], state: 'live' },
      { ids: Array.from({ length: 201 }, () => crypto.randomUUID()), state: 'live' },
      { ids: ['nope'], state: 'live' },
      { ids: [x] },
      { ids: [x], state: 'won' },
      { ids: [x], name: 'renomear todos' },
      { ids: [x], addTags: 'quente' },
    ];
    for (const body of bad) {
      expect((await call('POST', '/control/v1/leads/bulk', body)).status).toBe(422);
    }
    const noKey = await app.request('http://core.localhost/control/v1/leads/bulk', {
      method: 'POST',
      headers: { host: 'core.localhost', 'x-vendua-control': 'ctl' },
      body: JSON.stringify({ ids: [x], state: 'live' }),
    });
    expect(noKey.status).toBe(400);
  });

  test("store timeline: one store's events, newest first, paged and filtered", async () => {
    const s = await store('linha');
    const other = await store('outra');
    const opts = { tenantId: s.id };
    for (let n = 1; n <= 3; n++) {
      await recordStaffEvent(
        sql,
        'order.placed',
        {
          orderId: crypto.randomUUID(),
          number: n,
          storeName: 'Linha',
          totalCents: 1000 * n,
          method: 'pix',
          fulfillment: null,
          items: 1,
          scheduledFor: null,
        },
        opts,
      );
    }
    await recordStaffEvent(sql, 'store.live', { storeName: 'Linha', host: null }, opts);
    await recordStaffEvent(
      sql,
      'store.live',
      { storeName: 'Outra', host: null },
      {
        tenantId: other.id,
      },
    );

    const first = await call('GET', `/control/v1/customers/${s.id}/events?limit=2`);
    expect(first.status).toBe(200);
    expect(first.body.events.map((e: { kind: string }) => e.kind)).toEqual([
      'store.live',
      'order.placed',
    ]);
    expect(first.body.events[1]).toMatchObject({
      label: expect.any(String),
      category: 'vendas',
      data: { number: 3, totalCents: 3000 },
    });
    const rest = await call(
      'GET',
      `/control/v1/customers/${s.id}/events?limit=2&before=${first.body.nextBefore}`,
    );
    expect(rest.body.events.map((e: { data: { number: number } }) => e.data.number)).toEqual([
      2, 1,
    ]);
    expect(rest.body.nextBefore).toBeNull();

    const frota = await call('GET', `/control/v1/customers/${s.id}/events?category=frota`);
    expect(frota.body.events.map((e: { kind: string }) => e.kind)).toEqual(['store.live']);
    expect(
      (await call('GET', `/control/v1/customers/${s.id}/events?limit=1000`)).body.events,
    ).toHaveLength(4);

    expect((await call('GET', `/control/v1/customers/${crypto.randomUUID()}/events`)).status).toBe(
      404,
    );
    expect((await call('GET', '/control/v1/customers/nope/events')).status).toBe(400);
    expect((await call('GET', `/control/v1/customers/${s.id}/events?before=-1`)).status).toBe(400);
    expect((await call('GET', `/control/v1/customers/${s.id}/events?category=x`)).status).toBe(400);
  });
});
