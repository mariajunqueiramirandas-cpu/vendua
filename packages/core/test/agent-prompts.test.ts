import { describe, expect, test } from 'bun:test';
import { buildSystemPrompt } from '../src/agent/prompts.ts';
import { messageStyleIssues, normalizeMessageBody } from '../src/agent/style.ts';
import {
  fitTranscript,
  leadCard,
  nameIsContact,
  nowLine,
  renderTranscript,
} from '../src/agent/context-render.ts';
import { extractText } from '../src/agent/channels/whatsapp.ts';
import { DEFAULT_PITCH } from '../src/modules/integrations.ts';
import { anthropicCostUsd } from '../src/agent/llm.ts';

const reply = (extra: Parameters<typeof buildSystemPrompt>[4] = {}) =>
  buildSystemPrompt('reply', DEFAULT_PITCH, '', { facts: [] }, extra);

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
  });

  test('catches the machine tells', () => {
    const issues = (b: string, ch = 'whatsapp') => messageStyleIssues(b, ch).join(' | ');
    expect(issues('A Venduá ajuda negócios — como docerias — a vender')).toContain('travessão');
    expect(issues('Olá **Marta**, tudo certo?')).toContain('markdown');
    expect(issues('Oi, [nome]! Tudo bem?')).toContain('placeholder');
    expect(issues('Tudo bem? Vende o quê? Onde fica?')).toContain('3+ perguntas');
    expect(issues('Opções:\n- loja\n- catálogo')).toContain('marcadores');
    expect(issues('Ótima pergunta! Fico feliz em ajudar.')).toContain('frase de robô');
    expect(issues('a'.repeat(701))).toContain('caracteres');
  });

  test('email keeps prose conventions a chat forbids', () => {
    expect(messageStyleIssues('Oi Marta — segue o resumo da nossa conversa.', 'email')).toEqual([]);
  });

  test("every 'Bom' example the prompts teach passes the check", () => {
    const outreach = buildSystemPrompt('outreach', DEFAULT_PITCH, '', { facts: [] });
    const good = [...examples(reply(), 'Bom'), ...examples(outreach, 'Bom')];
    expect(good.length).toBeGreaterThanOrEqual(4);
    for (const g of good)
      expect({ g, issues: messageStyleIssues(g, 'whatsapp') }).toEqual({ g, issues: [] });
  });

  test('normalizes double-escaped line breaks', () => {
    expect(normalizeMessageBody('pra você. \\n\\nPosso pedir?')).toBe('pra você.\n\nPosso pedir?');
    expect(normalizeMessageBody('a\n\n\n\nb  ')).toBe('a\n\nb');
    expect(normalizeMessageBody('linha 1\\r\\nlinha 2')).toBe('linha 1\nlinha 2');
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

  test('offers only what exists — no demos, no invented slots or durations', () => {
    for (const goal of ['meeting', 'negotiation'] as const) {
      const p = reply({ goal, bookingUrl: null });
      expect(p).toContain('Você NÃO consegue criar, gerar, montar ou mandar nada');
      expect(p).not.toMatch(/loja parecida|15h|15 min|\(teste, demonstração/);
    }
    // the stock latitude authorizes nothing on its own
    expect(DEFAULT_PITCH.offerRange).not.toMatch(/pode oferecer/);
    expect(DEFAULT_PITCH.goal).not.toContain('demonstração');
    const meeting = reply({ goal: 'meeting', bookingUrl: 'https://cal.example/x' });
    expect(meeting).toContain('pelo link de agendamento (BOOKING_URL)');
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

  test('anthropic cost prices cache reads at a tenth', () => {
    const full = anthropicCostUsd('claude-opus-5', {
      input: 100_000,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
    });
    const cached = anthropicCostUsd('claude-opus-5', {
      input: 0,
      cacheRead: 100_000,
      cacheWrite: 0,
      output: 0,
    });
    expect(full).toBeCloseTo(0.5, 6);
    expect(cached).toBeCloseTo(0.05, 6);
  });
});
