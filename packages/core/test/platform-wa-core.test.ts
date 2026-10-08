import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import {
  ensureSocket,
  waIdentity,
  waStatus,
  whatsappRegistered,
} from '../src/agent/channels/whatsapp.ts';
import { dispatchMessage } from '../src/agent/send.ts';
import { whatsappOtpSender } from '../src/admin/auth.ts';
import { platformNotify } from '../src/admin/notify.ts';
import { startSignupOtp } from '../src/modules/billing/signup.ts';
import { controlTx } from '../src/modules/control.ts';
import { getIntegration } from '../src/modules/integrations.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { notifyStaff } from '../src/modules/staff.ts';
import { composeMessageTx } from '../src/modules/threads.ts';
import { settleCrmOnce } from '../src/platform-whatsapp/crm-settle.ts';
import { enqueuePlatformWa } from '../src/platform-whatsapp/outbox.ts';
import {
  setCachedPlatformSession,
  type PlatformSessionRow,
} from '../src/platform-whatsapp/session.ts';
import { migrate } from '../src/platform/db.ts';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'Venduá WhatsApp callers on the gateway (db)',
  () => {
    const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
    const MIGRATIONS = join(import.meta.dir, '../db/migrations');
    const app = createApp({
      sql,
      sessionSecret: 's',
      controlSecret: 'ctl-secret',
      autoDrain: false,
    });
    const nonce = crypto.randomUUID().slice(0, 8);
    const phone11 = () => `219${crypto.randomUUID().replace(/\D/g, '').padEnd(8, '7').slice(0, 8)}`;
    const prevTransport = process.env.WA_PLATFORM_TRANSPORT;
    const outbox: string[] = [];
    const leads: string[] = [];
    let baileysBefore: { enabled: boolean; updated_at: Date } | null = null;
    let session: Record<string, unknown> | null = null;

    const gateway = () => void (process.env.WA_PLATFORM_TRANSPORT = 'gateway');
    const socket = () => void (process.env.WA_PLATFORM_TRANSPORT = 'socket');
    const rowsLike = (prefix: string) =>
      sql<{ id: string; purpose: string; to_jid: string; body: string; ref: string | null }[]>`
      select id, purpose, to_jid, body, ref from platform_wa_outbox
      where dedupe_key like ${`${prefix}%`} order by created_at`;
    // stands in for the gateway: the first matching row it sees, marked as it would
    const settleWhen = async (prefix: string, status: 'sent' | 'failed', waId = 'WAID') => {
      for (let i = 0; i < 100; i++) {
        const [row] = await rowsLike(prefix);
        if (row) {
          outbox.push(row.id);
          await sql`
          update platform_wa_outbox set status = ${status}, attempts = 1,
            wa_id = ${status === 'sent' ? waId : null}, sent_at = ${status === 'sent' ? new Date() : null},
            error = ${status === 'failed' ? 'boom' : null}
          where id = ${row.id}`;
          return row;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`no outbox row like ${prefix}`);
    };

    beforeAll(async () => {
      await migrate(sql, MIGRATIONS);
      const [b] = await sql<{ enabled: boolean; updated_at: Date }[]>`
      select enabled, updated_at from control_integrations where kind = 'whatsapp' and driver = 'baileys'`;
      baileysBefore = b ?? null;
      // the newest enabled row wins: this one, for the whole file
      await sql`
      insert into control_integrations (kind, driver, enabled, updated_at)
      values ('whatsapp', 'baileys', true, now() + interval '1 hour')
      on conflict (kind, driver) do update set enabled = true, updated_at = excluded.updated_at`;
      const [s] = await sql`select * from platform_wa_sessions where name = 'vendua'`;
      session = s ?? null;
    });

    afterEach(() => {
      if (prevTransport === undefined) delete process.env.WA_PLATFORM_TRANSPORT;
      else process.env.WA_PLATFORM_TRANSPORT = prevTransport;
      setCachedPlatformSession(null);
    });

    afterAll(async () => {
      if (baileysBefore)
        await sql`
        update control_integrations set enabled = ${baileysBefore.enabled},
          updated_at = ${baileysBefore.updated_at}
        where kind = 'whatsapp' and driver = 'baileys'`;
      else
        await sql`delete from control_integrations where kind = 'whatsapp' and driver = 'baileys'`;
      if (session)
        await sql`
        update platform_wa_sessions set wanted = ${session.wanted as boolean},
          state = ${session.state as string}, detail = ${session.detail as string | null},
          pair_phone = ${session.pair_phone as string | null},
          pair_requested_at = ${session.pair_requested_at as Date | null},
          wipe_requested_at = ${session.wipe_requested_at as Date | null},
          pair_code = ${session.pair_code as string | null},
          pair_code_expires_at = ${session.pair_code_expires_at as Date | null}
        where name = 'vendua'`;
      await sql`delete from platform_wa_outbox where id = any(${outbox}::uuid[])
      or dedupe_key like ${`%${nonce}%`}`;
      await sql`update agent_runs set status = 'canceled'
      where status = 'queued' and lead_id = any(${leads}::uuid[])`;
      await sql`delete from lead_messages where thread_id in (
      select id from lead_threads where lead_id = any(${leads}::uuid[]))`;
      await sql`update leads set archived_at = now() where id = any(${leads}::uuid[])`;
      await sql.end();
    });

    test('login code: an otp row, one per code', async () => {
      gateway();
      const phone = phone11();
      const send = whatsappOtpSender(sql);
      await send(phone, 'Seu código Venduá: 123456');
      await send(phone, 'Seu código Venduá: 654321');
      const rows = await rowsLike(`otp:${phone}:`);
      outbox.push(...rows.map((r) => r.id));
      expect(rows.map((r) => [r.purpose, r.to_jid])).toEqual([
        ['otp', `55${phone}`],
        ['otp', `55${phone}`],
      ]);
      expect(rows[1]!.body).toContain('654321');
    });

    test('signup code: answers once the gateway sent it, 503 when it fails', async () => {
      gateway();
      const notify = platformNotify(sql);
      const ok = phone11();
      const sent = startSignupOtp(sql, ok, notify);
      const row = await settleWhen(`otp:signup:${ok}:`, 'sent');
      expect(row.purpose).toBe('otp');
      expect((await sent).sent).toBe(true);

      const bad = phone11();
      const refused = startSignupOtp(sql, bad, notify).then(
        () => null,
        (e: { status?: number; code?: string }) => e,
      );
      await settleWhen(`otp:signup:${bad}:`, 'failed');
      expect(await refused).toMatchObject({ status: 503, code: 'OTP_UNAVAILABLE' });
    });

    test('a wait that runs out throws, which signup turns into the same 503', async () => {
      gateway();
      const phone = phone11();
      const err = await platformNotify(sql)
        .whatsapp(phone, 'código', { purpose: 'otp', dedupeKey: `otp:t:${nonce}`, waitMs: 300 })
        .then(
          () => null,
          (e: Error) => e,
        );
      expect(err?.message).toBe('whatsapp message timeout');
      const [row] = await rowsLike(`otp:t:${nonce}`);
      expect(row!.purpose).toBe('otp');
    });

    test('notices: purpose notice, deduped by the caller key', async () => {
      gateway();
      const phone = phone11();
      const notify = platformNotify(sql);
      await notify.whatsapp(phone, 'Convite', { dedupeKey: `invite:${nonce}` });
      await notify.whatsapp(phone, 'Convite', { dedupeKey: `invite:${nonce}` });
      expect((await rowsLike(`invite:${nonce}`)).map((r) => r.purpose)).toEqual(['notice']);
      await notify.whatsapp(phone, 'Sem chave');
      const loose = await sql<{ purpose: string }[]>`
      select purpose from platform_wa_outbox where to_jid = ${`55${phone}`} and dedupe_key like 'notice:%'`;
      expect(loose.map((r) => r.purpose)).toEqual(['notice']);
      await sql`delete from platform_wa_outbox where to_jid = ${`55${phone}`}`;

      const [before] = await sql`select value from control_settings where key = 'staff'`;
      const wa = `55${phone11()}`;
      try {
        await sql`
        insert into control_settings (key, value)
        values ('staff', ${sql.json({ members: [{ name: 'Ana', email: '', whatsapp: wa }] } as never)})
        on conflict (key) do update set value = excluded.value`;
        const out = await notifyStaff(sql, null, {
          subject: 'Teste',
          body: 'corpo',
          idemKey: `staff-${nonce}`,
        });
        expect(out).toEqual([{ name: 'Ana', channel: 'whatsapp', to: wa, ok: true }]);
        const rows = await rowsLike(`notice:staff-${nonce}:`);
        expect(rows.map((r) => [r.purpose, r.to_jid])).toEqual([['notice', wa]]);
      } finally {
        if (before)
          await sql`update control_settings set value = ${sql.json(before.value as never)} where key = 'staff'`;
        else await sql`delete from control_settings where key = 'staff'`;
      }
    });

    const queued = async (
      body = 'Oi! Aqui é da Venduá.',
      whatsapp: string | null = `55${phone11()}`,
    ) => {
      const lead = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: `Gateway ${nonce}`, ...(whatsapp ? { whatsapp } : {}) }),
      );
      const leadId = lead.body.lead.id as string;
      leads.push(leadId);
      await sql`update agent_runs set status = 'canceled' where status = 'queued' and lead_id = ${leadId}`;
      const composed = await controlTx(sql, (tx) =>
        composeMessageTx(tx, {
          leadId,
          channel: 'whatsapp',
          body,
          author: 'staff',
          status: 'queued',
        }),
      );
      return { leadId, messageId: composed.body.message.id as string, whatsapp };
    };
    const message = async (id: string) =>
      (
        await sql<{ status: string; error: string | null; provider_message_id: string | null }[]>`
        select status, error, provider_message_id from lead_messages where id = ${id}`
      )[0]!;

    test('a CRM send is its claim plus an outbox row; the settle finishes it', async () => {
      gateway();
      const m = await queued();
      expect(await dispatchMessage(sql, m.messageId)).toEqual({ ok: true, reason: 'queued' });
      expect((await message(m.messageId)).status).toBe('sending');
      const [row] = await rowsLike(`crm:${m.messageId}`);
      outbox.push(row!.id);
      expect(row).toMatchObject({ purpose: 'crm', ref: m.messageId, to_jid: m.whatsapp });
      // a replay sees the claim and doesn't queue it twice
      expect(await dispatchMessage(sql, m.messageId)).toEqual({
        ok: true,
        reason: 'dispatch in flight',
      });
      expect(await rowsLike(`crm:${m.messageId}`)).toHaveLength(1);

      // nothing to finish until the gateway settles it
      await settleCrmOnce(sql);
      expect((await message(m.messageId)).status).toBe('sending');

      const waId = `WA${nonce}`.toUpperCase();
      await settleWhen(`crm:${m.messageId}`, 'sent', waId);
      expect(await settleCrmOnce(sql)).toBeGreaterThanOrEqual(1);
      expect(await message(m.messageId)).toMatchObject({
        status: 'sent',
        provider_message_id: `whatsapp:${waId}`,
      });
      const [lead] = await sql<{ state: string }[]>`select state from leads where id = ${m.leadId}`;
      expect(lead!.state).toBe('contacted');
      const [settled] = await sql<{ settled_at: Date | null }[]>`
      select settled_at from platform_wa_outbox where id = ${row!.id}`;
      expect(settled!.settled_at).not.toBeNull();
    });

    test('a send the gateway gave up on fails the message', async () => {
      gateway();
      const m = await queued();
      await dispatchMessage(sql, m.messageId);
      await settleWhen(`crm:${m.messageId}`, 'failed');
      await settleCrmOnce(sql);
      expect(await message(m.messageId)).toMatchObject({ status: 'failed', error: 'boom' });
    });

    test('a row whose settle keeps failing backs off, then is given up; newer rows still settle', async () => {
      gateway();
      const poison = `poison ${nonce}`;
      const bad = await queued(poison);
      await dispatchMessage(sql, bad.messageId);
      const good = await queued();
      await dispatchMessage(sql, good.messageId);
      await sql.unsafe(`create or replace function test_settle_poison() returns trigger
        language plpgsql as $$ begin raise exception 'poison'; end $$`);
      await sql.unsafe(`create trigger test_settle_poison_${nonce} before update on lead_messages
        for each row when (old.body = '${poison}') execute function test_settle_poison()`);
      try {
        await settleWhen(`crm:${bad.messageId}`, 'failed');
        await settleWhen(`crm:${good.messageId}`, 'sent', `WP${nonce}`.toUpperCase());
        const badRow = async () =>
          (
            await sql<
              { settle_attempts: number; settle_retry_at: Date | null; settled_at: Date | null }[]
            >`select settle_attempts, settle_retry_at, settled_at from platform_wa_outbox
              where dedupe_key like ${`crm:${bad.messageId}%`}`
          )[0]!;
        await settleCrmOnce(sql);
        expect((await message(good.messageId)).status).toBe('sent');
        let b = await badRow();
        expect(b.settle_attempts).toBe(1);
        expect(b.settled_at).toBeNull();
        expect(b.settle_retry_at!.getTime()).toBeGreaterThan(Date.now());
        // backing off: the next pass doesn't take it
        await settleCrmOnce(sql);
        expect((await badRow()).settle_attempts).toBe(1);
        await sql`update platform_wa_outbox set settle_attempts = 9, settle_retry_at = now()
          where dedupe_key like ${`crm:${bad.messageId}%`}`;
        await settleCrmOnce(sql);
        b = await badRow();
        expect(b.settle_attempts).toBe(10);
        expect(b.settled_at).not.toBeNull();
      } finally {
        await sql.unsafe(`drop trigger if exists test_settle_poison_${nonce} on lead_messages`);
        await sql.unsafe('drop function if exists test_settle_poison()');
      }
      await sql`update lead_messages set status = 'failed' where id = ${bad.messageId}`;
    });

    test('a send the stranded sweep failed comes back as sent when the gateway sent it', async () => {
      gateway();
      const m = await queued();
      await dispatchMessage(sql, m.messageId);
      await sql`update lead_messages set status = 'failed', error = 'dispatch-interrupted'
      where id = ${m.messageId}`;
      await settleWhen(`crm:${m.messageId}`, 'sent', `WB${nonce}`.toUpperCase());
      await settleCrmOnce(sql);
      expect(await message(m.messageId)).toMatchObject({ status: 'sent', error: null });
    });

    test('the claim and the outbox row commit together', async () => {
      gateway();
      const m = await queued('Oi', null);
      // a jid the outbox refuses (> 120 chars): the claim must roll back with it
      await sql`update lead_threads set external_id = ${`${'1'.repeat(130)}@lid`}
      where lead_id = ${m.leadId}`;
      await expect(dispatchMessage(sql, m.messageId)).rejects.toThrow(/to_jid/);
      expect((await message(m.messageId)).status).toBe('queued');
      expect(await rowsLike(`crm:${m.messageId}`)).toHaveLength(0);
      await sql`update lead_messages set status = 'failed' where id = ${m.messageId}`;
    });

    test('socket readers answer from the session row and the probe', async () => {
      gateway();
      const row = (state: PlatformSessionRow['state']): PlatformSessionRow => ({
        name: 'vendua',
        wanted: true,
        state,
        detail: null,
        pair_code: null,
        pair_code_expires_at: null,
        phone: '5521900000000',
        account_name: 'Venduá',
        connected_at: new Date(),
        state_changed_at: new Date(),
        lease_until: null,
      });
      setCachedPlatformSession(row('pairing'));
      expect(waStatus()).toBe('connecting');
      expect(waIdentity()).toBeNull();
      const target = `55${phone11()}`;
      expect(await whatsappRegistered(target, sql)).toBeNull();
      expect((await sql`select 1 from platform_wa_probes where phone = ${target}`).length).toBe(0);

      setCachedPlatformSession(row('open'));
      expect(waStatus()).toBe('open');
      expect(waIdentity()).toEqual({ phone: '5521900000000', name: 'Venduá' });
      expect(await whatsappRegistered(target)).toBeNull();
      const asked = whatsappRegistered(target, sql);
      for (let i = 0; i < 100; i++) {
        const [p] = await sql<{ id: string }[]>`
        select id from platform_wa_probes where phone = ${target} and answered_at is null`;
        if (p) {
          await sql`update platform_wa_probes set result = true, answered_at = now() where id = ${p.id}`;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(await asked).toBe(true);
      await sql`delete from platform_wa_probes where phone = ${target}`;

      // Core never opens its own socket on the gateway's login
      expect(await ensureSocket(sql, await getIntegration(sql, 'whatsapp'))).toBeNull();
      socket();
      expect(waStatus()).toBe('off');
    });

    const control = (method: string, path: string, key: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-vendua-control': 'ctl-secret',
          'idempotency-key': `pwa-${nonce}-${key}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    test('control routes drive the session row', async () => {
      gateway();
      await sql`update platform_wa_sessions set state = 'off', pair_code = null, pair_phone = null,
      wipe_requested_at = null where name = 'vendua'`;
      const pairPhone = `1415${phone11().slice(0, 7)}`;
      const res = control('POST', '/control/v1/wa/pair-code', 'pair', { phone: pairPhone });
      // the gateway's side: a code once it sees the request
      for (let i = 0; i < 100; i++) {
        const [s] = await sql<{ wanted: boolean; pair_phone: string | null }[]>`
        select wanted, pair_phone from platform_wa_sessions
        where name = 'vendua' and pair_requested_at is not null`;
        if (s?.pair_phone === pairPhone) {
          expect(s.wanted).toBe(true);
          await sql`update platform_wa_sessions set state = 'pairing', pair_code = 'ABCD1234',
          pair_code_expires_at = now() + interval '2 minutes' where name = 'vendua'`;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      const r = await res;
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ code: 'ABCD1234' });

      const qr = await app.request('/control/v1/wa/qr', {
        headers: { 'x-vendua-control': 'ctl-secret' },
      });
      expect(await qr.json()).toMatchObject({
        qr: null,
        status: 'connecting',
        me: null,
        transport: 'gateway',
        state: 'pairing',
        pairCode: 'ABCD1234',
      });

      await sql`update platform_wa_sessions set state = 'open' where name = 'vendua'`;
      const again = await control('POST', '/control/v1/wa/pair-code', 'pair2', {
        phone: pairPhone,
      });
      expect(again.status).toBe(422);

      const out = await control('POST', '/control/v1/wa/logout', 'logout');
      expect(out.status).toBe(200);
      const [s] = await sql<{ wipe_requested_at: Date | null }[]>`
      select wipe_requested_at from platform_wa_sessions where name = 'vendua'`;
      expect(s!.wipe_requested_at).not.toBeNull();

      socket();
      const sq = await app.request('/control/v1/wa/qr', {
        headers: { 'x-vendua-control': 'ctl-secret' },
      });
      expect(await sq.json()).toMatchObject({ transport: 'socket', status: 'off' });
    }, 15_000);

    test('turning the WhatsApp integration off lets go of the number on the gateway', async () => {
      gateway();
      await sql`update platform_wa_sessions set wanted = true where name = 'vendua'`;
      const put = (key: string, enabled: boolean) =>
        app.request('/control/v1/integrations/whatsapp', {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            'x-vendua-control': 'ctl-secret',
            'idempotency-key': `pwa-${nonce}-${key}`,
          },
          body: JSON.stringify({ driver: 'baileys', enabled }),
        });
      const wanted = async () =>
        (
          await sql<{ wanted: boolean }[]>`
          select wanted from platform_wa_sessions where name = 'vendua'`
        )[0]!.wanted;
      expect((await put('int-off', false)).status).toBe(200);
      expect(await wanted()).toBe(false);
      expect((await put('int-on', true)).status).toBe(200);
      expect(await wanted()).toBe(true);
    });

    test('a CRM message keeps its whole body in the outbox', async () => {
      const long = 'x'.repeat(7000);
      const { id } = await enqueuePlatformWa(sql as never, {
        to: `55${phone11()}`,
        body: long,
        purpose: 'crm',
        dedupeKey: `crm-long-${nonce}`,
      });
      const [row] = await sql<
        { body: string }[]
      >`select body from platform_wa_outbox where id = ${id}`;
      expect(row!.body.length).toBe(7000);
    });
  },
);
