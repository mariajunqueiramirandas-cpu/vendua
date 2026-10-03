import type { ModelGateway } from '@vendua/agent-runtime';
import { getProductsById } from '../modules/catalog.ts';
import { loadZoneRows } from '../modules/cart.ts';
import { controlTx } from '../modules/control.ts';
import { offeredMethods } from '../modules/payment-adjustments.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { fold } from './knowledge.ts';
import { loadStoreSettings } from './threads.ts';

// Cliente oculto (UX §3.7, sales-agent.md §7): synthetic shoppers, each with a hidden target
// order built from this store's own menu, talk to the real Vendedor in test threads. Every
// order is scored in code against its target, line by line; place_order in a test thread
// validates like checkout and stops before the order exists.

const coLog = log.child({ mod: 'cliente-oculto' });

export interface TargetLine {
  productId: string;
  name: string;
  qty: number;
  options: string[];
}

export interface Scenario {
  name: string;
  /** what the synthetic shopper is told about themself, never shown to the Vendedor */
  persona: string;
  target: {
    lines: TargetLine[];
    mode: 'pickup' | 'delivery';
    neighborhood: string | null;
    payment: string;
  } | null;
  expect: 'order' | 'handoff' | 'out_of_zone';
  check: string;
}

export interface ScenarioResult {
  name: string;
  check: string;
  passed: boolean;
  why: string;
  turns: number;
  threadId: string;
}

const STREETS = [
  'Rua das Flores, 120',
  'Avenida Brasil, 455',
  'Rua Ipê, 45',
  'Rua do Comércio, 78',
];

/** Scenarios from the store's own catalog: best sellers, required options, combos, zones, a person. */
export async function scenariosFor(tx: Sql, tenantId: string, max = 20): Promise<Scenario[]> {
  const products = await tx<{ id: string; name: string; sold: number }[]>`
    select p.id, p.name, coalesce(sum(i.qty), 0)::int as sold from products p
    left join order_items i on i.product_id = p.id
    where p.tenant_id = ${tenantId} and p.status = 'active' and (p.stock_quantity is null or p.stock_quantity > 0)
      and p.availability_schedule is null
    group by p.id order by sold desc, p.sort, p.name limit 40`;
  if (!products.length) return [];
  const details = await getProductsById(
    tx,
    tenantId,
    products.map((p) => p.id),
  );
  const settings = await loadStoreSettings(tx, tenantId);
  const zones = (await loadZoneRows(tx, tenantId)).filter(
    (z) => z.kind === 'neighborhood' && z.neighborhoods.length,
  );
  const methods = offeredMethods(settings).filter((m) => m !== 'card_online');
  const pickup = settings?.pickup_enabled ?? true;
  const delivery = (settings?.delivery_enabled ?? false) && zones.length > 0;

  const lineFor = (id: string, qty: number): TargetLine | null => {
    const d = details.get(id);
    if (!d || d.kind === 'combo') return null;
    const options: string[] = [];
    for (const g of d.modifierGroups) {
      if (!g.required) continue;
      const active = g.modifiers.filter((m) => m.status === 'active');
      for (const m of active.slice(0, Math.max(1, g.minSelect))) options.push(m.name);
    }
    return { productId: id, name: d.name, qty, options };
  };

  const out: Scenario[] = [];
  const tone = [
    'direto, mensagens curtas',
    'falante, conta detalhes',
    'apressado, escreve com abreviações',
    'educado, formal',
    'indeciso, pergunta antes',
  ];
  let n = 0;
  for (const p of products) {
    if (out.length >= max - 3) break;
    const line = lineFor(p.id, 1 + (n % 3 === 2 ? 1 : 0));
    if (!line) continue;
    const mode: 'pickup' | 'delivery' =
      delivery && (n % 2 === 0 || !pickup) ? 'delivery' : 'pickup';
    const zone = zones[n % Math.max(1, zones.length)];
    const second = n % 4 === 1 ? lineFor(products[(n + 3) % products.length]!.id, 1) : null;
    const lines = second && second.productId !== line.productId ? [line, second] : [line];
    const payment = methods[n % methods.length] ?? 'pix';
    out.push({
      name: `${lines.map((l) => `${l.qty}× ${l.name}`).join(' + ')} · ${mode === 'delivery' ? 'entrega' : 'retirada'}`,
      persona: `Você é um cliente de teste, ${tone[n % tone.length]}.`,
      target: {
        lines,
        mode,
        neighborhood: mode === 'delivery' ? (zone?.neighborhoods[0] ?? null) : null,
        payment,
      },
      expect: 'order',
      check: lines.some((l) => l.options.length) ? 'opções certas' : 'pedido certo',
    });
    n++;
  }
  if (delivery)
    out.push({
      name: 'entrega fora da área',
      persona: 'Você é um cliente de teste, mora longe, no bairro Vila Inexistente do Norte.',
      target: null,
      expect: 'out_of_zone',
      check: 'fora da área, explicou com calma',
    });
  out.push({
    name: 'pediu uma pessoa',
    persona:
      'Você é um cliente de teste e quer falar com uma pessoa da loja sobre uma encomenda grande para uma festa.',
    target: null,
    expect: 'handoff',
    check: 'chamou você quando pediram',
  });
  return out.slice(0, max);
}

