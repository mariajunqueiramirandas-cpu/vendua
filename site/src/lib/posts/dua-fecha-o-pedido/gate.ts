// What counts as the shopper's "sim" to the latest summary: a port of readAnswer in
// packages/core/src/vendedor/gate.ts, with the same lists and the same order of checks. The only
// addition is `why`, the reason the widget prints under each reply.

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[!.,;:?…]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A plain yes: what an unusual order needs whatever else was said. */
const PLAIN = new Set(['sim', 's', 'ss', 'sim sim', 'confirmo', 'confirmado', 'pode', 'pode sim']);

const YES = new Set([
  ...PLAIN,
  'isso',
  'isso mesmo',
  'isso ai',
  'manda',
  'pode mandar',
  'manda ver',
  'manda bala',
  'fechado',
  'fecha',
  'pode fechar',
  'fechou',
  'confirma',
  'pode confirmar',
  'ok',
  'okay',
  'okk',
  'beleza',
  'blz',
  'perfeito',
  'certo',
  'ta certo',
  'esta certo',
  'ta otimo',
  'ta bom',
  'ta bem',
  'bora',
  'vamos',
  'pode ser',
  'quero',
  'yes',
  'sim pode',
  'sim por favor',
  'sim pf',
  'sim obrigado',
  'sim obrigada',
  'show',
  'top',
  'otimo',
]);

const YES_EMOJI = /^[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\s]+$/u;
const THUMBS = /[👍✅👌🙌🤝✔]/u;
const DOUBT =
  /\b(nao|n|espera|perai|pera|calma|muda|mudar|troca|trocar|tira|tirar|cancela|cancelar|menos|mais|errado|faltou|falta|sem|com|so que|mas|duvida|quanto|qual)\b|\?/;

export interface Verdict {
  yes: boolean;
  /** a bare "sim", "pode", "confirmo": what an unusual order asks for */
  plain: boolean;
  why: string;
}

const no = (why: string): Verdict => ({ yes: false, plain: false, why });

export function readAnswer(text: string): Verdict {
  const raw = text.trim();
  if (raw.length === 0) return no('mensagem vazia');
  if (raw.length > 60) return no('mais de 60 caracteres: não é um sim curto');
  if (YES_EMOJI.test(raw))
    return THUMBS.test(raw)
      ? { yes: true, plain: false, why: 'joinha vale como sim' }
      : no('esse emoji não é de confirmação');
  const f = fold(raw.replace(/\p{Extended_Pictographic}/gu, ' '));
  if (!f) return no('não é um sim claro');
  const doubt = f.match(DOUBT);
  if (doubt) return no(`tem “${doubt[0]}”, que pede mudança ou dúvida`);
  if (PLAIN.has(f)) return { yes: true, plain: true, why: 'sim direto' };
  if (YES.has(f)) return { yes: true, plain: false, why: 'vale como sim' };
  const words = f.split(' ');
  const vocab = new Set(
    [...YES].flatMap((p) => p.split(' ')).concat(['por', 'favor', 'obg', 'vlw']),
  );
  if (
    words.length <= 6 &&
    words.some((w) => w === 'sim' || w === 'pode' || w === 'manda') &&
    words.every((w) => vocab.has(w))
  )
    return { yes: true, plain: words[0] === 'sim', why: 'vale como sim' };
  return no('não é um jeito claro de dizer sim');
}
