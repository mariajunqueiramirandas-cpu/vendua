import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/platform/db.ts';

// "Quer ajuda para começar?" on the site: a lead the team hears about, once per WhatsApp.

describe.skipIf(!process.env.TEST_DATABASE_URL)('site leads (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const mk = () => createApp({ sql, sessionSecret: 's', controlSecret: 'ctl' });
  // the per-IP limit (5 in 10 minutes) lives in each app: each test gets its own budget
  let app = mk();
  const tail = String(Date.now()).slice(-8);
  const whatsapp = `2199${tail.slice(-7)}`;
  let ip = 0;
  const post = (body: unknown) =>
    app.request('http://core.localhost/site/v1/leads', {
      method: 'POST',
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        'x-forwarded-for': `203.0.113.${++ip}`,
      },
      body: JSON.stringify(body),
    });
  const leads = () => sql`select * from leads where whatsapp = ${`+55${whatsapp}`}`;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });
  afterAll(async () => {
    await sql`delete from leads where whatsapp = ${`+55${whatsapp}`}`;
    await sql.end();
  });

  test('bad input is a 422; the honeypot is accepted and dropped', async () => {
    expect((await post({ name: 'A', whatsapp })).status).toBe(422);
    expect((await post({ name: 'Rita', whatsapp: '123' })).status).toBe(422);
    expect((await post({ name: 'Rita', whatsapp, segment: 'nope' })).status).toBe(422);
    expect((await post({ name: 'Rita', whatsapp, website: 'http://spam' })).status).toBe(202);
    expect(await leads()).toHaveLength(0);
  });

  test('a request is one lead, the team hears; a repeat is a note on it', async () => {
    app = mk();
    const r = await post({
      name: 'Rita',
      whatsapp: `(${whatsapp.slice(0, 2)}) ${whatsapp.slice(2)}`,
      business: 'Salgados da Rita',
      segment: 'salgados',
      message: 'quero vender pelo WhatsApp',
    });
    expect(r.status).toBe(202);
    const [lead] = await leads();
    expect(lead).toMatchObject({ name: 'Rita', business_name: 'Salgados da Rita', source: 'site' });
    const ev = await sql`
      select data from staff_events where kind = 'lead.created' and data->>'leadId' = ${lead!.id}
    `;
    expect(ev[0]?.data.channel).toBe('site');
    expect((await post({ name: 'Rita', whatsapp })).status).toBe(202);
    expect(await leads()).toHaveLength(1);
    const notes = await sql`select body from lead_activities where lead_id = ${lead!.id}`;
    expect(notes.filter((n) => String(n.body).startsWith('Pediu contato pelo site'))).toHaveLength(
      2,
    );
  });
});
