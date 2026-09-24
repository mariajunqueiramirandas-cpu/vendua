/**
 * Baseline measurement for the agent harness — renders the real request
 * each run kind sends (system prompt + tool schemas + context) and reports
 * char/token sizes per section. Optionally hits Gemini's countTokens API
 * for exact counts when GEMINI_API_KEY is set.
 */
import { buildSystemPrompt } from './src/agent/prompts.ts';
import { toolsFor } from './src/agent/tools.ts';
import { DEFAULT_PITCH } from './src/modules/integrations.ts';

const KINDS = ['triage', 'reply', 'outreach', 'discovery', 'strategist'] as const;

const pitch = { ...DEFAULT_PITCH, offer: 'Teste grátis 14 dias — vendua.com.br/cadastro' };
const memory = {
  facts: [
    'run docerias fortaleza/fortaleza: 4 leads (3 c/ whatsapp); canais via maps_lookup+instagram_profile; beco sem saída: Doce Vila, Torta Café; monid $0.031',
    'docerias respondem melhor à noite; instagram-first quase sempre tem wa.me no link-in-bio',
  ],
};
const bookingUrl = 'https://crm.example.com/agendar?t=vbt.abc123.def456';

for (const kind of KINDS) {
  const system = buildSystemPrompt(kind, pitch, memory, {
    goal: 'meeting',
    bookingUrl,
    autoContact: { enabled: true, minScore: 8 },
  });
  const tools = toolsFor(kind);
  const toolsJson = JSON.stringify(
    tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
  );
  const perTool = tools.map(
    (t) =>
      `    ${t.name}: ${JSON.stringify({ description: t.description, parameters: t.parameters }).length} chars`,
  );
  console.log(`\n=== ${kind} ===`);
  console.log(`  system_prompt: ${system.length} chars (~${Math.ceil(system.length / 3.5)} tok)`);
  console.log(
    `  tool defs total: ${toolsJson.length} chars (~${Math.ceil(toolsJson.length / 3.5)} tok), ${tools.length} tools`,
  );
  for (const l of perTool) console.log(l);
  console.log(`  STATIC PREFIX total: ${system.length + toolsJson.length} chars`);
}

// Sample context blocks (lead-bound kinds) — sizes from real shapes.
const leadRow = {
  id: '5c5f1c9c-0000-4000-8000-000000000000',
  name: 'Doceria Aurora',
  business_name: 'Doceria Aurora',
  phone: '+5585999990001',
  whatsapp: '+5585999990001',
  whatsapp_verified: true,
  email: null,
  instagram: '@doceria.aurora',
  website: 'https://ateliedocelar.example.br',
  city: 'Fortaleza',
  segment: 'doceria',
  source: 'discovery',
  tags: ['descoberto'],
  state: 'contacted',
  score: 7,
  fit_score: 8,
  fit_reason: 'doceria de bairro com ig ativo',
  intent_score: 6,
  intent_reason: 'vende só pelo zap',
  agent_goal: 'meeting',
  agent_mode: 'auto',
  agent_plan: [
    { step: 'contexto', status: 'done', note: 'doceria de bairro' },
    { step: 'qualificação', status: 'todo', note: null },
    { step: 'valor', status: 'todo', note: null },
    { step: 'commit: meeting', status: 'todo', note: null },
  ],
  next_action_at: '2026-09-25T14:00:00Z',
  deal_value_cents: 0,
  notes_count: 3,
  created_at: '2026-09-20T00:00:00Z',
  updated_at: '2026-09-24T00:00:00Z',
};
const thread = {
  thread: { id: 't-1', lead_id: leadRow.id, channel: 'whatsapp', agent_enabled: true },
  messages: Array.from({ length: 6 }, (_, i) => ({
    direction: i % 2 ? 'in' : 'out',
    body: 'mensagem de exemplo da conversa com o lead sobre a loja online '.repeat(2),
    status: 'sent',
    author: i % 2 ? 'lead' : 'agent',
    created_at: '2026-09-24T01:00:00Z',
  })),
};
const ctx = [
  `LEAD: ${JSON.stringify(leadRow)}`,
  `GOAL: meeting`,
  `PLANO: ${JSON.stringify(leadRow.agent_plan)}`,
  `DOSSIÊ (notes + research, newest first):\n- brigaderia artesanal, Meireles; vende por instagram + zap; sem site próprio; pedidos por dm\n- dona: Juliana; ~2k seguidores; link-in-bio com wa.me`,
  `BOOKING_URL: ${bookingUrl}`,
  `CANAIS: whatsapp ok · email indisponível (sem e-mail no cadastro)`,
  `THREAD: ${JSON.stringify(thread)}`,
].join('\n\n');
console.log(`\n=== context sample (reply/triage lead-bound) ===`);
console.log(`  context: ${ctx.length} chars (~${Math.ceil(ctx.length / 3.5)} tok)`);

// Tool-output size audit — worst-case shapes from tools.ts.
const bigPage = {
  url: 'https://prospect.example.br',
  title: 'Doceria X — Fortaleza',
  description: 'doceria',
  text: 'A'.repeat(30000), // TinyFish markdown — unbounded today
  nav: ['https://prospect.example.br/contato'],
  foundContacts: {
    phones: ['+5585999990001'],
    whatsappLinks: [],
    emails: [],
    instagram: [],
    facebook: [],
    tiktok: [],
    phoneHints: [],
  },
};
const readPagesOut = JSON.stringify({ pages: Array.from({ length: 6 }, () => bigPage) });
console.log(
  `  read_pages 6-url worst case: ${readPagesOut.length} chars (~${Math.ceil(readPagesOut.length / 3.5)} tok) — resends EVERY later turn`,
);

// Gemini countTokens exactness pass (optional).
const key = process.env.GEMINI_API_KEY;
if (key) {
  const model = 'gemini-3.5-flash-lite';
  for (const kind of KINDS) {
    const system = buildSystemPrompt(kind, pitch, memory, {
      goal: 'meeting',
      bookingUrl,
      autoContact: { enabled: true, minScore: 8 },
    });
    const tools = toolsFor(kind);
    const body = {
      generateContentRequest: {
        model: `models/${model}`,
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: ctx }] }],
        tools: [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        ],
      },
    };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      },
    );
    const data = (await res.json()) as { totalTokens?: number; error?: { message?: string } };
    console.log(
      `  ${kind}: countTokens(system+tools+ctx) = ${data.totalTokens ?? data.error?.message ?? '?'}`,
    );
  }
  // system-only and tools-only splits for the reply kind
  for (const part of ['system', 'tools'] as const) {
    const kind = 'reply' as const;
    const system = buildSystemPrompt(kind, pitch, memory, {
      goal: 'meeting',
      bookingUrl,
      autoContact: { enabled: true, minScore: 8 },
    });
    const tools = toolsFor(kind);
    const body =
      part === 'system'
        ? { contents: [{ role: 'user', parts: [{ text: system }] }] }
        : {
            generateContentRequest: {
              model: `models/${model}`,
              contents: [{ role: 'user', parts: [{ text: 'x' }] }],
              tools: [
                {
                  functionDeclarations: tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                  })),
                },
              ],
            },
          };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      },
    );
    const data = (await res.json()) as { totalTokens?: number };
    console.log(`  reply ${part} alone = ${data.totalTokens}`);
  }
}
