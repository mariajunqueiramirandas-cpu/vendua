import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  createGateway,
  Runtime,
  verify,
  type ModelGateway,
  type ScriptedOutput,
} from '@vendua/agent-runtime';
import { scriptedAdapter } from '@vendua/agent-runtime/testing';
import { createApp } from '../src/app.ts';
import { copilot } from '../src/agent-host/agents/copilot/index.ts';
import { briefText, storeBrief } from '../src/agent-host/agents/copilot/brief.ts';
import { GUIDE } from '../src/agent-host/agents/copilot/guide.ts';
import { hostHooks } from '../src/agent-host/hooks.ts';
import { pgMemory } from '../src/agent-host/store/memory.ts';
import { PgActorStore } from '../src/agent-host/store/pg-store.ts';
import { copilotTransport } from '../src/copilot/view.ts';
import { migrate, withTenant, type Sql } from '../src/platform/db.ts';

// ADR 0034, amended 2026-10-09: Duá always knows the store (the brief in the tenant tier and the
// live line), and loads the rest by topic through the admin's own named routes, as the person.

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ?? OWNER_URL?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');

const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args });
const tools = (...calls: { name: string; args: Record<string, unknown> }[]): ScriptedOutput => ({
  toolCalls: calls as NonNullable<ScriptedOutput['toolCalls']>,
});
const reply = (text: string): ScriptedOutput => tools(call('reply', { text }));

