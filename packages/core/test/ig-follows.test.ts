import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { ingestInbound } from '../src/crm/inbound.ts';
import { dispatchMessage } from '../src/crm/send.ts';
import { applyIgEvent } from '../src/crm/channels/instagram.ts';
import {
  BLOCKED_PAUSE_H,
  followBeforeDm,
  followBudgetTx,
  followNext,
  queueIgFollowTx,
  startInstagramFollows,
} from '../src/crm/ig-follows.ts';
import { composeMessageTx } from '../src/modules/threads.ts';
import {
  DEFAULT_GUARDRAILS,
  getIntegration,
  upsertIntegration,
  validateSetting,
} from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx, updateLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

describe('guardrails — instagramFollowsPerDay', () => {
  test('default and bounds', () => {
    expect(DEFAULT_GUARDRAILS.instagramFollowsPerDay).toBe(30);
    expect(() => validateSetting('guardrails', { instagramFollowsPerDay: 0 })).not.toThrow();
    expect(() => validateSetting('guardrails', { instagramFollowsPerDay: 201 })).toThrow();
    expect(() => validateSetting('guardrails', { instagramFollowsPerDay: 2.5 })).toThrow();
  });
});

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('instagram follows (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const h = (s: string) => `f${nonce}${s}`;
  const SECRET = 'ig-follow-secret';
  const saved = {
    secret: process.env.IG_SIDECAR_SECRET,
    url: process.env.IG_SIDECAR_URL,
  };

  // a stand-in ig-sidecar: /v1/follow answers per target, /v1/send always delivers
  type Reply = { status: number; body: Record<string, unknown> };
  const replies = new Map<string, Reply>();
  const calls: { path: string; target: string }[] = [];
  let sent = 0;
  const sidecar = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (req.headers.get('authorization') !== `Bearer ${SECRET}`)
        return Response.json({ error: { code: 'unauthorized' } }, { status: 401 });
      const b = (await req.json()) as { fbid?: string; username?: string };
      const target = b.username || b.fbid || '';
      calls.push({ path, target });
      if (path === '/v1/send')
        return Response.json({ messageId: `m-${nonce}-${++sent}`, fbid: '' });
      const r = replies.get(target) ?? {
        status: 200,
        body: {
          fbid: b.fbid || '424242',
          igid: '5151',
          username: b.username,
          following: true,
          requested: false,
          already: false,
        },
      };
      return Response.json(r.body, { status: r.status });
    },
  });
  const sidecarError = (status: number, code: string): Reply => ({
    status,
    body: { error: { code, message: code } },
  });

  const newLead = (fields: Record<string, unknown>) =>
    controlTx(sql, async (tx) => (await insertLeadTx(tx, fields)).body.lead.id as string);
  const row = async (handle: string) =>
    (
      await sql<
        {
          status: string;
          attempts: number;
          error_code: string | null;
          followed_at: Date | null;
          fbid: string | null;
          lead_id: string | null;
          pause_min: number;
        }[]
      >`select status, attempts, error_code, followed_at, fbid, lead_id,
               extract(epoch from next_at - now())::int / 60 as pause_min
        from ig_follows where handle = ${handle}`
    )[0];
  const setCap = (n: number) =>
    sql`
      insert into control_settings (key, value)
      values ('guardrails', ${sql.json({ instagramFollowsPerDay: n } as never)})
      on conflict (key) do update set value = excluded.value`;
  const drain = async () => {
    while (await followNext(sql));
  };
  const ig = async () => (await getIntegration(sql, 'instagram'))!;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    process.env.IG_SIDECAR_SECRET = SECRET;
    process.env.IG_SIDECAR_URL = `http://127.0.0.1:${sidecar.port}`;
    await upsertIntegration(
      sql,
      { kind: 'instagram', driver: 'sidecar', enabled: true },
      `ig-follow-test:${crypto.randomUUID()}`,
    );
    await applyIgEvent(sql, { type: 'state', status: { state: 'open' } }, SECRET);
  });
  beforeEach(async () => {
    // the queue is global: other suites' leads (and older runs) queue follows too
    await sql`delete from ig_follows`;
    await sql`delete from control_settings where key = 'guardrails'`;
    replies.clear();
    calls.length = 0;
  });
  afterAll(async () => {
    await sql`delete from ig_follows`;
    await sql`delete from control_settings where key = 'guardrails'`;
    await sql`update control_integrations set enabled = false where kind = 'instagram'`;
    await sql`update agent_runs set status = 'canceled' where status = 'queued'`;
    await applyIgEvent(sql, { type: 'state', status: { state: 'off' } }, SECRET);
    void sidecar.stop(true);
    for (const [k, v] of [
      ['IG_SIDECAR_SECRET', saved.secret],
      ['IG_SIDECAR_URL', saved.url],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('every way a lead gets a handle queues one follow of it', async () => {
    const found = await newLead({ name: `Achada ${nonce}`, instagram: `@${h('a')}` });
    expect(await row(h('a'))).toMatchObject({ status: 'pending', lead_id: found });

    // the same account written as a profile URL is the same follow
    await newLead({ name: `Mesma ${nonce}`, instagram: `https://instagram.com/${h('a')}/` });
    expect((await sql`select 1 from ig_follows where handle = ${h('a')}`).length).toBe(1);

    // a handle added later (staff or the agent) queues it then
    const bare = await newLead({ name: `Sem IG ${nonce}` });
    expect(await sql`select 1 from ig_follows where lead_id = ${bare}`).toHaveLength(0);
    await controlTx(sql, (tx) => updateLeadTx(tx, bare, { instagram: `@${h('b')}` }, 'agent'));
    expect(await row(h('b'))).toMatchObject({ status: 'pending', lead_id: bare });

    // someone who DMs the account first
    const inbound = await ingestInbound(sql, {
      channel: 'instagram',
      from: `@${h('c')}`,
      body: 'oi',
      providerMessageId: `mid-${nonce}-c`,
      externalThreadId: `8${Date.now()}`,
    });
    if ('ignored' in inbound) throw new Error('unexpected ignore');
    expect(await row(h('c'))).toMatchObject({ status: 'pending', lead_id: inbound.leadId });

    // sims never touch the real account
    await newLead({ name: `Sim ${nonce}`, source: 'sim', instagram: `@${h('d')}` });
    expect(await row(h('d'))).toBeUndefined();
  });

  test('the loop follows, logs it on the lead, and an account already followed costs nothing', async () => {
    const lead = await newLead({ name: `Nova ${nonce}`, instagram: `@${h('e')}` });
    await newLead({ name: `Já segue ${nonce}`, instagram: `@${h('f')}` });
    replies.set(h('f'), {
      status: 200,
      body: {
        fbid: '61',
        igid: '62',
        username: h('f'),
        following: true,
        requested: false,
        already: true,
      },
    });
    const before = await controlTx(sql, followBudgetTx);
    await drain();
    expect(
      calls
        .filter((c) => c.path === '/v1/follow')
        .map((c) => c.target)
        .sort(),
    ).toEqual([h('e'), h('f')].sort());
    const followed = (await row(h('e')))!;
    expect(followed.status).toBe('following');
    expect(followed.followed_at).not.toBeNull();
    expect(followed.fbid).toBe('424242');
    expect(await row(h('f'))).toMatchObject({ status: 'following', followed_at: null, fbid: '61' });
    expect(await controlTx(sql, followBudgetTx)).toBe(before - 1);
    const activity = await sql<{ body: string }[]>`
      select body from lead_activities where lead_id = ${lead} and kind = 'system'`;
    expect(activity.map((a) => a.body)).toContain(`Seguindo @${h('e')} no Instagram`);

    // nothing left: a second pass calls nobody
    calls.length = 0;
    expect(await followNext(sql)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test('a gone account fails for good, a flaky one backs off, Action Blocked pauses all', async () => {
    await newLead({ name: `Sumiu ${nonce}`, instagram: `@${h('g')}` });
    await newLead({ name: `Instável ${nonce}`, instagram: `@${h('i')}` });
    replies.set(h('g'), sidecarError(404, 'follow_target_not_found'));
    replies.set(h('i'), sidecarError(502, 'upstream_error'));
    await drain();
    expect(await row(h('g'))).toMatchObject({
      status: 'failed',
      attempts: 1,
      error_code: 'follow_target_not_found',
    });
    const flaky = (await row(h('i')))!;
    expect(flaky).toMatchObject({ status: 'pending', attempts: 1, error_code: 'upstream_error' });
    expect(flaky.pause_min).toBeGreaterThanOrEqual(9);

    await newLead({ name: `Bloqueio ${nonce}`, instagram: `@${h('j')}` });
    replies.set(h('j'), sidecarError(429, 'action_blocked'));
    await drain();
    const blocked = (await row(h('j')))!;
    expect(blocked).toMatchObject({ status: 'pending', error_code: 'action_blocked' });
    expect(blocked.pause_min).toBeGreaterThanOrEqual(BLOCKED_PAUSE_H * 60 - 1);
    // every follow waits now, inline ones too
    expect(await controlTx(sql, followBudgetTx)).toBe(0);
    await newLead({ name: `Depois ${nonce}`, instagram: `@${h('k')}` });
    calls.length = 0;
    expect(await followNext(sql)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test('a new queue request recovers an old false 404 while a confirmed missing target stays failed', async () => {
    const legacyHandle = h('legacy');
    const missingHandle = h('missing');
    const legacy = await newLead({ name: `Legado ${nonce}`, instagram: `@${legacyHandle}` });
    const missing = await newLead({ name: `Sumiu ${nonce}`, instagram: `@${missingHandle}` });
    replies.set(legacyHandle, sidecarError(404, 'user_not_found'));
    replies.set(missingHandle, sidecarError(404, 'follow_target_not_found'));
    await drain();
    expect(await row(legacyHandle)).toMatchObject({
      status: 'failed',
      error_code: 'user_not_found',
    });

    await controlTx(sql, async (tx) => {
      await queueIgFollowTx(tx, legacy, legacyHandle);
      await queueIgFollowTx(tx, missing, missingHandle);
    });
    expect(await row(legacyHandle)).toMatchObject({
      status: 'pending',
      attempts: 0,
      error_code: null,
    });
    expect(await row(missingHandle)).toMatchObject({
      status: 'failed',
      error_code: 'follow_target_not_found',
    });

    replies.delete(legacyHandle);
    calls.length = 0;
    await drain();
    expect(calls).toEqual([{ path: '/v1/follow', target: legacyHandle }]);
    expect(await row(legacyHandle)).toMatchObject({ status: 'following' });
  });

  test('archived or unsubscribed since queued: held, not followed', async () => {
    const lead = await newLead({ name: `Saiu ${nonce}`, instagram: `@${h('l')}` });
    await sql`update leads set unsubscribed_at = now() where id = ${lead}`;
    expect(await followNext(sql)).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await row(h('l'))).toMatchObject({ status: 'pending' });
  });

  test('the cap holds: 0 means no follows at all', async () => {
    await setCap(0);
    await newLead({ name: `Cap ${nonce}`, instagram: `@${h('m')}` });
    expect(await followNext(sql)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  const queueDm = (leadId: string, body = 'Oi! Aqui é a Venduá.') =>
    controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId,
        channel: 'instagram',
        body,
        author: 'staff',
        status: 'queued',
      }),
    ).then((c) => c.body.message.id as string);
  const status = async (messageId: string) =>
    (await sql<{ status: string }[]>`select status from lead_messages where id = ${messageId}`)[0]!
      .status;

  test('a DM follows first, once — and still goes out when the follow fails', async () => {
    const lead = await newLead({ name: `DM ${nonce}`, instagram: `@${h('n')}` });
    expect(await dispatchMessage(sql, await queueDm(lead))).toEqual({ ok: true });
    expect(calls.map((c) => c.path)).toEqual(['/v1/follow', '/v1/send']);
    expect(await row(h('n'))).toMatchObject({ status: 'following' });

    calls.length = 0;
    expect(await dispatchMessage(sql, await queueDm(lead, 'e aí?'))).toEqual({ ok: true });
    expect(calls.map((c) => c.path)).toEqual(['/v1/send']);

    const flaky = await newLead({ name: `DM falha ${nonce}`, instagram: `@${h('o')}` });
    replies.set(h('o'), sidecarError(502, 'upstream_error'));
    calls.length = 0;
    const msg = await queueDm(flaky);
    expect(await dispatchMessage(sql, msg)).toEqual({ ok: true });
    expect(calls.map((c) => c.path)).toEqual(['/v1/follow', '/v1/send']);
    expect(await status(msg)).toBe('sent');
    // left for the loop to retry
    expect(await row(h('o'))).toMatchObject({ status: 'pending', attempts: 1 });

    // cap 0: the DM skips the follow
    await setCap(0);
    const capped = await newLead({ name: `DM cap ${nonce}`, instagram: `@${h('p')}` });
    calls.length = 0;
    expect(await dispatchMessage(sql, await queueDm(capped))).toEqual({ ok: true });
    expect(calls.map((c) => c.path)).toEqual(['/v1/send']);
  });

  test('a recipient known only by account id is followed and filed under its handle', async () => {
    const lead = await newLead({ name: `Só fbid ${nonce}` });
    replies.set('9090', {
      status: 200,
      body: {
        fbid: '9090',
        igid: '1',
        username: h('q'),
        following: true,
        requested: false,
        already: false,
      },
    });
    await followBeforeDm(sql, await ig(), { leadId: lead, handle: null, fbid: '9090' });
    expect(await row(h('q'))).toMatchObject({ status: 'following', fbid: '9090', lead_id: lead });
    calls.length = 0;
    await followBeforeDm(sql, await ig(), { leadId: lead, handle: null, fbid: '9090' });
    expect(calls).toHaveLength(0);
  });

  test('the background loop works the queue', async () => {
    await sql`delete from job_leases where name = 'instagram.follows'`;
    await newLead({ name: `Loop ${nonce}`, instagram: `@${h('r')}` });
    const stop = startInstagramFollows(sql, { sweepMs: 50, gapMs: 0 });
    try {
      for (let i = 0; i < 100 && (await row(h('r')))?.status !== 'following'; i++)
        await new Promise((r) => setTimeout(r, 20));
    } finally {
      await stop();
      await sql`delete from job_leases where name = 'instagram.follows'`;
    }
    expect(await row(h('r'))).toMatchObject({ status: 'following' });
  });
});
