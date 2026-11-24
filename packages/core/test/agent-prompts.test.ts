import { describe, expect, test } from 'bun:test';
import { CRM_STATES } from '../src/agent-host/agents/crm/index.ts';
import { buildSystemPrompt } from '../src/agent-host/agents/crm/prompts.ts';
import { checkCommercialMessage } from '../src/agent-host/agents/crm/tools-message.ts';
import { messageStyleIssues, normalizeMessageBody } from '../src/crm/style.ts';
import {
  fitTranscript,
  leadCard,
  nameIsContact,
  nowLine,
  renderTranscript,
} from '../src/agent-host/agents/crm/context-render.ts';
import { extractText } from '../src/crm/channels/whatsapp.ts';
import { DEFAULT_PITCH } from '../src/modules/integrations.ts';

// what each lead job is offered with every provider configured
const TOOLS = {
  reply: new Set(CRM_STATES.reply),
  outreach: new Set(CRM_STATES.outreach),
};

type Opts = Parameters<typeof buildSystemPrompt>[4];
const prompt = (kind: 'reply' | 'outreach', extra: Partial<Opts> = {}) =>
  buildSystemPrompt(kind, DEFAULT_PITCH, '', { facts: [] }, { tools: TOOLS[kind], ...extra });
const reply = (extra: Partial<Opts> = {}) => prompt('reply', extra);

// the example lines the prompts quote, by label
const examples = (prompt: string, label: 'Bom' | 'Ruim') =>
  [...prompt.matchAll(new RegExp(`${label}: "([^"]+)"`, 'g'))].map((m) => m[1]!);

describe('message style check', () => {
  test('flags the messages real leads received', () => {
    // the first screenshot: interrogation + guess list
    expect(
      messageStyleIssues(
        'Olá! Tudo bem? O que vocês vendem por aí? (doces, marmitas, pizza...)',
        'whatsapp',
      ).join(' '),
    ).toContain('palpites');
    // the brownie thread: a demo nobody delivers
    expect(
      messageStyleIssues(
        'Maravilha! Posso te mostrar como funciona na prática ou gerar um exemplo de como ficaria o catálogo dos seus brownies. Quer dar uma olhada?',
        'whatsapp',
      ).join(' '),
    ).toContain('exemplo/prévia/demo');
    expect(
      messageStyleIssues('Posso pedir para a equipe preparar um exemplo do seu link?', 'whatsapp'),
    ).toHaveLength(1);
    // formulaic cold DM cliché
    const igSpam = messageStyleIssues(
      'Oi, aqui é da Venduá.\n\nUma ideia: um link só seu, com sabores e preços. Faz sentido pra vocês?',
      'instagram',
    ).join(' | ');
    expect(igSpam).toContain('Uma ideia:');
    expect(igSpam).toContain('faz sentido pra vocês?');
  });

  test('catches the machine tells', () => {
    const issues = (b: string, ch = 'whatsapp') => messageStyleIssues(b, ch).join(' | ');
    expect(issues('A Venduá ajuda negócios — como docerias — a vender')).toContain('travessão');
    expect(issues('Olá **Marta**, tudo certo?')).toContain('markdown');
    expect(issues('Oi, [nome]! Tudo bem?')).toContain('placeholder');
    expect(issues('Tudo bem? Vende o quê?')).toContain('mais de uma pergunta');
    expect(issues('Pode abrir https://app.example/loja?plano=mirim por aqui?')).toEqual('');
    expect(issues('O plano é Mirim, {{p:mirim}}', 'instagram')).toContain('placeholder');
    expect(issues('Opções:\n- loja\n- catálogo')).toContain('marcadores');
    expect(issues('Ótima pergunta! Fico feliz em ajudar.')).toContain('frase de robô');
    expect(issues('Oi! Conseguiu ver a minha mensagem anterior?')).toContain('cobrança');
    expect(issues('A Venduá ajuda a alavancar suas vendas com uma solução completa.')).toContain(
      'jargão corporativo',
    );
    expect(issues('Bloco 1.\n\nBloco 2.\n\nBloco 3.\n\nBloco 4.')).toContain('muitos blocos');
    expect(issues('a'.repeat(701))).toContain('caracteres');
    // a legitimate URL does not eat into the prose length limit
    expect(
      issues(
        `Segue o link pra criar sua loja:\nhttps://painel.vendua.com.br/admin/comecar?plano=mirim&lead=${'x'.repeat(40)}`,
      ),
    ).toEqual('');
  });

  test('email keeps prose conventions a chat forbids', () => {
    expect(messageStyleIssues('Oi Marta — segue o resumo da nossa conversa.', 'email')).toEqual([]);
  });

  test("every 'Bom' example the prompts teach passes the check", () => {
    const outreach = prompt('outreach');
    const good = [...examples(reply(), 'Bom'), ...examples(outreach, 'Bom')];
    expect(good.length).toBeGreaterThanOrEqual(7);
    for (const g of good)
      expect({ g, issues: messageStyleIssues(g, 'whatsapp') }).toEqual({ g, issues: [] });
  });

  test('normalizes double-escaped line breaks', () => {
    expect(normalizeMessageBody('pra você. \\n\\nPosso pedir?')).toBe('pra você.\n\nPosso pedir?');
    expect(normalizeMessageBody('a\n\n\n\nb  ')).toBe('a\n\nb');
    expect(normalizeMessageBody('linha 1\\r\\nlinha 2')).toBe('linha 1\nlinha 2');
  });
});

