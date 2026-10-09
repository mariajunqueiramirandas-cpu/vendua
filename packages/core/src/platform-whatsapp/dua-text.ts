import type { Line } from '../copilot/actions.ts';

// The words of Duá by WhatsApp that Core writes itself (docs/features/dua-no-whatsapp.md §5): the
// "SIM" grammar, cards as text, and the fixed answers. Pure, so the tests read them directly.

export type Reply =
  { decision: 'confirm' | 'decline'; n: number | null } | { command: 'store' } | null;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The closed grammar matched before the model sees anything: a match decides a card, anything else
 * is a message to Duá. "ok" and "pode" count as yes, as the person would say them to a colleague.
 */
export function parseReply(body: string): Reply {
  if (body.length > 40) return null;
  const t = fold(body);
  if (t === '#loja') return { command: 'store' };
  const yes = /^(sim|s|pode|ok)(?: (\d{1,2}))?$/.exec(t);
  if (yes) return { decision: 'confirm', n: yes[2] ? Number(yes[2]) : null };
  const no = /^nao(?: (\d{1,2}))?$/.exec(t);
  if (no) return { decision: 'decline', n: no[1] ? Number(no[1]) : null };
  return null;
}

/** A store picked from the numbered list ("2"). */
export function parseChoice(body: string, count: number): number | null {
  const m = /^\s*(\d{1,2})\s*[.)]?\s*$/.exec(body);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= count ? n : null;
}

/** The admin's light markdown in WhatsApp's own: bold, and panel links as plain words. */
export function toWhatsApp(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .trim();
}

export interface CardText {
  ref: number | null;
  title: string;
  lines: Line[];
  money: boolean;
}

const hhmm = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
    .format(d)
    .replace(':', 'h');

/** Cards under a reply. Numbered when there are several, so the answer is "SIM 2". */
export function renderCards(
  cards: CardText[],
  o: { expiresAt: Date; tz: string; appLink: string | null },
): string {
  if (!cards.length) return '';
  const several = cards.length > 1;
  const blocks = cards.map((c) => {
    const head = several && c.ref ? `${c.ref}) *${c.title}*` : `*${c.title}*`;
    const lines = c.lines.map(
      (l) => `- ${l.label}: ${l.from != null ? `${l.from} → ` : ''}${l.to}`,
    );
    const money = c.money
      ? [`Esse mexe em preço ou cupom: confirme no painel${o.appLink ? `, em ${o.appLink}` : ''}.`]
      : [];
    return [head, ...lines, ...money].join('\n');
  });
  const askable = cards.filter((c) => !c.money);
  const until = hhmm(o.expiresAt, o.tz);
  const ask = !askable.length
    ? ''
    : several
      ? `Responda ${askable.map((c) => `SIM ${c.ref}`).join(' ou ')} para aplicar (vale até ${until}).`
      : `Responda SIM para aplicar (vale até ${until}).`;
  return [...blocks, ask].filter(Boolean).join('\n\n');
}

export const DUA = {
  nothingOpen: 'Não tem nada esperando sua confirmação.',
  whichOne: (refs: number[]) => `Qual deles? Responda ${refs.map((r) => `SIM ${r}`).join(' ou ')}.`,
  expired: 'Esse cartão expirou. Peça de novo e eu preparo outro.',
  decided: 'Esse cartão já foi decidido.',
  drifted: 'Os dados mudaram desde a proposta; quer que eu refaça?',
  declined: 'Certo, deixei de lado.',
  done: (done: string | null) => (done ? `Feito: ${done}` : 'Feito.'),
  forbidden: 'Seu papel na equipe não permite essa mudança.',
  moneyInApp: (link: string | null) =>
    `Esse cartão mexe em preço ou cupom: confirme no painel${link ? `, em ${link}` : ''}.`,
  chooseStore: (names: string[]) =>
    `Você fala por qual loja? Responda com o número:\n${names.map((n, i) => `${i + 1} ${n}`).join('\n')}`,
  chosen: (name: string) =>
    `Certo, agora é ${name}. Pode mandar. Para trocar de loja, mande #loja.`,
  onlyStore: (name: string) => `Você fala comigo pela ${name}.`,
  moreInPanel: (n: number, link: string | null) =>
    `${n === 1 ? 'Mais um cartão' : `Mais ${n} cartões`} para conferir no painel${link ? `: ${link}` : ''}.`,
  calm: 'Calma, já respondo.',
  turnOn: (first: string, link: string | null) =>
    `Oi, ${first}! Para falar com o Duá por aqui, ligue “Duá pelo WhatsApp” em Perfil, no painel${link ? `: ${link}` : ''}.`,
  notForYou: (link: string | null) =>
    `Oi! O Duá pelo WhatsApp não está disponível para o seu acesso. O painel continua${link ? ` em ${link}` : ' no app'}.`,
  voiceTooLong: 'Esse áudio passou de 3 minutos. Manda um mais curto ou escreve?',
  voiceUnheard: 'Não consegui entender o áudio. Pode mandar de novo ou escrever?',
  textOnly: 'Por enquanto só consigo ler mensagens escritas por aqui.',
  mediaOnly: 'Por aqui eu leio texto e áudio. Escreve o que precisa?',
  mediaKinds: 'Por aqui eu leio texto, áudio e foto. Escreve o que precisa?',
  photoUnseen: 'Não consegui ver essa foto. Pode mandar de novo ou escrever?',
  mediaCap: 'Hoje já foram muitos áudios e fotos. Por hoje, me escreve o que precisa?',
} as const;

/** Below this, Duá repeats what it heard before proposing anything. */
export const LOW_CONFIDENCE = 0.6;
export const HEARD_UNSURE = '[áudio; a transcrição pode ter erros]';

/** The inbox body the gateway writes for a voice note it couldn't download (Core: "manda de novo"). */
export const AUDIO_NOT_FETCHED = '[áudio não baixado]';
