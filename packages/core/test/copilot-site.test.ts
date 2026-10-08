import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  createGateway,
  Runtime,
  type ModelGateway,
  type ScriptedOutput,
} from '@vendua/agent-runtime';
import { scriptedAdapter } from '@vendua/agent-runtime/testing';
import { createApp } from '../src/app.ts';
import { copilot } from '../src/agent-host/agents/copilot/index.ts';
import { hostHooks } from '../src/agent-host/hooks.ts';
import { pgMemory } from '../src/agent-host/store/memory.ts';
import { PgActorStore } from '../src/agent-host/store/pg-store.ts';
import { proposeTx } from '../src/copilot/actions.ts';
import { copilotTransport } from '../src/copilot/view.ts';
import { specLines, validateSpec, type DesignSpec } from '../src/modules/site-builder/spec.ts';
import { migrate, withTenant, type Sql } from '../src/platform/db.ts';

// Duá's site sob medida cards (site.build, site.revise): the brief becomes a DesignSpec card, the
// owner's tap is the one approval and queues the build, the included revision is a card too, and
// a card proposed before the request moved never applies.

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ?? OWNER_URL?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');

const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args });
const tools = (...calls: { name: string; args: Record<string, unknown> }[]): ScriptedOutput => ({
  toolCalls: calls as NonNullable<ScriptedOutput['toolCalls']>,
});
const reply = (text: string): ScriptedOutput => tools(call('reply', { text }));

/** What the model sends: a DesignSpec without its version. */
const SPEC_ARGS = {
  summary: 'Um site doce e acolhedor, com cara de cozinha de vó.',
  brand: {
    personality: ['afetiva', 'artesanal'],
    palette: { primary: '#B5651D', accents: ['#f4e1c1'] },
    typography: 'serifada clássica, títulos grandes',
  },
  experience: {
    mustHave: ['fotos grandes dos pudins'],
    motion: 'subtle',
    avoid: ['cara de fast-food'],
  },
  copy: { tone: 'carinhoso e próximo' },
};
const valid = (args: unknown): DesignSpec => {
  const r = validateSpec({ ...(args as object), version: 1 });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.spec;
};
const SPEC = valid(SPEC_ARGS);
const cardLines = (spec: DesignSpec) =>
  specLines(spec).map((l) => ({ label: l.label, from: null, to: l.to }));

