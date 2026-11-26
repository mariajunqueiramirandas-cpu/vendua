import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { applyIgEvent } from '../src/crm/channels/instagram.ts';
import { channelAvailabilityTx, instagramReadyTx } from '../src/crm/guardrails.ts';
import {
  IG_PAUSE_AFTER,
  igPausedTx,
  recordIgSendTx,
  resumeIgSendsTx,
} from '../src/crm/ig-health.ts';
import { followBudgetTx } from '../src/crm/ig-follows.ts';
import { dispatchMessage } from '../src/crm/send.ts';
import { controlTx } from '../src/modules/control.ts';
import { upsertIntegration } from '../src/modules/integrations.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { composeMessageTx } from '../src/modules/threads.ts';
import { migrate } from '../src/platform/db.ts';

// Instagram kept the session open (inbox loading, DMs arriving) while it refused every DM the
// account sent, and the agent kept firing cold DMs into it in silence. Three refusals in a row
// pause the agent's DMs and the follows and tell the team; a DM that goes out resumes them.

const REFUSED = 'graphql error at xig_direct_text_send_with_slide_messaging_response: Query Error';

describe.skipIf(!process.env.TEST_DATABASE_URL)('instagram refusals pause the agent (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const SECRET = 'ig-health-secret';
  const saved = { secret: process.env.IG_SIDECAR_SECRET, url: process.env.IG_SIDECAR_URL };
  const startedAt = new Date();

  // a stand-in ig-sidecar: each /v1/send takes the next scripted answer, follows always work
  type Reply = { status: number; body: Record<string, unknown> };
  const sends: Reply[] = [];
  const calls: string[] = [];
  let delivered = 0;
  const sidecar = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const b = (await req.json()) as { fbid?: string; username?: string };
      calls.push(path);
      if (path === '/v1/send') {
        const r = sends.shift() ?? {
          status: 200,
          body: { messageId: `m-${nonce}-${++delivered}`, fbid: '' },
        };
        return Response.json(r.body, { status: r.status });
      }
      return Response.json({
        fbid: b.fbid || '424242',
        igid: '5151',
        username: b.username,
        following: true,
        requested: false,
        already: false,
      });
    },
  });
  const refuse = (code = 'upstream_error', message = REFUSED): Reply => ({
    status: code === 'user_not_found' ? 404 : 502,
    body: { error: { code, message } },
  });

  const newLead = (name: string) =>
    controlTx(
      sql,
      async (tx) =>
        (await insertLeadTx(tx, { name: `${name} ${nonce}`, instagram: `@h${nonce}${name}` })).body
          .lead.id as string,
    );
  const queueDm = (leadId: string, author: 'staff' | 'agent' = 'staff') =>
    controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId,
        channel: 'instagram',
        body: 'Oi! Aqui é a Venduá.',
        author,
        status: 'queued',
      }),
    ).then((c) => c.body.message.id as string);
  const dm = async (author: 'staff' | 'agent' = 'staff') =>
    dispatchMessage(sql, await queueDm(await newLead(`l${calls.length}`), author));
  const events = () =>
    sql<{ kind: string; data: Record<string, unknown> }[]>`
      select kind, data from staff_events
      where kind in ('instagram.paused', 'instagram.resumed') and created_at >= ${startedAt}
      order by id`;
  const paused = () => controlTx(sql, (tx) => igPausedTx(tx));

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    process.env.IG_SIDECAR_SECRET = SECRET;
    process.env.IG_SIDECAR_URL = `http://127.0.0.1:${sidecar.port}`;
    await upsertIntegration(
      sql,
      { kind: 'instagram', driver: 'sidecar', enabled: true },
      `ig-health-test:${crypto.randomUUID()}`,
    );
    await applyIgEvent(sql, { type: 'state', status: { state: 'open' } }, SECRET);
  });
  beforeEach(async () => {
    await controlTx(sql, (tx) => resumeIgSendsTx(tx, 'test reset'));
    await sql`delete from staff_events where kind in ('instagram.paused', 'instagram.resumed')`;
    sends.length = 0;
    calls.length = 0;
  });
  afterAll(async () => {
    // other suites share the account's state: never leave it paused
    await controlTx(sql, (tx) => resumeIgSendsTx(tx, 'test reset'));
    await sql`delete from control_settings where key = 'ig_send_health'`;
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

  test('refusals in a row pause the DMs and follows once; a DM that goes out resumes them', async () => {
    expect(IG_PAUSE_AFTER).toBe(3);
    // a missing recipient says nothing about the account, and a DM that goes out starts over
    sends.push(refuse('user_not_found', 'usuário não encontrado'), refuse(), refuse());
    for (let i = 0; i < 3; i++) expect((await dm()).ok).toBe(false);
    expect(await dm()).toEqual({ ok: true });
    sends.push(refuse(), refuse());
    for (let i = 0; i < 2; i++) expect((await dm()).ok).toBe(false);
    expect(await paused()).toBeNull();
    expect(await events()).toHaveLength(0);

    // the third refusal in a row pauses, and the team hears it once
    sends.push(refuse(), refuse());
    expect((await dm()).ok).toBe(false);
    expect(await paused()).toMatchObject({ error: REFUSED });
    expect((await dm()).ok).toBe(false);
    const [ev, ...more] = await events();
    expect(more).toHaveLength(0);
    expect(ev).toMatchObject({ kind: 'instagram.paused', data: { count: 3, error: REFUSED } });

    // nothing automated plans, picks or follows on Instagram meanwhile
    const lead = await newLead('pausa');
    await controlTx(sql, async (tx) => {
      expect(await instagramReadyTx(tx)).toBe(false);
      expect((await channelAvailabilityTx(tx, lead)).instagram).toMatchObject({ ok: false });
      expect(await followBudgetTx(tx)).toBe(0);
    });

    // an agent DM queued before the pause waits, untouched, without reaching the sidecar
    calls.length = 0;
    const queued = await queueDm(lead, 'agent');
    expect(await dispatchMessage(sql, queued)).toEqual({ ok: true, reason: 'deferred' });
    const [row] = await sql<{ status: string; wait_min: number }[]>`
      select status, extract(epoch from send_after - now())::int / 60 as wait_min
      from lead_messages where id = ${queued}`;
    expect(row).toMatchObject({ status: 'queued' });
    expect(row!.wait_min).toBeGreaterThanOrEqual(25);
    expect(calls).toEqual([]);

    // staff can still send by hand, without a follow first; when it goes out, all resumes
    expect(await dm()).toEqual({ ok: true });
    expect(calls).toEqual(['/v1/send']);
    expect(await paused()).toBeNull();
    expect((await events()).map((e) => e.kind)).toEqual(['instagram.paused', 'instagram.resumed']);
    expect((await events())[1]!.data).toMatchObject({
      failingSince: ev!.data.failingSince,
      reason: 'uma DM saiu de novo',
    });
    await controlTx(sql, async (tx) => {
      expect(await instagramReadyTx(tx)).toBe(true);
      expect(await followBudgetTx(tx)).toBeGreaterThan(0);
    });
  });

  test('a fresh login starts clean', async () => {
    await controlTx(sql, async (tx) => {
      for (let i = 0; i < IG_PAUSE_AFTER; i++)
        await recordIgSendTx(tx, { ok: false, code: 'upstream_error', error: REFUSED });
    });
    expect(await paused()).not.toBeNull();
    await controlTx(sql, (tx) => resumeIgSendsTx(tx, 'o Instagram foi conectado de novo'));
    expect(await paused()).toBeNull();
    expect((await events()).map((e) => [e.kind, e.data.reason ?? null])).toEqual([
      ['instagram.paused', null],
      ['instagram.resumed', 'o Instagram foi conectado de novo'],
    ]);

    // two refusals before a login don't count toward a pause after it
    await controlTx(sql, async (tx) => {
      await recordIgSendTx(tx, { ok: false, code: 'upstream_error', error: REFUSED });
      await recordIgSendTx(tx, { ok: false, code: 'action_blocked', error: 'bloqueado' });
      await resumeIgSendsTx(tx, 'o Instagram foi conectado de novo');
      await recordIgSendTx(tx, { ok: false, code: 'upstream_error', error: REFUSED });
    });
    expect(await paused()).toBeNull();
    // the sidecar being down or a send with no code never reached Instagram
    await controlTx(sql, async (tx) => {
      for (const code of ['sidecar_unreachable', 'not_connected', 'timeout', null])
        await recordIgSendTx(tx, { ok: false, code, error: 'x' });
    });
    expect(await paused()).toBeNull();
  });
});