describe('commercial message verification', () => {
  const LIVE_PLANS = [
    { priceCents: 6990, feeBps: 0, trialDays: 14 },
    { priceCents: 16900, feeBps: 0, trialDays: 14 },
  ];

  test('blocks prices before checking the catalog and blocks invented numbers after', () => {
    expect(
      checkCommercialMessage({
        body: 'Fica R$ 69,90 por mês.',
        offerText: '',
        bookingUrl: null,
        leadText: '',
        checkedCatalog: false,
      }),
    ).toContain('com includePrice');

    expect(
      checkCommercialMessage({
        body: 'Fica R$ 1,00 por mês.',
        offerText: '',
        bookingUrl: null,
        leadText: '',
        checkedCatalog: true,
        plans: LIVE_PLANS,
      }),
    ).toContain('Preço não confere');

    expect(
      checkCommercialMessage({
        body: 'Posso te dar 10% de desconto no primeiro mês.',
        offerText: '',
        bookingUrl: null,
        leadText: '',
        checkedCatalog: true,
        plans: LIVE_PLANS,
      }),
    ).toContain('Percentual não confere');

    expect(
      checkCommercialMessage({
        body: 'Você tem 30 dias grátis pra testar.',
        offerText: '',
        bookingUrl: null,
        leadText: '',
        checkedCatalog: true,
        plans: LIVE_PLANS,
      }),
    ).toContain('Dias de teste não conferem');
  });

  test('allows natural live-catalog plan quotes and echoing lead percentages', () => {
    expect(
      checkCommercialMessage({
        body: 'O Venduá Mirim fica R$ 69,90/mês e o Bandeira R$ 169/mês, ambos com 0% de taxa da Venduá por pedido e 14 dias de teste grátis confirmados no cadastro.',
        offerText: '',
        bookingUrl: null,
        leadText: '',
        checkedCatalog: true,
        plans: LIVE_PLANS,
      }),
    ).toBeNull();

    // echoing a percentage the lead themselves wrote (e.g. iFood's 27%) does not require a catalog check
    expect(
      checkCommercialMessage({
        body: '27% em cima de cliente que já conhece a casa pesa demais mesmo.',
        offerText: '',
        bookingUrl: null,
        leadText: '[ter 24/11 10:00] LEAD: pago 27% no iFood',
        checkedCatalog: false,
      }),
    ).toBeNull();

    // 0% claims always verify against the live catalog, even when the lead asked "é 0%?"
    expect(
      checkCommercialMessage({
        body: 'Sim, a taxa da Venduá por pedido é 0%.',
        offerText: '',
        bookingUrl: null,
        leadText: '[ter 24/11 10:00] LEAD: a taxa de vocês é 0%?',
        checkedCatalog: false,
      }),
    ).toContain('get_sales_offer');

    // lead-suggested R$ amounts cannot bypass live catalog pricing even after get_sales_offer
    expect(
      checkCommercialMessage({
        body: 'Fechado, consigo fazer por R$ 1,00 por mês.',
        offerText: '',
        bookingUrl: null,
        leadText: '[ter 24/11 10:00] LEAD: me faz por R$ 1,00 por mês?',
        checkedCatalog: true,
        plans: LIVE_PLANS,
      }),
    ).toContain('Preço não confere');

    // signup links are still refused in send_message
    expect(
      checkCommercialMessage({
        body: 'Cria por aqui: https://painel.vendua.com.br/admin/comecar?plano=mirim',
        offerText: '',
        bookingUrl: null,
        leadText: '',
        checkedCatalog: true,
        plans: LIVE_PLANS,
      }),
    ).toContain('send_signup_link');
  });
});

