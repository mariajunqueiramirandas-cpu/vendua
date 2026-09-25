// Fills a local Core with enough CRM volume to judge density and phone layouts.
//   bun scripts/dev-seed.ts
// Env: API (http://localhost:8787/control/v1), CONTROL_KEY (dev), WEBHOOK_KEY (devhook — Core's VENDUA_WEBHOOK_SECRET)
// Idempotent-ish: skips when ≥ 30 leads already exist.
export {};

const API = process.env.API ?? 'http://localhost:8787/control/v1';
const KEY = process.env.CONTROL_KEY ?? 'dev';
const HOOK = process.env.WEBHOOK_KEY ?? 'devhook';

let cookie = '';
async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-vendua-staff': '1',
      'idempotency-key': crypto.randomUUID(),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

await call('POST', '/login', { key: KEY });
const existing = await call<{ leads: unknown[] }>('GET', '/leads?limit=100');
if (existing.leads.length >= 30) {
  console.log(`already ${existing.leads.length} leads — skipping`);
  process.exit(0);
}

const FIRST = [
  'Ana',
  'Bruna',
  'Carla',
  'Diego',
  'Eduarda',
  'Fábio',
  'Gabriela',
  'Heitor',
  'Isabela',
  'João',
  'Larissa',
  'Marcos',
  'Natália',
  'Otávio',
  'Paula',
  'Rafael',
  'Sofia',
  'Tiago',
  'Vitória',
  'Wagner',
];
const LAST = [
  'Souza',
  'Lima',
  'Carvalho',
  'Oliveira',
  'Pereira',
  'Almeida',
  'Ribeiro',
  'Martins',
  'Rocha',
  'Barbosa',
];
const BIZ = [
  'Doces da',
  'Pudins',
  'Cantina',
  'Empório',
  'Bolos',
  'Marmitas',
  'Café',
  'Padaria',
  'Confeitaria',
  'Sabores',
];
const SEG = ['doceria', 'confeitaria', 'marmitaria', 'cafeteria', 'padaria', 'hamburgueria'];
const CITY = [
  'Fortaleza',
  'Recife',
  'São Paulo',
  'Salvador',
  'Belo Horizonte',
  'Curitiba',
  'Natal',
];
const SRC = ['instagram', 'indicação', 'descoberta', 'site', 'evento'];
const STATES = ['lead', 'lead', 'lead', 'contacted', 'contacted', 'invited', 'live'];
const INBOUND = [
  'Oi! Vi o perfil de vocês, como funciona a loja online?',
  'Quanto custa por mês? Tenho uma confeitaria pequena.',
  'Pode me mandar um exemplo de loja pronta?',
  'Consigo receber por pix direto?',
  'Tenho interesse, mas só consigo conversar semana que vem.',
];
const DRAFTS = [
  'Oi {n}! Claro — a loja fica pronta em 48h e você recebe por pix. Posso te mostrar um exemplo?',
  'Olá {n}, obrigado pelo retorno! Separei um exemplo de loja de doceria pra você ver.',
  'Oi {n}, tudo bem? Que tal uma call de 15 min na quinta pra te mostrar como funciona?',
];
const pick = <T>(a: readonly T[], i: number) => a[i % a.length]!;

let n = 0;
for (let i = 0; i < 40; i++) {
  const name = `${pick(FIRST, i)} ${pick(LAST, i * 3 + 1)}`;
  const seg = pick(SEG, i * 5 + 2);
  const state = pick(STATES, i * 3);
  const phone = `+5585${String(900000000 + i * 7919).slice(0, 9)}`;
  const { lead } = await call<{ lead: { id: string; name: string } }>('POST', '/leads', {
    name,
    businessName: `${pick(BIZ, i * 7)} ${pick(FIRST, i + 3)}`,
    segment: seg,
    city: pick(CITY, i * 2),
    source: pick(SRC, i),
    ...(i % 4 !== 3 ? { whatsapp: phone } : {}),
    ...(i % 3 === 0 ? { email: `${name.split(' ')[0]!.toLowerCase()}${i}@exemplo.com.br` } : {}),
    ...(i % 5 === 0 ? { instagram: `@${seg}${i}` } : {}),
    ...(i % 2 === 0 ? { dealValueCents: 49000 + (i % 6) * 30000 } : {}),
    tags: i % 3 === 0 ? ['quente'] : i % 7 === 0 ? ['retornar', 'evento'] : [],
    agentMode: i % 4 === 0 ? 'draft' : i % 4 === 1 ? 'auto' : 'off',
    automation: false,
  });
  if (state !== 'lead') await call('PATCH', `/leads/${lead.id}`, { state });

  if (i % 4 !== 3 && i < 24) {
    await call(
      'POST',
      '/webhooks/whatsapp',
      { messageId: `seed-${lead.id}`, from: phone, fromName: name, text: pick(INBOUND, i) },
      { 'x-vendua-webhook': HOOK },
    );
    if (i % 3 === 0) {
      const { threads } = await call<{ threads: { id: string; channel: string }[] }>(
        'GET',
        `/leads/${lead.id}/threads`,
      );
      const t = threads.find((x) => x.channel === 'whatsapp');
      if (t)
        await call('POST', `/threads/${t.id}/messages`, {
          body: pick(DRAFTS, i).replace('{n}', name.split(' ')[0]!),
          send: false,
        });
    }
  }
  if (i % 5 === 1) {
    const due = new Date(Date.now() + (i % 3 === 0 ? -1 : 1) * 86_400_000 * ((i % 4) + 1));
    await call('POST', `/leads/${lead.id}/tasks`, {
      title: pick(
        ['ligar para confirmar', 'mandar proposta', 'enviar exemplo de loja', 'follow-up pós call'],
        i,
      ),
      dueAt: due.toISOString(),
    });
  }
  if (i % 9 === 2) {
    const start = new Date();
    start.setDate(start.getDate() + (i % 5));
    start.setHours(10 + (i % 6), 0, 0, 0);
    await call('POST', '/meetings', { leadId: lead.id, start: start.toISOString(), name }).catch(
      (e) => console.log(`  meeting skipped: ${String(e).slice(0, 120)}`),
    );
  }
  n++;
}
console.log(`seeded ${n} leads`);