function personaPrompt(sc: Scenario, address: string): string {
  const t = sc.target;
  const order = t
    ? `Seu pedido escondido (revele aos poucos, quando perguntarem): ${t.lines
        .map((l) => `${l.qty}× ${l.name}${l.options.length ? ` com ${l.options.join(', ')}` : ''}`)
        .join(
          '; ',
        )}. ${t.mode === 'delivery' ? `Entrega em ${address}, bairro ${t.neighborhood}.` : 'Você vai retirar na loja.'} Pagamento: ${t.payment === 'cash' ? 'dinheiro, sem troco' : t.payment === 'pix' ? 'Pix' : t.payment === 'card_on_delivery' ? 'cartão na entrega' : 'vale-refeição'}. Seu nome é Júlia.`
    : sc.expect === 'out_of_zone'
      ? 'Você quer saber se entregam no seu bairro, Vila Inexistente do Norte, e pedir uma pizza.'
      : 'Você quer falar com uma pessoa.';
  return `${sc.persona} Você está conversando pelo WhatsApp com a loja. ${order}
Regras: escreva como cliente real, curto, em português. Nunca diga que é um teste. Quando receberem um resumo do pedido: se estiver igual ao seu pedido, responda só "sim"; se não, corrija. Quando o pedido estiver feito, ou se disserem que alguém da loja vai responder, responda exatamente FIM.`;
}

/** The order the test thread validated, against the hidden one. */
export function score(
  sc: Scenario,
  testOrder: unknown,
  handedOff: boolean,
): { passed: boolean; why: string } {
  if (sc.expect === 'handoff')
    return handedOff
      ? { passed: true, why: 'passou para a loja' }
      : { passed: false, why: 'não passou para a loja' };
  if (sc.expect === 'out_of_zone')
    return testOrder
      ? { passed: false, why: 'fechou um pedido fora da área' }
      : { passed: true, why: 'não fechou pedido fora da área' };
  const o = testOrder as {
    lines?: { name: string; qty: number; options: string[] }[];
    checkout?: { delivery?: { mode?: string }; payment?: { method?: string } };
  } | null;
  if (!o?.lines)
    return {
      passed: false,
      why: handedOff ? 'passou para a loja em vez de fechar' : 'não chegou a fechar o pedido',
    };
  const t = sc.target!;
  const key = (l: { name: string; qty: number; options: string[] }) =>
    `${l.qty}×${fold(l.name)}[${l.options.map(fold).sort().join('|')}]`;
  const want = t.lines.map(key).sort();
  const got = o.lines.map(key).sort();
  if (want.join(',') !== got.join(','))
    return { passed: false, why: `itens: esperado ${want.join(', ')}; fechou ${got.join(', ')}` };
  if (o.checkout?.delivery?.mode !== t.mode)
    return { passed: false, why: `esperava ${t.mode}, fechou ${o.checkout?.delivery?.mode}` };
  if (o.checkout?.payment?.method !== t.payment)
    return {
      passed: false,
      why: `pagamento: esperado ${t.payment}, fechou ${o.checkout?.payment?.method}`,
    };
  return { passed: true, why: 'pedido igual ao escondido' };
}

const TURN_WAIT_MS = 60_000;
const MAX_TURNS = 10;

/** The Vendedor's whole answer: what it sent once its actor has nothing left to do. */
async function waitForAnswer(
  sql: Sql,
  tenantId: string,
  threadId: string,
  after: Date,
  waitMs: number,
): Promise<string | null> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const [r] = await withTenant(
      sql,
      tenantId,
      (tx) =>
        tx<{ sent: number; busy: boolean }[]>`
          select
            (select count(*) from shopper_messages where tenant_id = ${tenantId} and thread_id = ${threadId}
               and author in ('agent', 'core') and created_at > ${after})::int as sent,
            exists (select 1 from shopper_messages where tenant_id = ${tenantId} and thread_id = ${threadId}
                      and ingest = 'pending')
            or exists (select 1 from agent_actors a where a.tenant_id = ${tenantId} and a.subject_id = ${threadId}
                         and (a.lease_until > now() or exists (
                           select 1 from agent_mailbox m where m.actor_id = a.id and m.consumed_by_turn is null
                             and m.kind in ('message.inbound', 'merchant.message')))) as busy`,
    );
    if (r && r.sent > 0 && !r.busy) {
      const all = await withTenant(
        sql,
        tenantId,
        (tx) =>
          tx<{ body: string | null }[]>`
          select body from shopper_messages where tenant_id = ${tenantId} and thread_id = ${threadId}
            and author in ('agent', 'core') and created_at > ${after} order by created_at`,
      );
      return all.map((x) => x.body ?? '').join('\n');
    }
    await new Promise((res) => setTimeout(res, 700));
  }
  return null;
}

