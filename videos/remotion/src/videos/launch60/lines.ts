// The narration, line by line: `say` goes to the TTS model (audio tags and pronunciation
// spellings included), `text` is the caption. Generated with scripts/voice.mjs; the voice sets the
// pace, so timeline.ts sizes each scene to its take. No imports: Node loads this file directly.
//
// Voice (2026-10-23): ElevenLabs Eleven v4 through OpenRouter, the premade "eric", with a
// [Brazilian Portuguese accent] tag. Ranked first of 12 premade voices for a native pt-BR read
// and "ven-du-Á"; the tag removed most English-like r and aspirated p/t. After "entra no ar o"
// the model says "Van-duá" for `Vendu-á` in every take; `Ven-du-á` comes out right there.

const BR = '[Brazilian Portuguese accent]';

export const VOICE = {
  model: 'elevenlabs/eleven-v4',
  voice: 'eric',
  language: 'pt',
  seed: 4110,
  options: {},
};

export const LINES = [
  { id: 'hook', say: `[excited]${BR} Para de perder pedido no WhatsApp!`, text: 'Para de perder pedido no WhatsApp!' },
  {
    id: 'pain',
    say: `${BR} Cliente esperando, pedido no caderno, Pix conferido no print...`,
    text: 'Cliente esperando, pedido no caderno, Pix conferido no print…',
  },
  { id: 'launch', say: `[excited]${BR} Neste sábado, entra no ar o Ven-du-á!`, text: 'Neste sábado, entra no ar o Venduá!' },
  {
    id: 'who',
    say: `${BR} Pra doceiras, marmitarias, hamburguerias e padarias:`,
    text: 'Pra doceiras, marmitarias, hamburguerias e padarias:',
  },
  {
    id: 'what',
    say: `${BR} Sua loja online com a sua cara, e um app no celular pra tocar o dia.`,
    text: 'Sua loja online com a sua cara, e um app no celular pra tocar o dia.',
  },
  {
    id: 'shop',
    say: `${BR} O cliente escolhe, monta o pedido e paga no Pix, sem criar conta.`,
    text: 'O cliente escolhe, monta o pedido e paga no Pix, sem criar conta.',
  },
  {
    id: 'order',
    say: `[excited]${BR} E o pedido cai prontinho no seu celular. Um toque, e tá aceito!`,
    text: 'E o pedido cai prontinho no seu celular. Um toque, e tá aceito!',
  },
  {
    id: 'dua',
    say: `${BR} No WhatsApp, quem atende é o Duá, o vendedor com inteligência artificial: tira dúvida, monta o pedido e manda o Pix.`,
    text: 'No WhatsApp, quem atende é o Duá, o vendedor com inteligência artificial: tira dúvida, monta o pedido e manda o Pix.',
  },
  {
    id: 'day',
    say: `${BR} No fim do dia, você vê quanto vendeu e o que mais saiu.`,
    text: 'No fim do dia, você vê quanto vendeu e o que mais saiu.',
  },
  {
    id: 'setup',
    say: `${BR} Pra começar, é só responder umas perguntas: em cerca de uma hora, a sua loja tá no ar.`,
    text: 'Pra começar, é só responder umas perguntas: em cerca de uma hora, a sua loja tá no ar.',
  },
  {
    id: 'price',
    say: `${BR} Nenhuma taxa da Ven-du-á por pedido. Planos a partir de sessenta e nove e noventa por mês.`,
    text: 'Nenhuma taxa da Venduá por pedido. Planos a partir de R$ 69,90 por mês.',
  },
  {
    id: 'cta',
    say: `[excited]${BR} Sábado, começa com catorze dias grátis, sem cartão. Link na bio!`,
    text: 'Sábado, começa com 14 dias grátis, sem cartão. Link na bio!',
  },
];