describe.skipIf(!OWNER_URL)('Duá Copilot: site sob medida (db)', () => {
  const sql = postgres(OWNER_URL!, { onnotice: () => {} });
  const appSql = postgres(APP_URL!, { onnotice: () => {} }) as unknown as Sql;
  const codes = new Map<string, string>();
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => {
      codes.set(phone, /(\d{6})/.exec(text)![1]!);
    },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-7);
  const tenants: string[] = [];
  let idem = 0;

  interface Store {
    tenantId: string;
    ownerId: string;
    owner: string;
    requestId: string;
  }

  const request = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://core.localhost/admin/v1${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      cookie: res.headers.get('set-cookie'),
    };
  };

  async function signIn(phone: string) {
    await request('POST', '/auth/otp/start', { phone });
    const r = await request('POST', '/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.body.signedIn).toBe(true);
    return `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
  }

  let phones = 0;
  const phone = () => `22${String(++phones).padStart(2, '0')}${stamp}`.slice(0, 11);

  async function store(): Promise<Store> {
    const slug = `cps-${nonce}-${tenants.length}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name, plan) values (${slug}, 'Quero Pudim', 'pangolim') returning id`;
    const tenantId = t!.id;
    tenants.push(tenantId);
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, pickup_enabled)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, true)`;
    const ownerPhone = phone();
    const [u] = await sql<{ id: string }[]>`
      insert into merchant_users (tenant_id, name, phone, role)
      values (${tenantId}, 'Rita Souza', ${ownerPhone}, 'owner') returning id`;
    const [r] = await sql<{ id: string }[]>`
      insert into site_requests (tenant_id, brief)
      values (${tenantId}, 'Quero um site com cara de casa de vó, tons de caramelo, fotos grandes.')
      returning id`;
    return {
      tenantId,
      ownerId: u!.id,
      owner: await signIn(ownerPhone),
      requestId: r!.id,
    };
  }

  function runtime(script: ScriptedOutput[]) {
    const adapter = scriptedAdapter(script);
    const gateway: ModelGateway = createGateway({
      adapters: [adapter],
      routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
    });
    const rt = new Runtime<Sql>({
      agents: [copilot],
      store: new PgActorStore(appSql),
      gateway,
      transports: [copilotTransport],
      owner: `w-${Math.random()}`,
      memory: pgMemory,
      hooks: hostHooks(),
      clock: { now: () => new Date(Date.now() + 60_000), sleep: async () => {} },
    });
    return { rt, adapter };
  }

  async function settle(rt: Runtime<Sql>, tenantId: string) {
    for (let i = 0; i < 20; i++) {
      await sql`update agent_actors set next_wake_at = null where tenant_id <> ${tenantId} and agent_id = 'copilot'`;
      if ((await rt.pump('interactive', { limit: 10, perTenantCap: 10 })) === 0) break;
    }
  }

  const as = (cookie: string) => (method: string, path: string, body?: unknown) =>
    request(method, path, body, { cookie });

  /** One scripted turn: the tool calls, then a reply. Returns what the model was sent back. */
  async function turn(s: Store, text: string, ...script: ScriptedOutput[]) {
    await as(s.owner)('DELETE', '/copilot');
    const { rt, adapter } = runtime([...script, reply('Preparei. Confere no cartão.')]);
    await as(s.owner)('POST', '/copilot/messages', { text, screen: '/conta' });
    await settle(rt, s.tenantId);
    return { adapter, view: (await as(s.owner)('GET', '/copilot')).body };
  }

  const propose = (s: Store, kind: 'site.build' | 'site.revise', input: unknown) =>
    withTenant(appSql, s.tenantId, (tx) =>
      proposeTx(tx, {
        tenant: { id: s.tenantId, slug: 'x', name: 'Quero Pudim', status: 'active' },
        merchant: {
          userId: s.ownerId,
          sessionId: '',
          name: 'Rita Souza',
          phone: '',
          role: 'owner',
        },
        turnId: `t-${Math.random()}`,
        kind,
        input,
      }),
    );

  /** The tap; the card as stored (the view only lists cards since the first message). */
  const confirm = async (s: Store, id: string) => {
    const r = await as(s.owner)('POST', `/copilot/actions/${id}`, { decision: 'confirm' });
    expect(r.status).toBe(200);
    return (
      await sql<{ status: string; error: string | null; done: string | null }[]>`
        select status, error, done from copilot_actions where id = ${id}`
    )[0]!;
  };

  const siteRequest = async (id: string) =>
    (
      await sql<{ status: string; spec_version: number; revisions_used: number; spec: unknown }[]>`
        select status, spec_version, revisions_used, spec from site_requests where id = ${id}`
    )[0]!;

  const tasks = (requestId: string) =>
    sql<{ kind: string; status: string; source: string; note: string | null }[]>`
      select kind, status, source, note from site_tasks where site_request_id = ${requestId}
      order by created_at`;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  afterAll(async () => {
    for (const t of tenants) await sql`delete from tenants where id = ${t}`;
    await (appSql as unknown as { end: () => Promise<void> }).end();
    await sql.end();
  });

  test('read_site_request gives Duá the brief and the state; managers are told no', async () => {
    const s = await store();
    const { adapter } = await turn(s, 'Como está meu site?', tools(call('read_site_request')));
    const result = JSON.stringify(adapter.requests.at(1));
    expect(result).toContain('casa de vó');
    expect(result).toContain('Spec: ainda não escrito.');
    expect(result).toContain('0 de 1 usado');

    const managerPhone = phone();
    const [m] = await sql<{ id: string }[]>`
      insert into merchant_users (tenant_id, name, phone, role)
      values (${s.tenantId}, 'Caio', ${managerPhone}, 'manager') returning id`;
    const manager: Store = { ...s, ownerId: m!.id, owner: await signIn(managerPhone) };
    const r = await turn(manager, 'Como está o site?', tools(call('read_site_request')));
    expect(JSON.stringify(r.adapter.requests.at(1))).toContain('só o dono da loja');
  });

  test('an invalid spec is a tool error Duá can fix, and nothing is proposed', async () => {
    const s = await store();
    const bad = {
      ...SPEC_ARGS,
      brand: { ...SPEC_ARGS.brand, palette: { primary: 'caramelo', accents: [] } },
    };
    const { adapter, view } = await turn(s, 'Monta o site', tools(call('propose_site_build', bad)));
    const result = JSON.stringify(adapter.requests.at(1));
    expect(result).toContain('O spec não passou na conferência');
    expect(result).toContain('brand.palette.primary must be #rrggbb');
    expect(view.items.filter((i: any) => i.type === 'action')).toHaveLength(0);
    expect(await sql`select 1 from copilot_actions where tenant_id = ${s.tenantId}`).toHaveLength(
      0,
    );
  });

  // ── these replay POST /account/site-request/build|revision (named site.build / site.revise) ──

  test('the build card shows the spec, and confirming it queues the task once', async () => {
    const s = await store();
    const { view } = await turn(s, 'Monta o site', tools(call('propose_site_build', SPEC_ARGS)));
    const card = view.items.find((i: any) => i.type === 'action');
    expect(card).toMatchObject({
      kind: 'site.build',
      title: 'Montar o site sob medida',
      status: 'proposed',
      money: false,
      link: '/conta',
    });
    expect(card.lines).toEqual(cardLines(SPEC));
    // the dry run left nothing behind
    expect((await siteRequest(s.requestId)).status).toBe('requested');
    expect(await tasks(s.requestId)).toHaveLength(0);

    const applied = await confirm(s, card.id);
    expect(applied.status).toBe('applied');
    expect(applied.done).toMatch(
      /^Pronto: o site entra em produção e fica pronto até (hoje|amanhã) às \d{2}:\d{2}\.$/,
    );
    const req = await siteRequest(s.requestId);
    expect(req).toMatchObject({ status: 'in_progress', spec_version: 1, spec: SPEC });
    const ts = await tasks(s.requestId);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ kind: 'generate', status: 'queued', source: 'copilot' });

    // a second tap changes nothing
    await confirm(s, card.id);
    expect(await tasks(s.requestId)).toHaveLength(1);
  });

  test('after delivery, the included revision is a card with what changes', async () => {
    const s = await store();
    await sql`update site_requests set status = 'delivered', spec = ${sql.json(SPEC as never)},
      spec_version = 1 where id = ${s.requestId}`;
    const next = { ...SPEC_ARGS, copy: { tone: 'divertido e leve' } };
    const p = await propose(s, 'site.revise', {
      note: 'Quero os textos mais leves e divertidos.',
      spec: valid(next),
    });
    expect(p.title).toBe('Pedir o ajuste do site');
    expect(p.lines).toEqual([
      { label: 'Ajuste', from: null, to: 'Quero os textos mais leves e divertidos.' },
      { label: 'Tom', from: 'carinhoso e próximo', to: 'divertido e leve' },
    ]);
    const applied = await confirm(s, p.id);
    expect(applied.status).toBe('applied');
    expect(applied.done).toMatch(/^Pronto: o ajuste entra em produção e fica pronto até /);
    expect(await siteRequest(s.requestId)).toMatchObject({
      status: 'in_progress',
      revisions_used: 1,
      spec_version: 2,
    });
    const ts = await tasks(s.requestId);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({
      kind: 'revision',
      note: 'Quero os textos mais leves e divertidos.',
    });
  });

  test('a card proposed before the request changed fails as drifted', async () => {
    const s = await store();
    const p = await propose(s, 'site.build', { spec: SPEC });
    // the request moved on (another spec saved) before the tap
    await sql`update site_requests set spec_version = spec_version + 1 where id = ${s.requestId}`;
    const card = await confirm(s, p.id);
    expect(card.status).toBe('failed');
    expect(card.error).toMatch(/^Isso mudou desde que o Duá preparou o cartão/);
    expect(await tasks(s.requestId)).toHaveLength(0);
    expect((await siteRequest(s.requestId)).status).toBe('requested');
  });
});