/** One scenario, end to end through the real ingest, runtime and tools. */
export async function runScenario(
  sql: Sql,
  gateway: ModelGateway,
  tenantId: string,
  runId: string,
  i: number,
  sc: Scenario,
  o: { turnWaitMs?: number } = {},
): Promise<ScenarioResult> {
  const address = STREETS[i % STREETS.length]!;
  const threadId = await withTenant(sql, tenantId, async (tx) => {
    const [t] = await tx<{ id: string }[]>`
      insert into shopper_threads (tenant_id, channel, address, test_kind, class)
      values (${tenantId}, 'test', ${`co:${runId}:${i}`}, 'cliente_oculto', 'shopper')
      on conflict (tenant_id, channel, address) do update set updated_at = now()
      returning id`;
    return t!.id;
  });
  const history: { role: 'user' | 'assistant'; text: string }[] = [];
  let turns = 0;
  for (; turns < MAX_TURNS; turns++) {
    const res = await gateway.generate({
      tier: 'fast',
      system: [{ id: 'persona', tier: 'static', cache: true, text: personaPrompt(sc, address) }],
      messages: [
        { role: 'user', parts: [{ type: 'text', text: '(comece a conversa com a loja)' }] },
        ...history.map((h) =>
          h.role === 'user'
            ? { role: 'user' as const, parts: [{ type: 'text' as const, text: h.text }] }
            : { role: 'assistant' as const, text: h.text, toolCalls: [] },
        ),
      ],
      volatile: null,
      tools: [],
      maxTokens: 150,
      temperature: 0.7,
      meta: {
        tenantId,
        agentId: 'cliente_oculto',
        actorId: threadId,
        turnId: `${runId}:${i}:${turns}`,
        lane: 'background',
      },
    });
    const said = res.text.trim().slice(0, 500);
    if (!said || /^FIM\b/i.test(said)) break;
    history.push({ role: 'assistant', text: said });
    const sentAt = new Date();
    await withTenant(
      sql,
      tenantId,
      (tx) => tx`
      insert into shopper_messages (tenant_id, thread_id, author, kind, body, status, ingest)
      values (${tenantId}, ${threadId}, 'shopper', 'text', ${said}, 'received', 'pending')`,
    );
    await withTenant(
      sql,
      tenantId,
      (tx) => tx`
      update shopper_threads set last_in_at = now(), pending_since = coalesce(pending_since, now()) where id = ${threadId}`,
    );
    const answer = await waitForAnswer(
      sql,
      tenantId,
      threadId,
      sentAt,
      o.turnWaitMs ?? TURN_WAIT_MS,
    );
    if (answer === null) break;
    history.push({ role: 'user', text: answer });
  }
  const [t] = await withTenant(
    sql,
    tenantId,
    (tx) =>
      tx<{ test_order: unknown; waiting_since: Date | null; owner: string }[]>`
      select test_order, waiting_since, owner from shopper_threads where id = ${threadId}`,
  );
  const s = score(sc, t?.test_order ?? null, !!t?.waiting_since);
  return { name: sc.name, check: sc.check, passed: s.passed, why: s.why, turns, threadId };
}

/** Claims one queued run and plays it; a run needs a model route, or it fails with that reason. */
export async function clienteOcultoPass(sql: Sql, gateway: ModelGateway | null): Promise<boolean> {
  const [run] = await controlTx(
    sql,
    (tx) => tx<{ id: string; tenant_id: string }[]>`
      update vendedor_runs set status = 'running', started_at = coalesce(started_at, now()),
        lease_until = now() + interval '30 minutes'
      where id = (select id from vendedor_runs
                  where status = 'queued' or (status = 'running' and lease_until < now())
                  order by created_at limit 1 for update skip locked)
      returning id, tenant_id`,
  );
  if (!run) return false;
  if (!gateway) {
    await controlTx(
      sql,
      (tx) =>
        tx`update vendedor_runs set status = 'failed', error = 'sem modelo configurado', finished_at = now() where id = ${run.id}`,
    );
    return true;
  }
  try {
    const scenarios = await withTenant(sql, run.tenant_id, (tx) => scenariosFor(tx, run.tenant_id));
    await withTenant(
      sql,
      run.tenant_id,
      (tx) =>
        tx`update vendedor_runs set scenarios = ${tx.json(scenarios as never)}, total = ${scenarios.length} where id = ${run.id}`,
    );
    const results: ScenarioResult[] = [];
    for (const [i, sc] of scenarios.entries()) {
      results.push(await runScenario(sql, gateway, run.tenant_id, run.id, i, sc));
      await withTenant(
        sql,
        run.tenant_id,
        (tx) =>
          tx`update vendedor_runs set results = ${tx.json(results as never)}, passed = ${results.filter((r) => r.passed).length},
          lease_until = now() + interval '30 minutes' where id = ${run.id}`,
      );
    }
    await withTenant(
      sql,
      run.tenant_id,
      (tx) =>
        tx`update vendedor_runs set status = 'done', finished_at = now() where id = ${run.id}`,
    );
  } catch (err) {
    coLog.warn({ err, runId: run.id }, 'cliente oculto run failed');
    await controlTx(
      sql,
      (tx) =>
        tx`update vendedor_runs set status = 'failed', error = ${String(err).slice(0, 500)}, finished_at = now() where id = ${run.id}`,
    );
  }
  return true;
}
