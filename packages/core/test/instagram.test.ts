import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { ingestInbound } from '../src/agent/inbound.ts';
import { dispatchMessage } from '../src/agent/send.ts';
import {
  channelAvailabilityTx,
  instagramColdCapTx,
  resolveChannelTx,
} from '../src/agent/guardrails.ts';
import {
  igEventSignatureOk,
  igStatus,
  parseIgEvent,
  seal,
  unseal,
} from '../src/agent/channels/instagram.ts';
import { approveMessage, composeMessageTx, instagramHandle } from '../src/modules/threads.ts';
import {
  DEFAULT_GUARDRAILS,
  upsertIntegration,
  validateSetting,
} from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

describe('instagramHandle', () => {
  test('normalizes handles and profile URLs', () => {
    expect(instagramHandle('@Doceria.Aurora')).toBe('doceria.aurora');
    expect(instagramHandle('https://www.instagram.com/brasa_burger/')).toBe('brasa_burger');
    expect(instagramHandle('instagram.com/forn?igsh=abc')).toBe('forn');
    expect(instagramHandle(' plain ')).toBe('plain');
  });
  test('rejects non-handles', () => {
    for (const bad of [null, undefined, '', '@', 'has space', 'ümlaut', 'x'.repeat(31)]) {
      expect(instagramHandle(bad)).toBeNull();
    }
  });
});

describe('sidecar event signature', () => {
  // same vector as services/ig-sidecar TestSign — the two sides must agree byte for byte
  const vector = '2ed197af43a338c079a4fcfabaceeebaea12b645a8f18a6543e2765a7a729b86';
  test('accepts the shared vector', () => {
    expect(igEventSignatureOk('secret', '1700000000', vector, '{"type":"state"}', 1700000000)).toBe(
      true,
    );
  });
  test('rejects tampering, skew and junk', () => {
    expect(igEventSignatureOk('secret', '1700000000', vector, '{"type":"stat"}', 1700000000)).toBe(
      false,
    );
    expect(igEventSignatureOk('other', '1700000000', vector, '{"type":"state"}', 1700000000)).toBe(
      false,
    );
    // replayed 10 minutes later
    expect(igEventSignatureOk('secret', '1700000000', vector, '{"type":"state"}', 1700000600)).toBe(
      false,
    );
    expect(igEventSignatureOk('secret', undefined, vector, '{}', 1700000000)).toBe(false);
    expect(igEventSignatureOk('secret', '1700000000', 'zz', '{}', 1700000000)).toBe(false);
  });
});

describe('stored credential sealing', () => {
  const session = { cookies: { sessionid: 'S', csrftoken: 'C', ds_user_id: '1' } };
  test('round-trips and never stores the cookie values in the clear', () => {
    const sealed = seal('k1', session);
    expect(JSON.stringify(sealed)).not.toContain('sessionid');
    expect(unseal('k1', sealed)).toEqual(session);
  });
  test('wrong key, tampering or a plaintext row read as nothing', () => {
    const sealed = seal('k1', session);
    expect(unseal('k2', sealed)).toBeNull();
    const ct = Buffer.from(sealed.ct, 'base64');
    ct[0] = ct[0]! ^ 1;
    expect(unseal('k1', { ...sealed, ct: ct.toString('base64') })).toBeNull();
    expect(unseal('k1', session)).toBeNull();
    expect(unseal('k1', null)).toBeNull();
  });
});

describe('parseIgEvent', () => {
  test('message', () => {
    const e = parseIgEvent({
      type: 'message',
      message: {
        id: 'mid.1',
        fromFbid: '17841400000000001',
        username: 'Doceria.Aurora',
        name: 'Doceria Aurora',
        text: 'oi',
        sentAtMs: 1_700_000_000_000,
      },
    });
    expect(e).toMatchObject({
      type: 'message',
      message: { id: 'mid.1', username: 'doceria.aurora', name: 'Doceria Aurora', text: 'oi' },
    });
  });
  test('bad shapes are a stable 422', () => {
    const bad = [
      null,
      [],
      { type: 'nope' },
      { type: 'state', state: 'weird' },
      { type: 'session', session: { cookies: { sessionid: 'a' } } },
      { type: 'message', message: { id: 'm', fromFbid: 'not-digits', text: 'oi' } },
      { type: 'message', message: { id: 'm', fromFbid: '1', text: '   ' } },
      { type: 'message', message: { id: 'm', fromFbid: '1', text: 'x'.repeat(8001) } },
    ];
    for (const b of bad) {
      let status = 0;
      try {
        parseIgEvent(b);
      } catch (e) {
        status = (e as { status?: number }).status ?? -1;
      }
      expect(status).toBe(422);
    }
  });
  test('an implausible timestamp is dropped, not trusted', () => {
    const e = parseIgEvent({
      type: 'message',
      message: { id: 'm', fromFbid: '1', text: 'oi', sentAtMs: Date.now() + 10 * 86_400_000 },
    });
    expect(e.type === 'message' && e.message.sentAt).toBeNull();
  });
});