describe.skipIf(!OWNER_URL)('Duá Copilot context (db)', () => {
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
  let idem = 0;
  let tenantId = '';
  let owner = '';
  let manager = '';

  const request = async (method: string, path: string, cookie: string, body?: unknown) => {
    const res = await app.request(`http://core.localhost/admin/v1${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        cookie,
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      body: (await res.json()) as any,
      cookie: res.headers.get('set-cookie'),
    };
  };

  async function signIn(phone: string) {
    await request('POST', '/auth/otp/start', '', { phone });
    const r = await request('POST', '/auth/otp/verify', '', { phone, code: codes.get(phone) });
    expect(r.body.signedIn).toBe(true);
    return `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
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

  async function settle(rt: Runtime<Sql>) {
    for (let i = 0; i < 20; i++) {
      await sql`update agent_actors set next_wake_at = null where tenant_id <> ${tenantId} and agent_id = 'copilot'`;
      if ((await rt.pump('interactive', { limit: 10, perTenantCap: 10 })) === 0) break;
    }
  }

  const returned = () =>
    sql<{ name: string; ok: boolean; content: string }[]>`
      select e.payload ->> 'name' as name, (e.payload ->> 'ok')::boolean as ok,
             e.payload ->> 'content' as content
      from agent_events e join agent_actors a on a.id = e.actor_id
      where e.tenant_id = ${tenantId} and a.agent_id = 'copilot' and e.type = 'tool.returned'
        and e.payload ->> 'name' <> 'reply'
      order by e.seq`;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name, plan) values (${`cx-${nonce}`}, 'Quero Pudim', 'pangolim')
      returning id`;
    tenantId = t!.id;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency,
                                  vocabulary, pickup_enabled, delivery_enabled, city, pix_key, pix_key_type, promo, payment_adjustments,
                                  special_days)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 2000, 'BRL', ${sql.json({})}, true, true, 'Niterói', 'pix@quero.test', 'email', ${sql.json({ title: 'Pudim novo' })},
              ${sql.json({ card_on_delivery: { percentBps: 499 } })},
              ${sql.json([{ date: '2099-12-25', closed: true, label: 'Natal' }])})`;
    await sql`
      insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, eta_min_minutes, eta_max_minutes)
      values (${tenantId}, 'Centro', ${sql.json(['Centro', 'Icaraí'])}, 500, 30, 50)`;
    const [c] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, slug, name) values (${tenantId}, 'pudins', 'Pudins') returning id`;
    const [p] = await sql<{ id: string }[]>`
      insert into products (tenant_id, category_id, slug, name, base_price_cents, description, stock_quantity)
      values (${tenantId}, ${c!.id}, 'pudim-de-leite', 'Pudim de Leite', 4500, 'Cremoso, de leite condensado.', 0)
      returning id`;
    const [g] = await sql<{ id: string }[]>`
      insert into modifier_groups (tenant_id, product_id, name, required, min_select, max_select)
      values (${tenantId}, ${p!.id}, 'Tamanho', true, 1, 1) returning id`;
    await sql`
      insert into modifiers (tenant_id, group_id, name, price_delta_cents)
      values (${tenantId}, ${g!.id}, 'Grande', 1500)`;
    const [cart] = await sql<{ id: string }[]>`
      insert into carts (tenant_id, session_hash) values (${tenantId}, ${`cx-${nonce}`}) returning id`;
    await sql`
      insert into orders (tenant_id, cart_id, number, customer, customer_phone, delivery, payment,
                          state, subtotal_cents, total_cents, placed_at)
      values (${tenantId}, ${cart!.id}, 7, ${sql.json({ name: 'Bia Lima', phone: '21999990000' })},
              '21999990000', ${sql.json({ mode: 'pickup' })},
              ${sql.json({ provider: 'sandbox', method: 'pix', status: 'paid' })},
              'placed', 4500, 4500, now())`;
    const ownerPhone = `21${'01'}${stamp}`.slice(0, 11);
    const managerPhone = `21${'02'}${stamp}`.slice(0, 11);
    await sql`
      insert into merchant_users (tenant_id, name, phone, role)
      values (${tenantId}, 'Rita Souza', ${ownerPhone}, 'owner'),
             (${tenantId}, 'Caio Reis', ${managerPhone}, 'manager')`;
    owner = await signIn(ownerPhone);
    manager = await signIn(managerPhone);
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await (appSql as unknown as { end: () => Promise<void> }).end();
    await sql.end();
  });

  test('the brief is always in the prompt, with no amount or time typed in it', async () => {
    const brief = await withTenant(appSql, tenantId, (tx) => storeBrief(tx, tenantId, new Date()));
    expect(brief).not.toBeNull();
    const text = briefText(brief!);
    expect(text).toContain('Loja: Quero Pudim');
    expect(text).toContain('1 produtos em 1 categorias (Pudins); 1 esgotados');
    expect(text).toContain('1 com opções');
    expect(text).toContain('Entrega: sim, 1 áreas ativas');
    expect(text).toContain('Equipe: 1 dono(s), 1 gerente(s), 0 atendente(s)');
    expect(text).not.toContain('Natal');
    // what the grounded guard would block if Duá repeated it
    const findings = verify(text, { ledger: {} } as never, { promises: [] });
    expect(findings).toEqual([]);

    const { rt, adapter } = runtime([reply('Oi, Rita!')]);
    await request('POST', '/copilot/messages', owner, { text: 'oi' });
    await settle(rt);
    const req = adapter.requests[0]!;
    const system = req.system.map((b) => b.text).join('\n');
    expect(system).toContain('FICHA DA LOJA');
    expect(system).toContain('Pagamentos aceitos: Pix');
    expect(system).toContain('load_context');
    expect(system).toContain('Como dono(a), pode ver e pedir tudo');
    expect(req.volatile).toContain(
      'LOJA AGORA: aberta · 1 pedidos esperando aceite · 0 em andamento',
    );
  });

  test('every topic loads through its route as the owner, with figures for money', async () => {
    await request('DELETE', '/copilot', owner);
    const { rt, adapter } = runtime([
      tools(call('load_context', { topics: ['loja', 'entrega', 'pagamentos', 'marketing'] })),
      tools(call('load_context', { topics: ['encomendas', 'vendedor', 'whatsapp', 'equipe'] })),
      tools(call('load_context', { topics: ['atividade', 'pdv', 'impressoras', 'aparencia'] })),
      tools(call('load_context', { topics: ['conta', 'painel'] })),
      tools(call('menu')),
      tools(call('product_details', { product: 'p1' })),
      reply('Pronto.'),
    ]);
    await request('POST', '/copilot/messages', owner, { text: 'me conta tudo da loja' });
    await settle(rt);
    const rows = await returned();
    expect(rows.map((r) => [r.name, r.ok])).toEqual([
      ['load_context', true],
      ['load_context', true],
      ['load_context', true],
      ['load_context', true],
      ['menu', true],
      ['product_details', true],
    ]);
    const all = rows.map((r) => r.content).join('\n');
    // a topic that failed would carry its refusal instead of its content
    expect(all).not.toContain('BLOQUEADO');
    expect(all).not.toContain('A loja recusou');
    expect(all).not.toMatch(/R\$\s*\d/);
    // shopper phones and the Pix key never leave the route
    expect(all).not.toContain('21999990000');
    expect(all).not.toContain('pix@quero.test');
    const [first, second, third, fourth, , product] = rows.map((r) => r.content);
    expect(first).toContain('Horário da semana: {{loja.horario}}');
    expect(first).toContain('Tempo de preparo: {{loja.preparo}}');
    expect(first).toContain('- Centro · bairros Centro, Icaraí · taxa {{area0.taxa}}');
    expect(first).toContain('Pedido mínimo da loja: {{entrega.minimo}}');
    expect(first).toContain('Chave Pix: cadastrada (tipo email');
    expect(first).toContain('Cartão fidelidade: desligado.');
    expect(first).toContain('Aviso no topo da loja: "Pudim novo".');
    // a fee is the screen's, to the hundredth, never rounded
    expect(first).toContain('cartão na entrega {{pag.ajuste0.pct}}');
    expect(JSON.stringify(adapter.requests.at(-1))).toContain('{{pag.ajuste0.pct}} = +4,99%');
    expect(second).toContain('## vendedor');
    expect(second).toContain('- Rita Souza · dono');
    expect(second).toContain('- Caio Reis · gerente');
    expect(third).toContain('Caixa: fechado.');
    expect(third).toContain('## aparencia');
    expect(fourth).toContain('Plano: ');
    expect(fourth).toContain('Pedidos (/pedidos)');
    expect(product).toContain('Pudim de Leite · {{p1.preco}} · esgotado');
    expect(product).toContain('Descrição: Cremoso, de leite condensado.');
    expect(product).toContain('Opção "Tamanho" (obrigatória, escolhe 1 a 1): Grande +{{p1.g0o0}}');
  });

  test('a manager gets the operation, and the owner-only topic refused alone', async () => {
    const { rt, adapter } = runtime([
      tools(call('load_context', { topics: ['conta', 'equipe'] })),
      reply('Isso é com o dono.'),
    ]);
    await request('POST', '/copilot/messages', manager, { text: 'quanto custa o plano?' });
    await settle(rt);
    const system = adapter.requests[0]!.system.map((b) => b.text).join('\n');
    expect(system).toContain('Como gerente');
    const result = JSON.stringify(adapter.requests[1]);
    expect(result).toContain('## conta\\nBLOQUEADO');
    expect(result).toContain('Diga que só o dono pode.');
    expect(result).toContain('- Caio Reis · gerente');
  });

  test('the panel guide covers every Ajuda topic of the admin', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../apps/admin/src/features/help/topics.tsx'),
      'utf8',
    );
    const ids = [.../export type TopicId =([^;]+);/.exec(src)![1]!.matchAll(/'([a-z]+)'/g)].map(
      (m) => m[1]!,
    );
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) expect({ id, has: id in GUIDE }).toEqual({ id, has: true });
    // spelled-out numbers: Duá can repeat the guide without the grounded guard blocking him
    expect(
      verify(Object.values(GUIDE).join('\n'), { ledger: {} } as never, { promises: [] }),
    ).toEqual([]);
  });
});