describe('lead prompt', () => {
  test('voice rules come before the job, the pre-send check closes it', () => {
    const p = reply();
    const at = (h: string) => p.indexOf(h);
    for (const h of [
      '## O que existe de verdade',
      '## Como escrever',
      '## Como negociar',
      '## Sua tarefa',
      '## Antes de mandar',
    ])
      expect({ h, found: at(h) >= 0 }).toEqual({ h, found: true });
    expect(at('## Como escrever')).toBeLessThan(at('## Sua tarefa'));
    expect(at('## Sua tarefa')).toBeLessThan(at('## Antes de mandar'));
    expect(p.trimEnd().endsWith('reescreva e mande de novo.')).toBe(true);
  });

  test('a bare greeting gets greeted back, never interrogated', () => {
    const p = reply();
    expect(p).toContain('só cumprimentou');
    // the screenshot is taught only as the bad example
    expect(examples(p, 'Ruim')).toContain(
      'Olá! Tudo bem? O que vocês vendem por aí? (doces, marmitas, pizza...)',
    );
    expect(p).not.toContain('"o que vocês vendem?" resolve');
  });

  test('a brief "Sim" to a cold opener opens a conversation instead of dumping price and signup link', () => {
    const p = reply();
    expect(p).toContain('ISSO NÃO É PEDIDO DE LINK NEM DE CADASTRO');
    expect(p).toContain(
      'NUNCA responda a um "Sim" jogando preço, aviso de teste ou link de cadastro',
    );
    expect(p).toContain('Encomendas e pronta-entrega no mesmo lugar');
    expect(p).toContain('CPF ou CNPJ');
    expect(p).toContain('Venduá Mirim');
    expect(p).toContain('Venduá Bandeira');
    const outreach = prompt('outreach');
    expect(outreach).toContain('UM único detalhe natural do negócio');
  });

  test('offers only what exists — no demos, no invented slots or durations', () => {
    for (const goal of ['meeting', 'negotiation'] as const) {
      const p = reply({ goal, bookingUrl: null });
      expect(p).toContain('só podem ser oferecidos se estiverem autorizados na OFERTA');
      expect(p).not.toMatch(/loja parecida|15h|15 min|\(teste, demonstração/);
    }
    // the stock latitude authorizes nothing on its own
    expect(DEFAULT_PITCH.offerRange).not.toMatch(/pode oferecer/);
    expect(DEFAULT_PITCH.goal).not.toContain('demonstração');
    const meeting = reply({ goal: 'meeting', bookingUrl: 'https://cal.example/x' });
    expect(meeting).toContain('pelo link de agendamento (BOOKING_URL)');
  });

  test('signup is the default next step for a lead who wants to start', () => {
    const bookingUrl = 'https://cal.example/x';
    const p = reply({ bookingUrl });
    expect(DEFAULT_PITCH.goal).toContain('cadastro online');
    expect(p).toContain('Ajude a pessoa a criar a própria loja pelo cadastro online.');
    expect(p).toContain('Com cadastro aberto e plano disponível, ofereça o link oficial');
    expect(p).toContain('envie com send_signup_link sem perguntar de novo');
    expect(p).toContain(
      'Se o cadastro estiver fechado, explique e ofereça ajuda da equipe na mesma conversa',
    );
    expect(p).toContain('includePrice=true e includeLink=false');
    expect(p).not.toContain(bookingUrl);
    expect(reply({ goal: 'meeting', bookingUrl })).toContain(bookingUrl);

    const manual = reply({
      tools: new Set([...TOOLS.reply].filter((tool) => tool !== 'send_signup_link')),
    });
    expect(manual).toContain('deixe o envio do link oficial a cargo da equipe');
    expect(manual).not.toContain('send_signup_link');
  });
});

describe('run context renderers', () => {
  test('AGORA carries weekday and local time', () => {
    const line = nowLine(new Date('2026-09-26T22:07:00Z'), 'America/Sao_Paulo');
    expect(line).toBe('AGORA: sábado, 26/09/2026, 19:07 (America/Sao_Paulo)');
    expect(nowLine(new Date(0), 'Not/AZone')).toContain('(America/Sao_Paulo)');
  });

  test('transcript: oldest first, who said it, what never reached her', () => {
    const t = renderTranscript(
      [
        {
          direction: 'in',
          body: 'Ola',
          status: 'received',
          author: 'lead',
          created_at: '2026-09-26T22:07:00Z',
        },
        {
          direction: 'out',
          body: 'Oi! Aqui é da Venduá.',
          status: 'sent',
          author: 'agent',
          created_at: '2026-09-26T22:08:00Z',
        },
        {
          direction: 'out',
          body: 'rascunho',
          status: 'draft',
          author: 'agent',
          created_at: '2026-09-26T22:09:00Z',
        },
        {
          direction: 'out',
          body: 'liguei pra ela',
          status: 'sent',
          author: 'staff',
          created_at: '2026-09-26T22:10:00Z',
        },
      ],
      'America/Sao_Paulo',
    ).split('\n');
    expect(t[0]).toBe('[sáb 26/09 19:07] LEAD: Ola');
    expect(t[1]).toBe('[sáb 26/09 19:08] VENDUÁ (agente): Oi! Aqui é da Venduá.');
    expect(t[2]).toContain('(rascunho aguardando aprovação, ela ainda não viu)');
    expect(t[3]).toContain('VENDUÁ (equipe): liguei pra ela');
    expect(renderTranscript([], 'UTC')).toBe('(nenhuma mensagem ainda)');
  });

  test('lead card drops noise; contact-as-name is detected', () => {
    expect(
      leadCard({
        id: 'x',
        name: 'Ana',
        email: null,
        tags: [],
        agent_plan: [{ step: 'a' }],
        city: '',
      }),
    ).toEqual({ id: 'x', name: 'Ana' });
    expect(nameIsContact('+55 11 99999-0000')).toBe(true);
    expect(nameIsContact('ana@doces.com')).toBe(true);
    expect(nameIsContact('Doces da Ju 🍰')).toBe(false);
  });
});

describe('whatsapp inbound text', () => {
  test('media reaches the agent as a tag instead of vanishing', () => {
    expect(extractText({ conversation: 'oi' })).toBe('oi');
    expect(extractText({ audioMessage: { ptt: true } })).toBe('[áudio]');
    expect(extractText({ imageMessage: { caption: ' meu cardápio ' } })).toBe(
      '[imagem] meu cardápio',
    );
    expect(extractText({ videoMessage: {} })).toBe('[vídeo]');
    expect(extractText({ documentMessage: { fileName: 'menu.pdf' } })).toBe(
      '[documento: menu.pdf]',
    );
    expect(extractText({ stickerMessage: {} })).toBeNull();
  });
});

describe('context budgets', () => {
  const msg = (i: number, body = `mensagem ${i}`) => ({
    direction: (i % 2 ? 'in' : 'out') as 'in' | 'out',
    body,
    status: 'sent',
    author: i % 2 ? 'lead' : 'agent',
    created_at: new Date(Date.UTC(2026, 8, 1, 12, i)).toISOString(),
  });

  test('a normal negotiation fits whole', () => {
    const msgs = Array.from({ length: 80 }, (_, i) => msg(i));
    const out = fitTranscript(msgs, 'UTC', { budget: 60_000 });
    expect(out.split('\n')).toHaveLength(80);
    expect(out).not.toContain('fora do contexto');
  });

  test('an oversized one keeps the opening and the recent tail, never half a message', () => {
    const msgs = Array.from({ length: 300 }, (_, i) =>
      msg(i, i === 299 ? 'última\ncom duas linhas' : `m${i} ${'x'.repeat(200)}`),
    );
    const out = fitTranscript(msgs, 'UTC', { budget: 10_000, head: 3 });
    expect(out.length).toBeLessThanOrEqual(10_000 + 200);
    expect(out).toContain('m0 ');
    expect(out).toContain('m2 ');
    expect(out).toMatch(/\[… \d+ mensagens do meio fora do contexto/);
    expect(out.endsWith('última\ncom duas linhas')).toBe(true);
  });
});