describe('guardrails — instagramColdDmsPerDay', () => {
  test('default and bounds', () => {
    expect(DEFAULT_GUARDRAILS.instagramColdDmsPerDay).toBe(15);
    expect(() => validateSetting('guardrails', { instagramColdDmsPerDay: 0 })).not.toThrow();
    expect(() => validateSetting('guardrails', { instagramColdDmsPerDay: 201 })).toThrow();
    expect(() => validateSetting('guardrails', { instagramColdDmsPerDay: 1.5 })).toThrow();
  });
});

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('instagram channel (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  // fbids are digits; a per-run base keeps re-runs on the shared DB independent
  const fbBase = `9${Date.now()}`;
  const SECRET = 'ig-test-secret';
  const prevSecret = process.env.IG_SIDECAR_SECRET;

  const enable = (driver: 'log' | 'sidecar') =>
    upsertIntegration(
      sql,
      { kind: 'instagram', driver, enabled: true },
      `ig-test:${driver}:${crypto.randomUUID()}`,
    );

  const newLead = (fields: Record<string, unknown>) =>
    controlTx(sql, async (tx) => (await insertLeadTx(tx, fields)).body.lead.id as string);

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    process.env.IG_SIDECAR_SECRET = SECRET;
  });
  afterAll(async () => {
    await sql`update control_integrations set enabled = false where kind = 'instagram'`;
    await sql`delete from control_settings where key = 'guardrails'`;
    // live ingests queue reply runs — park them like the whatsapp suite does
    await sql`update agent_runs set status = 'canceled' where status = 'queued'`;
    if (prevSecret === undefined) delete process.env.IG_SIDECAR_SECRET;
    else process.env.IG_SIDECAR_SECRET = prevSecret;
  });

  test('inbound DM mints a lead keyed by account id, and a renamed handle converges', async () => {
    const fbid = `${fbBase}1`;
    const first = await ingestInbound(sql, {
      channel: 'instagram',
      from: `@ig${nonce}a`,
      fromName: 'Doceria Teste',
      body: 'oi, vi o post de vocês',
      providerMessageId: `mid-a1-${nonce}`,
      externalThreadId: fbid,
    });
    if ('ignored' in first) throw new Error('unexpected ignore');
    expect(first.leadCreated).toBe(true);
    const lead = (
      await sql<{ instagram: string; name: string; source: string }[]>`
        select instagram, name, source from leads where id = ${first.leadId}`
    )[0]!;
    expect(lead).toMatchObject({
      instagram: `@ig${nonce}a`,
      name: 'Doceria Teste',
      source: 'inbound:instagram',
    });
    const thread = (
      await sql<{ channel: string; external_id: string }[]>`
        select channel, external_id from lead_threads where id = ${first.threadId}`
    )[0]!;
    expect(thread).toEqual({ channel: 'instagram', external_id: fbid });

    // same account, new handle → same lead and thread
    const renamed = await ingestInbound(sql, {
      channel: 'instagram',
      from: `@ig${nonce}renamed`,
      body: 'mudei o @',
      providerMessageId: `mid-a2-${nonce}`,
      externalThreadId: fbid,
    });
    if ('ignored' in renamed) throw new Error('unexpected ignore');
    expect(renamed.leadId).toBe(first.leadId);
    expect(renamed.leadCreated).toBe(false);
    // the account-id match proves the new handle — the freed old one must not linger
    const after = (
      await sql<{ instagram: string }[]>`select instagram from leads where id = ${first.leadId}`
    )[0]!;
    expect(after.instagram).toBe(`@ig${nonce}renamed`);

    // provider retry is a no-op
    const replay = await ingestInbound(sql, {
      channel: 'instagram',
      from: `@ig${nonce}a`,
      body: 'oi, vi o post de vocês',
      providerMessageId: `mid-a1-${nonce}`,
      externalThreadId: fbid,
    });
    expect('alreadySeen' in replay && replay.alreadySeen).toBe(true);
  });

  test('inbound DM matches a researched lead by its stored profile URL', async () => {
    const leadId = await newLead({
      name: `Pesquisada ${nonce}`,
      instagram: `https://www.instagram.com/IG${nonce}B/`,
    });
    const res = await ingestInbound(sql, {
      channel: 'instagram',
      from: `@ig${nonce}b`,
      body: 'recebi sua mensagem',
      providerMessageId: `mid-b1-${nonce}`,
      externalThreadId: `${fbBase}2`,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    expect(res.leadId).toBe(leadId);
    expect(res.leadCreated).toBe(false);
  });

  test('availability, auto-pick order and log-driver dispatch', async () => {
    await enable('log');
    const withHandle = await newLead({ name: `Handle ${nonce}`, instagram: `@ig${nonce}c` });
    const bare = await newLead({ name: `Sem canal ${nonce}` });
    const avail = await controlTx(sql, (tx) => channelAvailabilityTx(tx, withHandle));
    expect(avail.instagram).toEqual({ ok: true });
    const none = await controlTx(sql, (tx) => channelAvailabilityTx(tx, bare));
    expect(none.instagram).toEqual({ ok: false, reason: 'lead has no instagram' });

    // no whatsapp → instagram beats email on first contact
    const both = await newLead({
      name: `Email+IG ${nonce}`,
      instagram: `@ig${nonce}d`,
      email: `ig${nonce}d@example.com`,
    });
    const pick = await controlTx(sql, (tx) => resolveChannelTx(tx, both, {}));
    expect(pick).toMatchObject({ ok: true, channel: 'instagram', via: 'fallback' });

    const composed = await controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId: withHandle,
        channel: 'instagram',
        body: 'Oi! Aqui é a Venduá.',
        author: 'staff',
        status: 'queued',
      }),
    );
    const sent = await dispatchMessage(sql, composed.body.message.id);
    expect(sent).toEqual({ ok: true });
    const row = (
      await sql<{ status: string; provider_message_id: string }[]>`
        select status, provider_message_id from lead_messages where id = ${composed.body.message.id}`
    )[0]!;
    expect(row.status).toBe('sent');
    expect(row.provider_message_id.startsWith('instagram:log:')).toBe(true);
  });

  // the shared test DB holds other runs' rows — budgets are measured relative to this
  // (mirrors instagramColdCapTx: threads whose first outbound, agent-authored and
  // unprompted, landed in the last day)
  const coldUsed = async () =>
    (
      await sql<{ n: number }[]>`
        select count(distinct o.id)::int as n from (
          select t.id, min(m.created_at) as opened_at from lead_messages m
          join lead_threads t on t.id = m.thread_id
          where t.channel = 'instagram' and m.direction = 'out'
            and m.status in ('queued', 'sending', 'sent', 'delivered')
          group by t.id
        ) o
        join lead_messages f on f.thread_id = o.id and f.created_at = o.opened_at
        where o.opened_at > now() - interval '1 day' and f.author = 'agent'
          and not exists (select 1 from lead_messages i where i.thread_id = o.id
                          and i.direction = 'in' and i.created_at < o.opened_at)`
    )[0]!.n;

  test('cold-DM cap is account-wide, replies are exempt, 0 turns cold DMs off', async () => {
    await sql`
      insert into control_settings (key, value)
      values ('guardrails', ${sql.json({ instagramColdDmsPerDay: 1 } as never)})
      on conflict (key) do update set value = excluded.value`;
    const g = { ...DEFAULT_GUARDRAILS, instagramColdDmsPerDay: 1 };
    const g0 = { ...DEFAULT_GUARDRAILS, instagramColdDmsPerDay: 0 };
    const gCap = { ...g, instagramColdDmsPerDay: (await coldUsed()) + 1 };

    const a = await newLead({ name: `Frio A ${nonce}`, instagram: `@ig${nonce}e` });
    const b = await newLead({ name: `Frio B ${nonce}`, instagram: `@ig${nonce}f` });
    expect(await controlTx(sql, (tx) => instagramColdCapTx(tx, gCap, b))).toBeNull();
    await controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId: a,
        channel: 'instagram',
        body: 'primeiro contato',
        author: 'agent',
        status: 'queued',
      }),
    );
    expect(await controlTx(sql, (tx) => instagramColdCapTx(tx, gCap, b))).toBe(
      'instagram cold-DM daily cap reached',
    );
    // A's own follow-up doesn't open a second conversation
    expect(await controlTx(sql, (tx) => instagramColdCapTx(tx, gCap, a))).toBeNull();
    expect(await controlTx(sql, (tx) => instagramColdCapTx(tx, g0, b))).toBe(
      'instagram cold DMs off',
    );

    // once B writes on instagram, answering is no longer cold
    await ingestInbound(sql, {
      channel: 'instagram',
      from: `@ig${nonce}f`,
      body: 'oi!',
      providerMessageId: `mid-f1-${nonce}`,
      externalThreadId: `${fbBase}6`,
    });
    expect(await controlTx(sql, (tx) => instagramColdCapTx(tx, g0, b))).toBeNull();
  });

  test('a conversation counts once: an old cold DM frees its slot, follow-ups stay free', async () => {
    const g = { ...DEFAULT_GUARDRAILS, instagramColdDmsPerDay: (await coldUsed()) + 1 };
    const a = await newLead({ name: `Velho A ${nonce}`, instagram: `@ig${nonce}h` });
    const b = await newLead({ name: `Novo B ${nonce}`, instagram: `@ig${nonce}i` });
    const first = await controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId: a,
        channel: 'instagram',
        body: 'primeiro contato',
        author: 'agent',
        status: 'queued',
      }),
    );
    // A was opened two days ago; today's follow-up must not re-open it
    await sql`update lead_messages set created_at = now() - interval '2 days'
              where id = ${first.body.message.id}`;
    await controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId: a,
        channel: 'instagram',
        body: 'retomando',
        author: 'agent',
        status: 'queued',
      }),
    );
    expect(await controlTx(sql, (tx) => instagramColdCapTx(tx, g, b))).toBeNull();
    expect(await controlTx(sql, (tx) => instagramColdCapTx(tx, g, a))).toBeNull();
  });

  test('approving an agent cold draft over the cap is refused and keeps the draft', async () => {
    await sql`
      insert into control_settings (key, value)
      values ('guardrails', ${sql.json({ instagramColdDmsPerDay: 1 } as never)})
      on conflict (key) do update set value = excluded.value`;
    const filler = await newLead({ name: `Cota ${nonce}`, instagram: `@ig${nonce}j` });
    // make sure at least one cold conversation is open today
    await controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId: filler,
        channel: 'instagram',
        body: 'oi',
        author: 'agent',
        status: 'queued',
      }),
    );
    const c = await newLead({ name: `Rascunho ${nonce}`, instagram: `@ig${nonce}k` });
    const draft = await controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId: c,
        channel: 'instagram',
        body: 'primeiro contato revisado',
        author: 'agent',
        status: 'draft',
      }),
    );
    let code = '';
    try {
      await approveMessage(sql, draft.body.message.id, 'staff', `ig-approve-${nonce}`);
    } catch (e) {
      code = (e as { code?: string }).code ?? '';
    }
    expect(code).toBe('IG_COLD_CAP');
    const row = (
      await sql<
        { status: string }[]
      >`select status from lead_messages where id = ${draft.body.message.id}`
    )[0]!;
    expect(row.status).toBe('draft');
    await sql`delete from control_settings where key = 'guardrails'`;
  });

  test('an instagram DM over 1000 chars is refused at compose', async () => {
    const d = await newLead({ name: `Longa ${nonce}`, instagram: `@ig${nonce}l` });
    let status = 0;
    try {
      await controlTx(sql, (tx) =>
        composeMessageTx(tx, {
          leadId: d,
          channel: 'instagram',
          body: 'á'.repeat(1001),
          author: 'staff',
          status: 'draft',
        }),
      );
    } catch (e) {
      status = (e as { status?: number }).status ?? -1;
    }
    expect(status).toBe(422);
    // exactly the limit (counted in characters, not bytes) is fine
    await controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId: d,
        channel: 'instagram',
        body: 'á'.repeat(1000),
        author: 'staff',
        status: 'draft',
      }),
    );
  });

  test('signed sidecar events: 404 unsigned, state updates, message ingests', async () => {
    await enable('sidecar');
    const app = createApp({
      sql,
      sessionSecret: 's',
      controlSecret: 'ctl-secret',
      autoDrain: false,
    });
    const post = (body: unknown, opts: { sign?: boolean; ts?: number } = {}) => {
      const raw = JSON.stringify(body);
      const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
      const sig = createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
      return app.request('/control/v1/ig/events', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(opts.sign === false ? {} : { 'x-ig-timestamp': ts, 'x-ig-signature': sig }),
        },
        body: raw,
      });
    };

    expect((await post({ type: 'state', state: 'open' }, { sign: false })).status).toBe(404);
    expect(
      (await post({ type: 'state', state: 'open' }, { ts: Math.floor(Date.now() / 1000) - 900 }))
        .status,
    ).toBe(404);

    const st = await post({
      type: 'state',
      state: 'open',
      account: { username: 'vendua.digital', fbid: '1' },
    });
    expect(st.status).toBe(200);
    expect(igStatus()).toMatchObject({ state: 'open', account: { username: 'vendua.digital' } });

    const msg = await post({
      type: 'message',
      message: {
        id: `mid-g1-${nonce}`,
        fromFbid: `${fbBase}7`,
        username: `ig${nonce}g`,
        name: 'Lead Webhook',
        text: 'quero saber o preço',
        sentAtMs: Date.now(),
      },
    });
    expect(msg.status).toBe(201);
    const body = (await msg.json()) as { leadId: string; leadCreated: boolean };
    expect(body.leadCreated).toBe(true);
    const lead = (
      await sql<{ instagram: string }[]>`select instagram from leads where id = ${body.leadId}`
    )[0]!;
    expect(lead.instagram).toBe(`@ig${nonce}g`);

    expect((await post({ type: 'message', message: { id: 'x' } })).status).toBe(422);

    // a rotated session lands sealed — only an existing (live) credential is refreshed
    await sql`
      insert into ig_auth_state (account_id, session)
      values ('default', ${sql.json(seal(SECRET, { cookies: { sessionid: 'old', csrftoken: 'c', ds_user_id: '1' } }) as never)})
      on conflict (account_id) do update set session = excluded.session`;
    const rotated = { cookies: { sessionid: 'rotated-sid', csrftoken: 'c2', ds_user_id: '1' } };
    expect((await post({ type: 'session', session: rotated })).status).toBe(200);
    const stored = (
      await sql<
        { session: unknown }[]
      >`select session from ig_auth_state where account_id = 'default'`
    )[0]!.session;
    expect(JSON.stringify(stored)).not.toContain('rotated-sid');
    expect(unseal(SECRET, stored)).toMatchObject(rotated);

    // a dead session is wiped so a sidecar restart doesn't re-push it
    await sql`
      insert into ig_auth_state (account_id, session)
      values ('default', ${sql.json({ cookies: { sessionid: 's', csrftoken: 'c', ds_user_id: '1' } } as never)})
      on conflict (account_id) do update set session = excluded.session`;
    const dead = await post({
      type: 'state',
      state: 'error',
      error: { code: 'logged_out', message: 'x' },
    });
    expect(dead.status).toBe(200);
    const row = (
      await sql<
        { session: unknown }[]
      >`select session from ig_auth_state where account_id = 'default'`
    )[0]!;
    expect(row.session).toBeNull();

    // signed but oddly-shaped fields degrade to null, never a 500
    const odd = await post({ type: 'state', state: 'connecting', error: 'boom', account: 5 });
    expect(odd.status).toBe(200);
    expect(igStatus()).toMatchObject({ state: 'connecting', error: null, account: null });

    // a disabled driver drops even correctly signed events
    await sql`update control_integrations set enabled = false where kind = 'instagram'`;
    const late = await post({
      type: 'message',
      message: { id: `mid-z-${nonce}`, fromFbid: `${fbBase}9`, text: 'atrasada' },
    });
    expect(late.status).toBe(404);
  });
});
