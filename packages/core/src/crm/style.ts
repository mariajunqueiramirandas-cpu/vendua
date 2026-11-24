// Pre-send check for the tells that make a message read as a bot. send_message/draft_message
// bounce the first failing body of a run back to the model with these issues; a second
// attempt goes through as written — the check steers, it never strands a reply.

const CHAT_MAX_PROSE_CHARS = 520;
const TEMPLATE =
  /\{\{|\{\s*[a-z]\w*(?:\s*:[\w.-]+)?\s*\}|\[(?:nome|name|empresa|neg[óo]cio|cidade|link)\b[^\]]*\]|<nome>/i;

export const hasUnresolvedTemplate = (body: string, subject?: string | null) =>
  TEMPLATE.test(body) || TEMPLATE.test(subject ?? '');

const ROBOTIC: [RegExp, string][] = [
  [/[óo]tima pergunta/i, '"ótima pergunta"'],
  [/fico (muito )?feliz em (te )?ajudar/i, '"fico feliz em ajudar"'],
  [/espero que (voc[êe] )?(esteja|estejam) bem/i, '"espero que esteja bem"'],
  [/n[ãa]o hesite em/i, '"não hesite em"'],
  [/(estou|estamos|fico|ficamos) [àa] (sua )?disposi[çc][ãa]o/i, '"à disposição"'],
  [/entendo perfeitamente/i, '"entendo perfeitamente"'],
  [/como (um|uma) (modelo de linguagem|ia|intelig[êe]ncia artificial)/i, '"como uma IA"'],
  [/\bfaz sentido (?:pra|para) voc[êe]s?\b/i, '"faz sentido pra vocês?" (clichê de prospecção)'],
  [/^uma ideia:\s/im, '"Uma ideia:" (fórmula pronta de pitch)'],
  [
    /\b(?:conseguiu|chegou a|teve chance de) (?:ver|ler|dar uma olhada na) (?:a )?(?:minha|nossa) mensagem\b/i,
    '"conseguiu ver minha mensagem" (cobrança)',
  ],
  [
    /\b(?:alavancar|potencializar|otimizar|revolucionar) (?:as |os |suas |seus )?(?:vendas|resultados|neg[óo]cio|opera[çc][ãa]o|processos)\b/i,
    'jargão corporativo de vendas',
  ],
  [/\b(?:solu[çc][ãa]o completa|infraestrutura da loja)\b/i, 'expressão corporativa/técnica'],
  [/\b(?:n[ãa]o perca|[úu]ltima chance|vagas limitadas|imperd[íi]vel)\b/i, 'urgência artificial'],
  [/^(?:maravilha|excelente|fant[áa]stico|incr[íi]vel|sensacional)!/i, 'elogio automático de robô'],
];

export function messageStyleIssues(body: string, channel: string | null | undefined): string[] {
  const issues: string[] = [];
  const text = body.trim();
  const chat = channel !== 'email';
  if (hasUnresolvedTemplate(text)) {
    issues.push('placeholder de template no texto. Preencha com o valor confirmado ou retire');
  }
  if (/\*\*[^*]+\*\*|^#{1,6}\s/m.test(text)) {
    issues.push('markdown (** ou #) — o celular mostra os símbolos crus; texto puro');
  }
  if (
    /\b(gerar|preparar|montar|criar|fazer|mandar|enviar)\b[^.?!\n]{0,40}\b(exemplo|pr[ée]via|demo|demonstra[çc][ãa]o|mockup|print|loja de teste)\b/i.test(
      text,
    )
  ) {
    issues.push(
      'oferece exemplo/prévia/demo. Use material autorizado na OFERTA ou explique como funciona a loja',
    );
  }
  for (const [re, label] of ROBOTIC) {
    if (re.test(text)) issues.push(`frase de robô: ${label}`);
  }
  if (chat) {
    if (text.includes('—'))
      issues.push('travessão (—) denuncia texto de máquina — use vírgula ou ponto');
    if ((text.match(/^\s*([-•*]|\d+[.)])\s+/gm) ?? []).length >= 2) {
      issues.push('lista com marcadores — no chat, escreva em frase corrida');
    }
    if (/\([^()]*,[^()]*(\.\.\.|…)\s*\)/.test(text)) {
      issues.push(
        'lista de palpites entre parênteses ("doces, marmitas...") — pergunte aberto, sem chutar',
      );
    }
    const prose = text.replace(/https?:\/\/[^\s<>()]+/gi, '').trim();
    if ((prose.match(/\?/g) ?? []).length > 1) {
      issues.push('mais de uma pergunta. Escolha a que muda o próximo passo');
    }
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length >= 4) {
      issues.push('muitos blocos — no chat, junte em 1 a 3 parágrafos curtos');
    }
    if (prose.length > CHAT_MAX_PROSE_CHARS) {
      issues.push(
        `${prose.length} caracteres — no chat, ≤${CHAT_MAX_PROSE_CHARS} (ideal 1-3 linhas curtas)`,
      );
    }
  }
  return issues;
}

// Models sometimes double-escape line breaks in tool args, and the lead then reads a
// literal "\n\n". Chat apps render real newlines, so turn the escapes back into them.
export function normalizeMessageBody(body: string): string {
  return body
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
