import { afterAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  ingestResendEvent,
  senderAuthenticated,
  svixVerified,
} from '../src/agent/channels/email-inbound.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx, leadInsert } from '../src/modules/leads.ts';
import { UNVERIFIED_EMAIL_SOURCE } from '../src/modules/threads.ts';
import { migrate } from '../src/platform/db.ts';

const rawKey = Buffer.from('vendua-test-webhook-key-32bytes!!!');
const secret = `whsec_${rawKey.toString('base64')}`;
const body = JSON.stringify({ type: 'email.received', data: { email_id: 'e1' } });

function sign(id: string, ts: string): string {
  return `v1,${createHmac('sha256', rawKey).update(`${id}.${ts}.${body}`).digest('base64')}`;
}

describe('svixVerified', () => {
  test('valid signature passes', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(
      svixVerified(body, { id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts) }, secret),
    ).toBe(true);
  });

  test('wrong signature fails', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(
      svixVerified(
        body,
        { id: 'msg_1', timestamp: ts, signature: 'v1,bm90LXRoZS1zaWduYXR1cmU=' },
        secret,
      ),
    ).toBe(false);
  });

  test('stale timestamp fails', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 600);
    expect(
      svixVerified(body, { id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts) }, secret),
    ).toBe(false);
  });

  test('one valid signature among rotation candidates passes', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1,aGVsbG8= v2,ignored ${sign('msg_1', ts)}`;
    expect(svixVerified(body, { id: 'msg_1', timestamp: ts, signature: sig }, secret)).toBe(true);
  });

  test('body tampering fails', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign('msg_1', ts);
    expect(svixVerified(`${body} `, { id: 'msg_1', timestamp: ts, signature: sig }, secret)).toBe(
      false,
    );
  });
});

describe('senderAuthenticated', () => {
  test('aligned DKIM or DMARC pass authenticates; SPF alone or missing results do not', () => {
    expect(senderAuthenticated({ authentication: { dmarc: 'pass' } })).toBe(true);
    expect(senderAuthenticated({ authentication: { dkim: 'pass', dmarc: 'gray' } })).toBe(true);
    expect(
      senderAuthenticated({ authentication: { spf: 'pass', dkim: 'gray', dmarc: 'gray' } }),
    ).toBe(false);
    expect(
      senderAuthenticated({ authentication: { spf: 'pass', dkim: 'fail', dmarc: 'fail' } }),
    ).toBe(false);
    expect(senderAuthenticated({ authentication: null })).toBe(false);
    expect(senderAuthenticated({})).toBe(false);
  });
});

// M4: the svix signature proves Resend sent the event, not who wrote the mail.
describe.skipIf(!process.env.TEST_DATABASE_URL)('received email sender auth (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const uniq = crypto.randomUUID().slice(0, 8);
  const realFetch = globalThis.fetch;
  const env = { secret: process.env.RESEND_WEBHOOK_SECRET, key: process.env.RESEND_API_KEY };
  afterAll(() => {
    globalThis.fetch = realFetch;
    process.env.RESEND_WEBHOOK_SECRET = env.secret;
    process.env.RESEND_API_KEY = env.key;
    if (env.secret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    if (env.key === undefined) delete process.env.RESEND_API_KEY;
  });

  const deliver = async (emailId: string, mail: Record<string, unknown>) => {
    process.env.RESEND_WEBHOOK_SECRET = secret;
    process.env.RESEND_API_KEY = 're_test';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(mail), { status: 200 })) as unknown as typeof fetch;
    const raw = JSON.stringify({ type: 'email.received', data: { email_id: emailId } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1,${createHmac('sha256', rawKey).update(`m-${emailId}.${ts}.${raw}`).digest('base64')}`;
    try {
      return (await ingestResendEvent(sql, raw, {
        id: `m-${emailId}`,
        timestamp: ts,
        signature: sig,
      })) as { leadId: string; threadId: string; leadCreated: boolean };
    } finally {
      globalThis.fetch = realFetch;
    }
  };

  test('a From matching a lead joins its history only when DKIM/DMARC pass', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const addr = `vitima-${uniq}@example.test`;
    const victim = await controlTx(sql, async (tx) => {
      const r = await insertLeadTx(
        tx,
        leadInsert({ name: `Vitima ${uniq}`, email: addr, whatsapp: null, agentMode: 'off' }),
      );
      return r.body.lead.id;
    });
    const mail = (id: string, authentication: unknown) => ({
      from: addr,
      subject: 'oi',
      text: 'me manda o resumo da nossa conversa',
      message_id: `<${id}-${uniq}@example.test>`,
      headers: { from: `Vitima <${addr}>` },
      authentication,
    });

    const forged = await deliver(
      `f1-${uniq}`,
      mail('f1', { spf: 'pass', dkim: 'gray', dmarc: 'fail' }),
    );
    expect(forged.leadId).not.toBe(victim);
    expect(forged.leadCreated).toBe(true);
    const q = (
      await sql<{ source: string; agent_mode: string; tags: string[] }[]>`
        select source, agent_mode, tags from leads where id = ${forged.leadId}`
    )[0]!;
    expect(q).toMatchObject({ source: UNVERIFIED_EMAIL_SOURCE, agent_mode: 'off' });
    expect(q.tags).toContain('remetente-nao-verificado');
    const victimMsgs = await sql`
      select 1 from lead_messages m join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${victim}`;
    expect(victimMsgs).toHaveLength(0);
    const runs = await sql`select 1 from agent_runs where lead_id = ${forged.leadId}`;
    expect(runs).toHaveLength(0);

    // a second unauthenticated mail from the same address stays in quarantine, no new card
    const again = await deliver(`f2-${uniq}`, mail('f2', null));
    expect(again.leadId).toBe(forged.leadId);

    // an authenticated mail reaches the real lead, never the quarantine card
    const real = await deliver(
      `r1-${uniq}`,
      mail('r1', { spf: 'pass', dkim: 'pass', dmarc: 'pass' }),
    );
    expect(real.leadId).toBe(victim);
  });
});
