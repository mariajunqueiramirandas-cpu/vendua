import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { createSession } from '../src/admin/auth.ts';
import { migrate } from '../src/platform/db.ts';

// The Vendedor's admin API (ADR 0031): roles, bounded writes, stable 4xx on bad ids, and each
// action's effect on the floor and the mailbox.

describe.skipIf(!process.env.TEST_DATABASE_URL)('vendedor admin API (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
  });
  const nonce = crypto.randomUUID().slice(0, 6);
  let idem = 0;
  let tenantId = '';
  const as = (cookie: string) => async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`http://core.localhost/admin/v1${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        cookie: `vendua_admin=${cookie}`,
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  let owner: ReturnType<typeof as>;
  let manager: ReturnType<typeof as>;
  let attendant: ReturnType<typeof as>;
  let threadId = '';
  const phone = `21${String(Date.now()).slice(-9)}`;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${`vda-${nonce}`}, 'Forno da Vila') returning id`;
    tenantId = t!.id;
    await sql`insert into store_settings ${sql({
      tenant_id: tenantId,
      hours: sql.json({
        timezone: 'America/Sao_Paulo',
        windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }],
      }),
      prep_time_minutes: 30,
      min_order_cents: 0,
      currency: 'BRL',
      vocabulary: sql.json({}),
    })}`;
    const session = async (role: 'owner' | 'manager' | 'attendant', n: number) => {
      const [u] = await sql<{ id: string }[]>`
        insert into merchant_users (tenant_id, name, phone, role)
        values (${tenantId}, ${role}, ${`2199${n}${String(Date.now()).slice(-6)}`}, ${role}) returning id`;
      return as(
        await createSession(
          appSql,
          { tenant_id: tenantId, user_id: u!.id, slug: `vda-${nonce}`, name: role, role },
          'test',
        ),
      );
    };
    owner = await session('owner', 1);
    manager = await session('manager', 2);
    attendant = await session('attendant', 3);
    const [th] = await sql<{ id: string }[]>`
      insert into shopper_threads (tenant_id, channel, address, phone, profile_name, class)
      values (${tenantId}, 'whatsapp', ${`55${phone}@s.whatsapp.net`}, ${phone}, 'Júlia Souza', 'shopper') returning id`;
    threadId = th!.id;
    await sql`insert into shopper_messages (tenant_id, thread_id, author, kind, body) values
      (${tenantId}, ${threadId}, 'shopper', 'text', 'tem pizza de calabresa?')`;
  });

  afterAll(async () => {
    await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
    if (appSql !== sql) await appSql.end();
  });

  test('home and conversations for everyone who works the inbox; bad ids are 4xx', async () => {
    const home = await attendant('GET', '/vendedor');
    expect(home.status).toBe(200);
    expect(home.body.presence).toBe('off');
    const list = await attendant('GET', '/vendedor/threads?filter=all');
    expect(list.body.threads.map((t: { id: string }) => t.id)).toContain(threadId);
    expect(list.body.threads[0].phone).toMatch(/••••/);
    expect((await attendant('GET', `/vendedor/threads/${threadId}`)).body.messages).toHaveLength(1);
    expect((await attendant('GET', '/vendedor/threads/nope')).status).toBe(400);
    expect((await attendant('GET', `/vendedor/threads/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await attendant('GET', '/vendedor/threads?filter=bogus')).status).toBe(422);
    const [odd] = await sql<{ id: string }[]>`
      insert into shopper_messages (tenant_id, thread_id, author, kind, body, status, meta)
      values (${tenantId}, ${threadId}, 'agent', 'text', 'oi', 'sent', ${sql.json({ turnId: 'not-a-uuid' })})
      returning id`;
    const why = await attendant('GET', `/vendedor/threads/${threadId}/why/${odd!.id}`);
    expect(why.status).toBe(200);
    await sql`delete from shopper_messages where id = ${odd!.id}`;
  });

  test('settings: managers configure, the owner turns it on and sets money', async () => {
    expect((await attendant('GET', '/vendedor/settings')).status).toBe(403);
    expect((await manager('PATCH', '/vendedor/settings', { enabled: true })).status).toBe(403);
    expect((await manager('PATCH', '/vendedor/settings', { disclose: false })).status).toBe(403);
    // the seller is always Duá (ADR 0032): its name is not a setting
    expect((await manager('PATCH', '/vendedor/settings', { name: 'Bia' })).status).toBe(422);
    const ok = await manager('PATCH', '/vendedor/settings', {
      coverage: 'always',
      slowAfterMin: 5,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ name: 'Duá', coverage: 'always', slowAfterMin: 5 });
    expect(ok.body.intro).toBe('o Duá, assistente virtual da Forno da Vila');
    expect((await manager('PATCH', '/vendedor/settings', { slowAfterMin: 3 })).status).toBe(422);
    expect((await manager('PATCH', '/vendedor/settings', { whatever: 1 })).status).toBe(422);
    const bad = await owner('PATCH', '/vendedor/settings', {
      incentives: {
        couponIds: [crypto.randomUUID()],
        reasons: ['recovery'],
        monthlyBudgetCents: 5000,
      },
    });
    expect(bad.status).toBe(422);
    // he answers on the store's WhatsApp: no linked number, no switching on (Ensaio included)
    for (const body of [{ enabled: true }, { enabled: true, coverage: 'rehearsal' }]) {
      const early = await owner('PATCH', '/vendedor/settings', body);
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe('WHATSAPP_REQUIRED');
    }
    await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${tenantId}, true, 'pairing')`;
    expect((await owner('PATCH', '/vendedor/settings', { enabled: true })).status).toBe(409);
    expect(
      await sql`select 1 from store_agent where tenant_id = ${tenantId} and enabled`,
    ).toHaveLength(0);
    await sql`update store_whatsapp set state = 'open' where tenant_id = ${tenantId}`;
    const on = await owner('PATCH', '/vendedor/settings', { enabled: true });
    expect(on.body.enabled).toBe(true);
    const [row] = await sql<
      { enabled_at: Date | null }[]
    >`select enabled_at from store_agent where tenant_id = ${tenantId}`;
    expect(row!.enabled_at).not.toBeNull();
    // the number drops: he stays on, settings still save, and switching off is never gated
    await sql`update store_whatsapp set state = 'error' where tenant_id = ${tenantId}`;
    const still = await owner('PATCH', '/vendedor/settings', { enabled: true, tone: 'formal' });
    expect(still.status).toBe(200);
    expect(still.body.enabled).toBe(true);
    const off = await owner('PATCH', '/vendedor/settings', { enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
    expect((await owner('PATCH', '/vendedor/settings', { enabled: true })).status).toBe(409);
    await sql`update store_whatsapp set state = 'open' where tenant_id = ${tenantId}`;
    expect((await owner('PATCH', '/vendedor/settings', { enabled: true })).body.enabled).toBe(true);
  });

  test('take, reply, release and mute move the floor and wake the actor', async () => {
    const take = await attendant('POST', `/vendedor/threads/${threadId}/take`, {});
    expect(take.status).toBe(200);
    expect(take.body.thread.owner).toBe('human');
    const reply = await attendant('POST', `/vendedor/threads/${threadId}/reply`, {
      text: 'Temos sim!',
    });
    expect(reply.status).toBe(201);
    const [out] = await sql<{ kind: string; jid: string; body: string }[]>`
      select kind, jid, body from store_wa_messages where tenant_id = ${tenantId}`;
    expect(out).toMatchObject({
      kind: 'chat',
      jid: `55${phone}@s.whatsapp.net`,
      body: 'Temos sim!',
    });
    const kinds = async () =>
      (
        await sql<
          { kind: string }[]
        >`select kind from agent_mailbox where tenant_id = ${tenantId} order by created_at`
      ).map((r) => r.kind);
    // one tx writes both, so created_at ties: compare as a set
    expect((await kinds()).sort()).toEqual(['merchant.message', 'timer.handback']);
    const back = await attendant('POST', `/vendedor/threads/${threadId}/release`, {});
    expect(back.body.thread.owner).toBe('agent');
    expect((await kinds()).filter((k) => k === 'timer.handback')).toHaveLength(2);
    expect(
      (await attendant('POST', `/vendedor/threads/${threadId}/reply`, { text: '' })).status,
    ).toBe(422);
    const mute = await attendant('POST', `/vendedor/threads/${threadId}/mute`, {});
    expect(mute.body.thread).toMatchObject({ owner: 'muted', class: 'other' });
    expect((await attendant('POST', `/vendedor/threads/${threadId}/take`, {})).status).toBe(409);
    expect(
      (await attendant('POST', `/vendedor/threads/${threadId}/unmute`, {})).body.thread.owner,
    ).toBe('open');
  });

  test('knowledge: rules say whether they are guaranteed; answering a question teaches it', async () => {
    expect((await attendant('GET', '/vendedor/knowledge')).status).toBe(403);
    const preview = await manager(
      'GET',
      `/vendedor/knowledge/preview?text=${encodeURIComponent('não aceite dinheiro acima de R$ 200')}`,
    );
    expect(preview.body).toMatchObject({ guaranteed: true });
    const rule = await manager('POST', '/vendedor/knowledge', {
      kind: 'rule',
      text: 'Não aceite dinheiro acima de R$ 200',
    });
    expect(rule.status).toBe(201);
    expect(rule.body.rules[0]).toMatchObject({ guaranteed: true });
    const guidance = await manager('POST', '/vendedor/knowledge', {
      kind: 'rule',
      text: 'Nunca ofereça borda doce em pizza salgada',
    });
    expect(guidance.body.rules.find((r: { guaranteed: boolean }) => !r.guaranteed)).toBeTruthy();
    const [q] = await sql<{ id: string }[]>`
      insert into store_knowledge (tenant_id, kind, status, source, question, asked_count, thread_id)
      values (${tenantId}, 'question', 'open', 'unanswered', 'Vocês têm opção vegana?', 4, ${threadId}) returning id`;
    const answered = await manager('PATCH', `/vendedor/knowledge/${q!.id}`, {
      answer: 'Temos a pizza de legumes, sem queijo.',
    });
    expect(answered.body.questions).toHaveLength(0);
    expect(answered.body.answers.map((a: { question: string }) => a.question)).toContain(
      'Vocês têm opção vegana?',
    );
    expect((await manager('DELETE', `/vendedor/knowledge/${crypto.randomUUID()}`)).status).toBe(
      404,
    );
  });

  test('the test chat, the onboarding and Cliente oculto', async () => {
    const chat = await manager('POST', '/vendedor/test-chat', { text: 'oi, quero pedir' });
    expect(chat.status).toBe(201);
    expect(chat.body.thread.test).toBe(true);
    const [m] = await sql<{ ingest: string }[]>`
      select m.ingest from shopper_messages m join shopper_threads t on t.id = m.thread_id
      where t.tenant_id = ${tenantId} and t.channel = 'test' and t.test_kind = 'owner'`;
    expect(m!.ingest).toBe('pending');
    expect((await manager('GET', '/vendedor/onboarding')).status).toBe(403);
    const ob = await owner('PATCH', '/vendedor/onboarding', { started: true, part: 'conhecer' });
    expect(ob.body.progress).toMatchObject({ started: true, part: 'conhecer' });
    expect((await owner('PATCH', '/vendedor/onboarding', { evil: 1 })).status).toBe(422);
    const run = await manager('POST', '/vendedor/cliente-oculto', {});
    expect(run.status).toBe(202);
    expect(run.body.latest.status).toBe('queued');
    expect(
      (await manager('GET', '/vendedor/resultados?period=30d')).body.assisted.windowHours,
    ).toBe(24);
    expect((await manager('GET', '/vendedor/resultados?period=forever')).status).toBe(422);
    expect((await manager('GET', '/vendedor/ensaio')).status).toBe(200);
  });

  test('"o que a Ana sabe" on the customer page: seen and forgotten by a manager', async () => {
    await sql`insert into agent_memory (tenant_id, scope, key, value, confidence, provenance, sensitive) values
      (${tenantId}, ${'shopper_thread:' + threadId}, 'preferencia.massa', ${sql.json('massa bem assada')}, 1, 'test', false)`;
    const facts = await manager('GET', `/customers/${phone}/vendedor`);
    expect(facts.body.facts).toMatchObject([
      { key: 'preferencia.massa', value: 'massa bem assada', sensitive: false },
    ]);
    expect((await attendant('GET', `/customers/${phone}/vendedor`)).status).toBe(403);
    expect(
      (await manager('DELETE', `/customers/${phone}/vendedor/facts/preferencia.massa`)).body.facts,
    ).toHaveLength(0);
    expect(
      (await manager('DELETE', `/customers/${phone}/vendedor/facts/preferencia.massa`)).status,
    ).toBe(404);
  });
});
