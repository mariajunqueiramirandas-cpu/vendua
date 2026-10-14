// Pre-send check for the tells that make a message read as a bot. send_message/draft_message
// bounce the first failing body of a run back to the model with these issues; a second
// attempt goes through as written — the check steers, it never strands a reply.

const CHAT_MAX_CHARS = 700;

const ROBOTIC: [RegExp, string][] = [
  [/[óo]tima pergunta/i, '"ótima pergunta"'],
  [/fico (muito )?feliz em (te )?ajudar/i, '"fico feliz em ajudar"'],
  [/espero que (voc[êe] )?(esteja|estejam) bem/i, '"espero que esteja bem"'],
  [/n[ãa]o hesite em/i, '"não hesite em"'],
  [/(estou|estamos|fico|ficamos) [àa] (sua )?disposi[çc][ãa]o/i, '"à disposição"'],
  [/entendo perfeitamente/i, '"entendo perfeitamente"'],
  [/como (um|uma) (modelo de linguagem|ia|intelig[êe]ncia artificial)/i, '"como uma IA"'],
];

export function messageStyleIssues(body: string, channel: string | null | undefined): string[] {
  const issues: string[] = [];
  const text = body.trim();
  const chat = channel !== 'email';
  if (
    /\[(nome|name|empresa|neg[óo]cio|cidade|link)[^\]]*\]|\{\{?\s*\w+\s*\}?\}|<nome>/i.test(text)
  ) {
    issues.push('placeholder de template no texto ([nome], {{x}}) — escreva o valor real ou tire');
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
      'oferece exemplo/prévia/demo, que ninguém vai entregar — ofereça só o passo real (conversa com a equipe, o que a OFERTA diz); se a OFERTA tem isso, mande de novo',
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
    if ((text.match(/\?/g) ?? []).length >= 3) {
      issues.push('3+ perguntas — mande uma só; ela responde uma e as outras morrem');
    }
    if (text.length > CHAT_MAX_CHARS) {
      issues.push(`${text.length} caracteres — no chat, ≤${CHAT_MAX_CHARS} (ideal 1-3 linhas)`);
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
